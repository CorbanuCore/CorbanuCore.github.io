(function (root, factory) {
  const contract = factory();
  if (typeof module === "object" && module.exports) module.exports = contract;
  root.CorbanuIndexContract = contract;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = "corbanu.index-request.v1";
  const SCHEMA_URL = "https://corbanu.com/assets/indexes/corbanu-index-request-v1.schema.json";
  const DEFAULT_MODEL = Object.freeze({
    id: "Qwen/Qwen3.8-27B-FP8",
    label: "Qwen 3.8 27B",
    revision: "017b9c7af6b5689d5dd426a76e0bc077eb5ca20a",
    execution_profile: "qwen3.8-27b-fp8-h200-sglang-strict-fixed32-schema-v2",
  });

  const REBALANCE_VALUES = new Set(["monthly", "quarterly", "semiannual", "annual"]);
  const WEIGHTING_VALUES = new Set(["fundamental", "market_cap"]);

  function normalizePhrase(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function validateInput(input) {
    const errors = [];
    const title = normalizePhrase(input.title);
    const phrase = normalizePhrase(input.phrase);
    if (title.length < 3 || title.length > 80) {
      errors.push("Index title must be between 3 and 80 characters.");
    }
    if (phrase.length < 12 || phrase.split(" ").length < 3) {
      errors.push("Describe the index in at least three words.");
    }
    if (!WEIGHTING_VALUES.has(input.weighting)) errors.push("Choose a supported weighting method.");
    if (!REBALANCE_VALUES.has(input.rebalance_frequency)) errors.push("Choose a supported rebalance frequency.");
    const cutoff = Number(input.relevance_cutoff);
    if (!Number.isInteger(cutoff) || cutoff < 0 || cutoff > 100) {
      errors.push("Relevance cutoff must be a whole number from 0 to 100.");
    }
    if (!String(input.model_id || "").trim()) errors.push("Model ID is required.");
    if (!String(input.model_revision || "").trim()) errors.push("An exact model revision is required.");
    return errors;
  }

  function buildRequest(input) {
    const errors = validateInput(input);
    if (errors.length) throw new Error(errors.join(" "));

    const weighting = input.weighting;
    const request = {
      schema: SCHEMA_VERSION,
      schema_url: SCHEMA_URL,
      mandate: {
        title: normalizePhrase(input.title),
        phrase: normalizePhrase(input.phrase),
      },
      methodology: {
        id: "corbanu.thematic-index.v1",
        mandate_compiler: "selected model converts the user phrase into a named basket, description, and explicit 0/25/50/75/100 scoring rubric",
        issuer_scorer: "the same frozen rubric is applied to every company with an integer score, confidence, and a reasoning block of at least three paragraphs",
        scoring_output_schema: "corbanu.thematic-company-score.v1",
      },
      universe: {
        id: "sec-registered-us-listed-top1000-4q-revenue-v81-20260828",
        selection: "top 1,000 eligible U.S.-listed SEC registrants by positive trailing-four-quarter revenue",
        source: "Frozen SEC registry, submissions, and Company Facts through 2026-08-27; sec-fundamentals-proxy-v81",
        universe_sha256: "232051065ec1fd268faf2e6ac9520c110bcb747193cc05195ad3ffa19b3f27c0",
      },
      classification: {
        score_range: [0, 100],
        relevance_cutoff: Number(input.relevance_cutoff),
        evidence_policy: "model training knowledge grounded by the issuer's latest exact-period earnings transcript when available; unavailable transcripts are explicitly recorded and never replaced with annual filings",
      },
      construction: {
        weighting,
        rebalance_frequency: input.rebalance_frequency,
        rebalance_trigger: "first eligible index date after the selected calendar interval",
        holding_cap: 0.20,
        integer_weight_units: 1000000000000,
      },
      model: {
        id: String(input.model_id).trim(),
        revision: String(input.model_revision).trim(),
        execution_profile: String(input.execution_profile || "custom-model-admission-required").trim(),
      },
      validity: {
        status: "draft",
        required_replays: 1,
        valid_only_after: [
          "primary scoring and weight artifacts are content-addressed",
          "an independent replay produces byte-identical scoring output",
          "reconstructed integer weights match exactly",
        ],
      },
    };

    if (request.model.execution_profile === DEFAULT_MODEL.execution_profile) {
      request.model.execution = {
        runtime_image: "lmsysorg/sglang:nightly-dev-cu13-20260817-d91c3682@sha256:fa8774dd128600a09fd6d46670b06fb69a55dac8a3881e50ccf0916a45eb39af",
        hardware: "NVIDIA H200",
        deterministic_inference: true,
        max_running_requests: 32,
        request_batch_size_per_host: 32,
        attention_backend: "triton",
        linear_attention_backend: "triton",
        temperature: 0,
        top_p: 1,
        random_seed: 438916795,
        acceptance_replay: "two independent fixed 32-request passes; every accepted raw UTF-8 response must have a byte-identical replay partner",
        thinking: false,
        radix_cache: false,
        overlap_schedule: false,
        decode_cuda_graph: false,
        prefill_cuda_graph: false,
      };
    }

    if (weighting === "market_cap") {
      request.construction.market_cap = {
        provider: "Tiingo",
        method: "eligible constituents weighted in proportion to point-in-time market capitalization",
      };
    } else {
      request.construction.fundamental = {
        size_base: "trailing-four-quarter revenue",
        thematic_multiplier: "locked Qwen relevance score divided by 100",
        profitability_overlay: "exp(0.03 * selected profitability population z-score)",
        profitability_router: "TTM net income for financial services and utilities; TTM free cash flow otherwise",
        source_policy: "frozen SEC-only fundamentals with no licensed vendor values or fallback",
      };
    }
    return request;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function prettyCanonical(value) {
    return JSON.stringify(JSON.parse(canonicalize(value)), null, 2);
  }

  return Object.freeze({
    SCHEMA_VERSION,
    SCHEMA_URL,
    DEFAULT_MODEL,
    normalizePhrase,
    validateInput,
    buildRequest,
    canonicalize,
    prettyCanonical,
  });
}));
