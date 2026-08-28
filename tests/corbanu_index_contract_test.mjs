import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../assets/js/corbanu-index-contract.js", import.meta.url), "utf8");
const context = { globalThis: {} };
vm.runInNewContext(source, context, { filename: "corbanu-index-contract.js" });
const contract = context.globalThis.CorbanuIndexContract;

const baseInput = {
  phrase: "  Public companies providing critical equipment for AI data centers  ",
  weighting: "fundamental",
  rebalance_frequency: "quarterly",
  relevance_cutoff: 70,
  model_id: contract.DEFAULT_MODEL.id,
  model_revision: contract.DEFAULT_MODEL.revision,
  execution_profile: contract.DEFAULT_MODEL.execution_profile,
};

const request = contract.buildRequest(baseInput);
assert.equal(request.mandate.phrase, "Public companies providing critical equipment for AI data centers");
assert.equal(request.methodology.id, "corbanu.thematic-index.v1");
assert.match(request.methodology.mandate_compiler, /0\/25\/50\/75\/100/);
assert.equal(request.classification.relevance_cutoff, 70);
assert.equal(request.construction.weighting, "fundamental");
assert.equal(request.construction.fundamental.score_share, 0.20);
assert.equal(request.construction.fundamental.fundamental_share, 0.80);
assert.equal(request.construction.fundamental.profitability_overlay, "exp(0.03 * cross-sectional z-score)");
assert.equal(request.construction.holding_cap, 0.20);
assert.equal(request.model.execution.hardware, "NVIDIA H200");
assert.equal(request.model.execution.max_running_requests, 32);
assert.equal(request.model.execution.random_seed, 438916795);
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
  () => contract.buildRequest({ ...baseInput, phrase: "AI" }),
  /at least three words/,
);
assert.throws(
  () => contract.buildRequest({ ...baseInput, relevance_cutoff: 100.5 }),
  /whole number/,
);

const page = fs.readFileSync(new URL("../indexes/index.html", import.meta.url), "utf8");
assert.match(page, /id="index-phrase"/);
assert.match(page, /value="fundamental" checked/);
assert.match(page, /value="quarterly" selected/);
assert.match(page, /value="70"/);
assert.match(page, /Qwen 3\.8 27B — recommended and admitted/);
assert.match(page, /Replay required before validity/);

JSON.parse(fs.readFileSync(new URL("../assets/indexes/corbanu-index-request-v1.schema.json", import.meta.url), "utf8"));
