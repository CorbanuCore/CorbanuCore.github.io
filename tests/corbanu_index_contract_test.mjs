import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../assets/js/corbanu-index-contract.js", import.meta.url), "utf8");
const context = { globalThis: {} };
vm.runInNewContext(source, context, { filename: "corbanu-index-contract.js" });
const contract = context.globalThis.CorbanuIndexContract;

const baseInput = {
  title: "AI Data Center Infrastructure",
  phrase: "  Public companies providing critical equipment for AI data centers  ",
  weighting: "fundamental",
  rebalance_frequency: "quarterly",
  relevance_cutoff: 70,
  model_id: contract.DEFAULT_MODEL.id,
  model_revision: contract.DEFAULT_MODEL.revision,
  execution_profile: contract.DEFAULT_MODEL.execution_profile,
};

const request = contract.buildRequest(baseInput);
assert.equal(request.mandate.title, "AI Data Center Infrastructure");
assert.equal(request.mandate.phrase, "Public companies providing critical equipment for AI data centers");
assert.equal(request.methodology.id, "corbanu.thematic-index.v1");
assert.match(request.methodology.mandate_compiler, /0\/25\/50\/75\/100/);
assert.equal(request.classification.relevance_cutoff, 70);
assert.equal(request.construction.weighting, "fundamental");
assert.equal(request.universe.id, "sec-registered-us-listed-top1000-4q-revenue-20260828");
assert.equal(request.universe.universe_sha256, "26e4caa3d7530dc31de1f1cbe46570bc6ba101193276506dedc2948826625903");
assert.equal(request.construction.fundamental.size_base, "trailing-four-quarter revenue");
assert.equal(request.construction.fundamental.thematic_multiplier, "locked Qwen relevance score divided by 100");
assert.equal(request.construction.fundamental.profitability_overlay, "exp(0.03 * selected profitability population z-score)");
assert.equal(request.construction.holding_cap, 0.20);
assert.equal(request.model.execution.hardware, "NVIDIA H200");
assert.equal(request.model.execution.max_running_requests, 32);
assert.equal(request.model.execution.random_seed, 438916795);
assert.match(request.model.execution.acceptance_replay, /strict concurrency one/);
assert.equal(request.model.execution.deterministic_inference, true);
assert.equal(request.validity.status, "draft");
assert.equal(request.validity.required_replays, 1);
assert.equal(request.validity.valid_only_after.length, 3);

const canonical = contract.canonicalize(request);
assert.equal(canonical, contract.canonicalize(contract.buildRequest(baseInput)), "the same inputs must produce byte-identical canonical requests");
assert.equal(canonical, contract.canonicalize(JSON.parse(JSON.stringify(request))), "object insertion order must not affect canonical bytes");

const capRequest = contract.buildRequest({ ...baseInput, weighting: "market_cap" });
assert.equal(capRequest.construction.market_cap.provider, "Tiingo");
assert.equal("fundamental" in capRequest.construction, false);

assert.throws(
  () => contract.buildRequest({ ...baseInput, title: "AI" }),
  /between 3 and 80 characters/,
);
assert.throws(
  () => contract.buildRequest({ ...baseInput, phrase: "AI" }),
  /at least three words/,
);
assert.throws(
  () => contract.buildRequest({ ...baseInput, relevance_cutoff: 100.5 }),
  /whole number/,
);

const page = fs.readFileSync(new URL("../indexes/index.html", import.meta.url), "utf8");
assert.match(page, /id="index-title"/);
assert.match(page, /id="index-phrase"/);
assert.match(page, /id="summary-title"/);
assert.match(page, /placeholder="Enter an index name"/);
assert.match(page, /placeholder="Describe the economic exposure this index should capture, including what qualifies a company and what should be excluded\."/);
assert.doesNotMatch(page, /placeholder="[^"]*AI data center/i);
assert.match(page, /value="fundamental" checked/);
assert.match(page, /value="quarterly" selected/);
assert.match(page, /value="70"/);
assert.match(page, /Qwen 3\.8 27B — recommended and admitted/);
assert.match(page, /Replay required before validity/);
assert.match(page, /id="run-index"/);
assert.match(page, /id="index-result"/);
assert.match(page, /Top 1,000 SEC registrants by TTM revenue/);
assert.doesNotMatch(page, /108-company|public demo/i);

JSON.parse(fs.readFileSync(new URL("../assets/indexes/corbanu-index-request-v1.schema.json", import.meta.url), "utf8"));
