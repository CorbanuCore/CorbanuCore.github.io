#!/usr/bin/env python3
"""Create/resume a Corbanu index using an existing CORBANU_API_KEY. Python 3.10+."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, build_opener, HTTPRedirectHandler
from uuid import uuid4

BASE = "https://api.corbanu.com"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Keep the bearer credential on the configured API host.


def api(path, body=None, request_id=None):
    key = os.environ.get("CORBANU_API_KEY", "").strip()
    if not key:
        raise ValueError("Set CORBANU_API_KEY to your existing Corbanu account key.")
    headers = {"Authorization": "Bearer " + key, "Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if request_id:
        headers["X-Corbanu-Request-Id"] = request_id
    req = Request(BASE + path, data=data, headers=headers)
    try:
        with build_opener(NoRedirect).open(req, timeout=90) as response:
            return json.load(response)
    except HTTPError as error:
        try:
            message = json.load(error).get("error", "Request rejected")
        except (ValueError, AttributeError):
            message = "Request rejected"
        raise RuntimeError(f"Corbanu HTTP {error.code}: {message}") from None


def save(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + "." + str(uuid4()) + ".tmp")
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def run(args, call=api):
    paths = [Path(p).resolve() for p in (args.request, args.state, args.output)]
    if len(set(paths)) != 3:
        raise ValueError("Request, state and output must be different files.")
    body = json.loads(paths[0].read_text())
    if not isinstance(body, dict):
        raise ValueError("Request must be the complete index request JSON object.")
    account = call("/v1/account")
    if "corbanuApi" not in account or not account.get("walletAddress"):
        raise ValueError("Account response is missing its Corbanu balance.")
    # Persist the request identity before starting. A lost response cannot cause a
    # duplicate job when the same command is resumed with this state file.
    if paths[1].exists():
        state = json.loads(paths[1].read_text())
        if state.get("walletAddress") != account["walletAddress"]:
            raise ValueError("State belongs to a different Corbanu account.")
        if state["request"] != body:
            raise ValueError("Request changed. Use a new --state file for a different index.")
    else:
        state = {"request_id": str(uuid4()), "request": body, "walletAddress": account["walletAddress"]}
        save(paths[1], state)
    if not state.get("preview_id"):
        started = call("/v2/indexes/previews", body, state["request_id"])
        state["preview_id"] = started["id"]
        save(paths[1], state)
    path = "/v2/indexes/previews/" + quote(state["preview_id"], safe="")
    deadline = time.monotonic() + args.max_wait_seconds
    while True:
        status = call(path)
        save(paths[1], {**state, "last_status": status["status"]})
        print(json.dumps({k: status.get(k) for k in ("id", "status", "phase", "progress", "relevance_cutoff")}), file=sys.stderr)
        if status["status"] in ("completed", "needs_data"):
            result = call(path + "/result")
            if not isinstance(result.get("payload"), dict):
                raise ValueError("Result did not contain the signed index payload.")
            save(paths[2], result)
            print(json.dumps({"id": state["preview_id"], "status": status["status"], "output": str(paths[2]),
                              "preview_sha256": status.get("preview_sha256"),
                              "page_url": "https://corbanu.com/indexes/?preview=" + quote(state["preview_id"], safe="")}))
            return 0 if status["status"] == "completed" else 2
        if status["status"] not in ("queued", "running"):
            raise RuntimeError(status.get("error") or "Index job failed; inspect the saved preview.")
        if time.monotonic() >= deadline:
            raise TimeoutError("Wait limit reached. Run the same command to resume this saved job.")
        time.sleep(5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, help="Complete request JSON; supply your own mandate, construction choices and disclosure acceptance")
    parser.add_argument("--state", default="index-job.json", help="Persistent request ID / preview ID; reuse this file to resume")
    parser.add_argument("--output", default="index.json", help="Signed result JSON, including all weights and reasoning")
    parser.add_argument("--max-wait-seconds", type=int, default=900)
    args = parser.parse_args()
    if args.max_wait_seconds < 0:
        parser.error("--max-wait-seconds must be nonnegative")
    try:
        return run(args)
    except (RuntimeError, ValueError, KeyError, OSError, URLError) as error:
        print(str(error), file=sys.stderr)
        print("State is retained. Retry transient failures with the same request and state files.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
