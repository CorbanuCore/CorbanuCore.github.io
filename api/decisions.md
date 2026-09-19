# Corbanu Decisions API

Send a decision question and its context as Markdown or plain text. Corbanu turns
it into five useful options A–E, researches the choice, collects model votes, and
returns a clear recommendation with sources and reasoning. The API recommends
an action; it does not execute it.

Base URL: `https://api.corbanu.com`. Use your existing Corbanu API key and funded
balance. Store the key in `CORBANU_API_KEY` on your server; send it only to the API
in the `Authorization: Bearer` header.

[Website reference](https://corbanu.com/api/#decisions) ·
[OpenAPI schema](https://api.corbanu.com/v1/decisions/openapi.json) ·
[Get or fund a key](https://corbanu.com/api/#get-key)

## Choose a mode

| | Standard (default) | Budget |
| --- | --- | --- |
| Research | Three diversified reports | One full report combining the research perspectives |
| Voting models | Astra Pro, GLM 5.3, and Kimi K3 by default; configurable | DeepSeek V4.1 Flash |
| Votes | Three independent runs per model; nine total | Three independent Flash runs |
| Draft reviews | One Astra Pro review and one Kimi K3 review | Two independent Flash reviews |
| Final rewrite | Kimi K3 | Kimi K3 |

Budget mode uses DeepSeek V4.1 Flash for all generation before the final rewrite,
including generation inside the research report. It retains the full research
workflow and document limits. Its three ballots are repeated runs of one model,
not agreement across three different models.

## 1. Prepare the request

Put your question, relevant facts, constraints, and priorities in `context.md`.
For example, describe a product launch, the team available, customer interest,
and what a successful launch would mean. If you do not state a question, the API
identifies the decision from the supplied context.

The following examples use Bash, curl, and jq. Work in a separate directory for
each decision and keep its request and receipt files so you can resume polling.

```sh
umask 077
jq -n --rawfile context context.md \
  '{input: $context, mode: "standard", format: "markdown"}' \
  > decision-request.json
```

For budget mode, use `mode: "budget"` instead when preparing this file. Choose
one mode before submitting; running both creates two separately billed jobs.

| Field | Meaning |
| --- | --- |
| `input` | Required. Nonempty Markdown or plain text, up to 60,000 characters. |
| `mode` | Optional. `standard` by default, or `budget`. |
| `models` | Optional. Standard: exactly three distinct supported IDs. Budget: omit, or use `["corbanu/deepseek-v4.1-flash"]`. |
| `format` | Optional. `markdown` by default, or `pdf`. You can override this when downloading. |

Standard defaults are `corbanu/astra-pro`, `corbanu/glm-5.3`, and
`corbanu/kimi-k3`. To choose a different panel, read the available IDs:

```sh
curl --fail-with-body -sS https://api.corbanu.com/v1/decisions/models \
  -H "Authorization: Bearer $CORBANU_API_KEY" | jq .
```

The `models` field changes the standard voting panel. Framing, research design,
drafting, reviews, and the final rewrite retain their designated models.

JSON bodies are limited to 128 KiB. The endpoint also accepts a raw `text/plain`
or `text/markdown` body, limited to 64 KiB, with standard defaults. Use JSON to
select budget mode or configure the panel. Unknown JSON fields are rejected.

## 2. Submit once and save the job ID

Choose and persist a unique request ID before the first POST. This example uses
a descriptive ID; use a different value for each new decision. Reuse the saved
ID and unchanged body if the submission response is lost.

```sh
# Initialize once in this decision's directory.
if [ ! -f decision-request-id.txt ]; then
  printf '%s\n' 'product-launch-001' > decision-request-id.txt
fi

curl --fail-with-body -sS https://api.corbanu.com/v1/decisions \
  -H "Authorization: Bearer $CORBANU_API_KEY" \
  -H "X-Corbanu-Request-Id: $(cat decision-request-id.txt)" \
  -H 'Content-Type: application/json' \
  --data-binary @decision-request.json > decision-job.json

CORBANU_DECISION_ID=$(jq -er '.id' decision-job.json)
```

Creation returns **202 Accepted**, with a body containing `id`, `status`, `stage`,
`mode`, `models`, `runs_per_model`, `completed_calls`, `total_calls`,
`research_progress`, `billing`, `report_url`, and `packet_url`. The `Location`
header points to `/v1/decisions/{id}`. Returned report and packet URLs are paths
relative to `https://api.corbanu.com`.

`X-Corbanu-Request-Id` accepts up to 100 letters, digits, hyphens, underscores,
dots, or colons. For the same account, the same ID and normalized request return
the existing job. Changing the input, mode, panel, or format under that ID returns
`409 request_id_conflict`. If omitted, an ID is generated and returned in the
response header. Persisting your own ID lets you recover when a response is lost.

## 3. Poll the saved job

```sh
CORBANU_DECISION_ID=$(jq -er '.id' decision-job.json)
curl --fail-with-body -sS \
  "https://api.corbanu.com/v1/decisions/$CORBANU_DECISION_ID" \
  -H "Authorization: Bearer $CORBANU_API_KEY" > decision-status.json

jq '{id,status,stage,completed_calls,total_calls,research_progress,
     selected,vote_counts,error,billing}' decision-status.json
```

Repeat the GET every 5–15 seconds while the job is active. Status retrieval
returns HTTP `200`; use the body's lowercase `status` to determine completion.

| Status | What to do |
| --- | --- |
| `queued` / `running` | Continue polling the same job. |
| `completed` | Download the report and, optionally, the full packet. |
| `failed` | Stop polling and inspect `error` and the saved packet. Reposting the same request does not restart the job. |

Stages progress through `framing`, `planning_research`, `researching`, `voting`,
`drafting`, `mini_tih`, `rewriting`, and `completed`. The `research_progress`
array gives each report's status and stage.

`total_calls` is 18 in standard mode and 10 in budget mode. These count top-level
operations; each research report contains additional searches and model calls.
They are not percentages of elapsed time or a count of every provider request.
Independent research jobs, votes, and reviews run concurrently within their
stage as available balance permits. Research and provider queues affect runtime;
the API does not promise a fixed completion time. Closing your client does not
cancel a server job. There is no public cancellation or failed-job resume route.

## 4. Download the result

Once `status` is `completed`:

```sh
curl --fail-with-body -sS \
  "https://api.corbanu.com/v1/decisions/$CORBANU_DECISION_ID/report?format=markdown" \
  -H "Authorization: Bearer $CORBANU_API_KEY" -o decision.md

curl --fail-with-body -sS \
  "https://api.corbanu.com/v1/decisions/$CORBANU_DECISION_ID/report?format=pdf" \
  -H "Authorization: Bearer $CORBANU_API_KEY" -o decision.pdf

curl --fail-with-body -sS \
  "https://api.corbanu.com/v1/decisions/$CORBANU_DECISION_ID/packet" \
  -H "Authorization: Bearer $CORBANU_API_KEY" -o decision-packet.json
```

The report endpoint returns the document itself, not a JSON wrapper. Omitting
`?format=` uses the format chosen at creation. Both formats render the same saved
report without another model run. A report requested before completion returns
`409 decision_not_completed`. The JSON packet is available during execution and
after failure as well as on completion.

Reports contain six sections:

1. User Proposed Decision
2. Summary of User Context
3. Machine Generated Options
4. The Decision Recommended and Its Votes
5. A Summary in Plain English of the Reasoning
6. The Vote Tally for Each Option

The report explains each option, connects the recommendation to the user's
context, compares alternatives, and includes source links. It is written to make
sense without the underlying research. Reports target 1,200–1,600 words; the PDF
is limited to five pages. The vote table comes from the stored ballots.

The separate packet includes the original input, prompts, complete research,
sources, each ballot's one-page reasoning and A–E ranking, the tally, draft,
review scores and feedback, final report, usage, and available failure diagnostics.
It excludes credentials and private model reasoning. Treat the packet as private
user material when storing or sharing it.

## How the recommendation is produced

1. **Frame the decision.** Use the user's question, or infer one from the context,
   and develop five realistic permutations with considerations for each.
2. **Design the research.** Standard mode commissions three distinct reports:
   evidence about outcomes and comparable cases; feasibility and economics; and
   counterarguments, risks, and alternatives. Budget mode combines these in one
   assignment. Both use Corbanu Deep Research.
3. **Collect independent votes.** Each run receives the input, options, and research
   without seeing the other ballots. It selects A–E, ranks all five options, and
   explains its reasoning. All nine standard or three budget ballots are required.
4. **Choose and draft.** The option with the most first-choice votes wins. Ties
   use ranking points across all ballots: 4 for first, then 3, 2, 1, and 0. A–E
   order breaks any remaining tie. The report discloses the tally and dissent.
5. **Review and rewrite.** Two independent reviews score the draft from 0–100
   and give feedback. Kimi K3 rewrites the complete report using both critiques,
   preserving the selected option. The review scores apply to the draft; the
   final rewrite is not re-scored.

In standard mode, GLM 5.3 frames the decision, Kimi K3 designs the research and
drafts the report, and Astra Pro and Kimi K3 review it. Budget mode uses Flash
for all these steps, with Kimi K3 reserved for the final rewrite.

Vote counts are not statistical confidence estimates. Citation validation checks
source identifiers; it does not independently verify every claim in the report.

## Billing and failure handling

There is no additional Decisions fee. Model calls and research consume the
account's prepaid balance using their respective usage-based billing. There is
no fixed total quote or hard spending cap for a decision in this version.

Model calls reserve funds before submission and settle reported usage, including
reasoning and cache usage where reported. Unused reserves are released. Maintain
enough available balance for later stages. Calls can wait for active calls to
release reserves; insufficient balance with no funded work left causes failure
while preserving completed work.

`billing.settled_model_cost_microusd` covers the recorded model charges, in
millionths of a US dollar. Research usage is separate in `billing.research_usage`;
the model total alone is not the complete decision cost. The packet contains
operation-level usage and charges.

Failed model calls settle only authoritative provider usage. Without a usage
receipt, the model reservation is released without a charge. An invalid or
incomplete answer can still incur a charge when usage is reported. Research
retains its own reservation and settlement policy.

An accepted or ambiguous failed model submission is not automatically repeated.
Explicit provider HTTP `429` rejections have bounded retries before acceptance.
Polling an existing job does not launch new generation. Retrying creation with
the same ID and unchanged request returns that job; a new ID starts a new,
separately billed decision.

## Access and errors

All endpoints below require a Corbanu bearer key except the public OpenAPI schema.
Jobs belong to the account, so another valid key for that account can retrieve
them. Other accounts receive `404`. Revoking the submitting key stops further
work at the next worker step. Up to three decisions may be active per account.

Inputs and job records are encrypted at rest, and authenticated responses use
`Cache-Control: no-store`. Processing uses third-party inference and research
providers; this is not private inference. The status response discloses
`corbanu.private: false`.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/v1/decisions/models` | Available panel models and mode settings |
| POST | `/v1/decisions` | Create a job or retrieve it by request ID |
| GET | `/v1/decisions/{id}` | Status, progress, tally, and usage |
| GET | `/v1/decisions/{id}/report` | Completed report in the selected format |
| GET | `/v1/decisions/{id}/packet` | Full or partial execution packet |
| GET | `/v1/decisions/openapi.json` | Public OpenAPI contract |

Request errors generally use `{"error":{"type":"code","detail":"message"}}`.
Once a job has been accepted, a later processing failure appears as
`status: "failed"` with an `error` string in the status response.

| HTTP status | Meaning |
| --- | --- |
| `400` | Invalid input, mode, panel, format, or request ID. |
| `401` | Missing, invalid, or revoked key. |
| `402` | A funded API balance is required. Later balance failures appear in job status. |
| `404` | Job absent or owned by another account. |
| `409` | Request ID reused with different content, or report not ready. |
| `413` | Request exceeds the JSON or raw-body byte limit. |
| `429` | Account already has three active decisions. |
| `503` | Decisions or a required model is unavailable. |

If framing finds no substantive decision context, the job fails with
`decision_needs_context` and records what was missing. Review the saved failure
before choosing to submit a new decision.
