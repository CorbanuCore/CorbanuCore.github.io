# Corbanu Index API for agents

Base URL: https://api.corbanu.com
OpenAPI: https://api.corbanu.com/v2/indexes/openapi.json
Human reference: https://corbanu.com/api/#indexes
Python reference runner: https://corbanu.com/api/examples/index_agent.py

An agent with an existing Corbanu account key can create an index, poll it, retrieve its signed weights and reasoning, and change its cutoff entirely through HTTP. Use the same `cbn_…` key that authenticates the account's Corbanu prepaid balance. No separate DeepSeek key, Plan subscription, MetaMask connection, browser cookie, `Origin` header or `/v2/indexes/session` call is required for these operations.

**Publication defaults:** indexes created on Corbanu.com automatically lock and publish when generation completes. Website creation explicitly sends `publish_on_completion:true` with the creator disclosure acceptance. API requests are **private by default**: omit this field or send `false`. API clients may opt in with `true` only when the user authorizes public publication of the index, supplied inputs, holdings and explanations, including permanent IPFS storage. A wallet claim is not required to publish; claiming creator revenue ownership remains a separate wallet-signed action.

When opted in, poll the preview's `publication.status` until `published`; `status:completed` means scoring is complete and publication may still be underway. `publication.page_url` is the public index URL. Publication continues server-side after the browser/client disconnects, and pin failures retry without new inference. Failed or `needs_data` jobs are not published. Reweight API requests also default to private, even when their source is public; opt in explicitly for each new revision.

## 1. Authenticate and check the account

Load `CORBANU_API_KEY` from your secret store. Every private request uses:

```http
Authorization: Bearer <your full Corbanu API key>
```

```sh
curl --fail-with-body -sS https://api.corbanu.com/v1/account \
  -H "Authorization: Bearer $CORBANU_API_KEY" > account.json
jq '{walletAddress, balance: .corbanuApi}' account.json
```

`corbanuApi.availableMicrousd` is the spendable balance after reservations; it is an integer string, with 1,000,000 units per USD. `balanceMicrousd` and `reservedMicrousd` report the total and held balances. Display fields `availableUsd`, `balanceUsd`, and `reservedUsd` are decimal strings. Read this account endpoint rather than inferring balance from a connected wallet or a legacy Plan allowance.

Index previews, saved-score cutoff changes and locks currently charge **$0**. A funded Corbanu account is eligible, and a valid zero-balance key is also accepted under current pricing. Do not impose an invented minimum balance. The catalog's `pricing` object reports current index charges; other inference and Deep Research products have their own pricing. A Corbanu API balance is not the wallet's USDC trading balance.

## 2. Read options and prepare an explicit request

```sh
curl --fail-with-body -sS https://api.corbanu.com/v2/indexes/catalog > catalog.json
jq '{models,prompts,reasoning_efforts,deterministic_available,pricing,disclosure,disclosure_sha256}' catalog.json
```

Supply the user's mandate, weighting and relevance cutoff. Do not substitute a portfolio methodology. Select the model and prompt from the catalog. `corbanu/deepseek-v4.1-flash` is the default replay model and supports the selected `low`, `high`, or `max` reasoning effort. The server schedules up to 200 company requests for direct Flash; the agent makes **one** preview request, not one request per company.

Read the current creator disclosure and submit its returned version and hash, the user's acceptance, and their stated material conflicts. `accepted:true` records that acceptance; an API key does not itself authorize accepting a disclosure or publishing private inputs. Use "None" only when it accurately reflects the user's stated conflicts. Wallet signatures are not required for creating a private preview.

The following is an illustrative request. Replace the mandate and construction choices with the user's instructions and use their disclosure acceptance:

```sh
jq -n --slurpfile c catalog.json '{
  mandate: {
    title: "Semiconductor equipment",
    phrase: "Companies making semiconductor production equipment."
  },
  model: "corbanu/deepseek-v4.1-flash",
  prompt_id: "thematic_v1",
  reasoning_effort: "high",
  deterministic: false,
  external_funds: false,
  weighting: "market_cap",
  relevance_cutoff: 70,
  disclosure: {
    version: $c[0].disclosure.version,
    sha256: $c[0].disclosure_sha256,
    accepted: true,
    conflicts: "None"
  }
}' > index-request.json
```

The title must contain 3–80 characters and the mandate phrase 12–600 characters after whitespace normalization. `weighting` is `market_cap` or `market_cap_rank`; `relevance_cutoff` is an integer from 0 through 100. A company qualifies on **relevance score >= cutoff**, independently of confidence. For example, relevance 25 and confidence 88 does not qualify at cutoff 70. Existing capitalization-data requirements still apply to qualifying holdings.

For a custom prompt, use `prompt_id:"custom"` and include `prompt`. Optional `user_inputs` maps frozen security IDs, such as `felix:AAPLon`, to supplied text. The output includes underlying stocks and their explicit Felix Ethereum token representations. `external_funds:true` requires `deterministic:true` and qualified replay. Check `deterministic_available`; unavailable replay returns 503 before creation. Do not silently downgrade a requested deterministic index.

## 3. Start once, then poll

Create and **persist** a unique request ID before the POST. Reuse the same ID and exact JSON body after a network failure. A fresh ID starts another job.

```sh
# Execute this initialization only once for this logical index request.
python3 -c 'from pathlib import Path; import uuid; p=Path("index-request-id.txt"); p.exists() or p.write_text(str(uuid.uuid4()))'

curl --fail-with-body -sS https://api.corbanu.com/v2/indexes/previews \
  -H "Authorization: Bearer $CORBANU_API_KEY" \
  -H "X-Corbanu-Request-Id: $(cat index-request-id.txt)" \
  -H 'Content-Type: application/json' \
  --data-binary @index-request.json > started.json

INDEX_ID=$(jq -er .id started.json)
curl --fail-with-body -sS "https://api.corbanu.com/v2/indexes/previews/$INDEX_ID" \
  -H "Authorization: Bearer $CORBANU_API_KEY" > status.json
jq '{id,status,phase,progress,relevance_cutoff,derivation,preview_sha256,error}' status.json
```

The POST returns **202 Accepted** with `id`, `created`, `status`, progress and `status_url`. Repeat the status GET about every five seconds while `status` is `queued` or `running`. Do not repeatedly POST new previews to poll. A status `error` while the job is queued/running can describe an earlier recovered failure; the `status` field determines whether the job is terminal.

| Status | Agent behavior |
| --- | --- |
| `queued` / `running` | Continue polling the same ID; completed scores are retained. |
| `completed` | Download the signed result and inspect the actual cutoff, holdings and exclusions. |
| `needs_data` | Download diagnostic JSON; it cannot be locked. A revised cutoff can reuse all saved scores if appropriate to the user's instructions. |
| `failed` | Report the recorded error and saved preview ID. Do not automatically launch duplicate full-universe jobs. |

## 4. Retrieve the signed index

```sh
curl --fail-with-body -sS "https://api.corbanu.com/v2/indexes/previews/$INDEX_ID/result" \
  -H "Authorization: Bearer $CORBANU_API_KEY" > index.json
jq '.payload.request | {mandate,model,relevance_cutoff,weighting}' index.json
jq '.payload.construction | {weights,excluded,issues}' index.json
jq '.payload.scores[] | {security_id,ticker,score,confidence,reasoning_block}' index.json
```

The response is a `corbanu.signed-index.v1` envelope with `payload`, `public_key`, `signature`, and signing authority. `payload.construction.weights` contains exact integer `weight_units`, ticker, score and the venue/chain/token-contract representation. For a completed basket, weight units sum to **1,000,000,000,000**. Convert to a percentage by dividing each weight by 10,000,000,000. `payload.scores` contains all company scores, not just included holdings. Read the weights array for the actual basket.

`payload.request.relevance_cutoff` is authoritative; newly generated methodology metadata repeats that effective value. Historic metadata may contain the old default even when a request specified another cutoff. `validity.independent_inference_replay` reports whether independent replay was verified; a signed artifact alone does not establish it.

The corresponding review URL is `https://corbanu.com/indexes/?preview=<id>`. Previews stay in the account: `GET /v2/indexes` lists the latest 100 saved previews and locked baskets. Old rows with `workflow:false` use `GET /v1/indexes/{id}/result`; modern previews use the v2 result path above.

## 5. Change cutoff or weighting without new inference

```sh
jq '{preview_sha256,relevance_cutoff:70}' status.json > reweight-request.json
# Persist a new ID for this separate logical revision; reuse it on retries.
python3 -c 'from pathlib import Path; import uuid; p=Path("reweight-request-id.txt"); p.exists() or p.write_text(str(uuid.uuid4()))'
curl --fail-with-body -sS "https://api.corbanu.com/v2/indexes/previews/$INDEX_ID/reweight" \
  -H "Authorization: Bearer $CORBANU_API_KEY" \
  -H "X-Corbanu-Request-Id: $(cat reweight-request-id.txt)" \
  -H 'Content-Type: application/json' \
  --data-binary @reweight-request.json > revised.json
```

Choose the new cutoff from the user's instructions; 70 above is illustrative. Poll the **new** ID in `revised.json`, then download its result. This copies all scores, rubric and receipts atomically, uses the same frozen packet, and changes the cutoff plus the optional `weighting` method. Add `"weighting":"market_cap_rank"` to the request body to use linear rank weights; omission preserves the source method. The source preview and existing locked baskets remain unchanged. The signed output records `derivation.source_preview_id` and `source_preview_sha256`. Lock a revision using its new `preview_sha256`, never its source's hash.

## 6. Optional lock, ownership, publication and trading

After the user has authorized confirming the inspected weights, `POST /v2/indexes/{id}/lock` with `{"preview_sha256":"<current inspected hash>"}` pins a signed encrypted IPFS snapshot. It does not publish or trade. This operation accepts the same Corbanu bearer key; a wallet signature is not needed for locking.

Creator claim requires a payout-wallet signature over `/claim-challenge`, submitted to `/claim`. Public publication is a separate `/publish` call with current disclosure acceptance ; no creator claim is required. Publicly readable snapshots do not automatically enable other investors. Creator revenue is commission/affiliate based, with payout terms and settlement not yet configured.

Buying requires separate Felix authentication, wallet funds, quotes and signed orders. A funded Corbanu API key alone cannot place a stock trade. See https://corbanu.com/api/#indexes for those endpoints. The reference runner sends the exact supplied request. It stays private by default; `publish_on_completion:true` authorizes server-side lock/publication. It never claims a wallet or trades.

## Runnable Python example

Download the reference runner and supply the complete request from step 2:

```sh
curl --fail-with-body -sS https://corbanu.com/api/examples/index_agent.py -o index_agent.py
python3 index_agent.py --request index-request.json --state index-job.json --output index.json
```

Python 3.10+; no third-party packages. It checks `/v1/account`, saves a request ID before starting, polls and downloads the result. Rerun the same command after interruption to resume without a duplicate job. The state file is bound to the account and exact request; use a different state file for a genuinely new index. State and output files are private and do not contain the API key. Only run one process per state file. Exit codes: 0 completed; 2 diagnostic `needs_data` artifact saved; 1 request failure or wait limit. The default wait limit is 900 seconds and can be set with `--max-wait-seconds`; reaching it does not cancel the server job.

## Errors and retry boundaries

Index errors use `{"error":"message"}`. Other Corbanu products may use a structured error object.

- **400**: invalid body, cutoff, model option, request ID or disclosure. Correct the request.
- **401**: missing, invalid or revoked Corbanu key. Browser session login is not the remedy for an agent; use its account key.
- **402**: insufficient available balance for the operation's quoted charge. Read `/v1/account` and current pricing; do not invent a fee.
- **404**: missing ID, wrong account, or wrong legacy/modern result route.
- **409**: ID/body conflict, stale preview hash, unfinished result, or invalid lifecycle transition. Reload the current status rather than silently changing the request.
- **429 / transport / transient 5xx**: back off; honor `Retry-After` when present. Retry a POST with its persisted ID and identical body, or continue polling the saved preview ID. A capability-specific 503 such as unavailable deterministic replay requires that capability to become available.

Only send the Corbanu credential to https://api.corbanu.com. Keep keys out of URLs, committed request files, logs and model prompts. Keep user inputs and index artifacts private until the user authorizes publication.

Website-created previews always use a minimum relevance of 70/100. Custom cutoffs are available only through the API: specify `relevance_cutoff` in a preview request, or use the reweight endpoint to apply a different cutoff to saved scores. Existing previews retain their original cutoff.

Website creation defaults to `market_cap_rank`, the approved linear rank method. To revise an existing preview without inference, include `"weighting":"market_cap_rank"` alongside `preview_sha256` and `relevance_cutoff` in `POST /v2/indexes/previews/{id}/reweight`. Omitted weighting preserves the source method. Raw `market_cap` remains available explicitly.

## Creator identity and provenance

`POST /v2/indexes/{id}/claim-x` requires the creator's Corbanu bearer key or remembered browser session. It returns `redirect_url` and sets a ten-minute HttpOnly OAuth state cookie. Open that URL in the same browser, authorize X, and return to the index. An API agent can initiate the flow but cannot authorize the creator's X account without their browser interaction. No MetaMask signature is required for the X claim.

Corbanu verifies X OAuth2 with PKCE using Task Node's registered callback and a signed, fixed-destination relay. The callback consumes the browser-bound state once and binds X's stable user ID to `index_sha256`. Read `x_claim` and `x_claim_receipt` from the index response. The receipt is signed; claiming does not rewrite an already pinned index artifact. Handles can change; `provider_user_id` identifies the authenticated account at claim time.

Use the existing wallet claim challenge/signature endpoints separately to attach a payout wallet. Creator revenue is based on commissions or affiliate revenue; percentages and settlement remain unconfigured. X claiming does not transfer funds or enable payouts.

Published index responses include `generation_origin`: `ai_generated` for model-generated holdings, or `user_generated` for an explicitly supported manual construction source. The current creation API always generates holdings with AI, even when a user supplies the theme, prompt or context. It does not accept a caller override for this label. Existing model-scored indexes are labeled AI generated; the library also identifies their creator-defined themes. Provenance is distinct from verified deterministic replay.
