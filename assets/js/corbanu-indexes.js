(function () {
  "use strict";

  const contract = window.CorbanuIndexContract;
  const form = document.getElementById("index-builder");
  const phrase = document.getElementById("index-phrase");
  const cutoff = document.getElementById("relevance-cutoff");
  const cutoffOutput = document.getElementById("cutoff-output");
  const rebalance = document.getElementById("rebalance-frequency");
  const model = document.getElementById("model-choice");
  const customModel = document.getElementById("custom-model-fields");
  const customModelId = document.getElementById("custom-model-id");
  const customModelRevision = document.getElementById("custom-model-revision");
  const weightingSummary = document.getElementById("summary-weighting");
  const rebalanceSummary = document.getElementById("summary-rebalance");
  const cutoffSummary = document.getElementById("summary-cutoff");
  const modelSummary = document.getElementById("summary-model");
  const phraseSummary = document.getElementById("summary-phrase");
  const requestPanel = document.getElementById("request-result");
  const requestHash = document.getElementById("request-hash");
  const requestJson = document.getElementById("request-json");
  const formError = document.getElementById("form-error");
  const copyButton = document.getElementById("copy-request");
  const downloadButton = document.getElementById("download-request");
  let lastEnvelope = null;

  function currentInput() {
    const isDefault = model.value === "qwen-3.8-27b";
    return {
      phrase: phrase.value,
      weighting: form.elements.weighting.value,
      rebalance_frequency: rebalance.value,
      relevance_cutoff: Number(cutoff.value),
      model_id: isDefault ? contract.DEFAULT_MODEL.id : customModelId.value,
      model_revision: isDefault ? contract.DEFAULT_MODEL.revision : customModelRevision.value,
      execution_profile: isDefault ? contract.DEFAULT_MODEL.execution_profile : "custom-model-admission-required",
    };
  }

  function titleCase(value) {
    return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function refreshSummary() {
    const input = currentInput();
    cutoffOutput.value = String(input.relevance_cutoff);
    cutoffSummary.textContent = `${input.relevance_cutoff} / 100`;
    rebalanceSummary.textContent = titleCase(input.rebalance_frequency);
    weightingSummary.textContent = input.weighting === "fundamental" ? "Fundamental" : "Market cap";
    modelSummary.textContent = model.value === "qwen-3.8-27b" ? "Qwen 3.8 27B" : (input.model_id || "Custom model");
    phraseSummary.textContent = contract.normalizePhrase(input.phrase) || "Your index mandate will appear here.";
    customModel.hidden = model.value !== "custom";
    requestPanel.hidden = true;
    lastEnvelope = null;
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
    const temporary = document.createElement("textarea");
    temporary.value = value;
    temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.appendChild(temporary);
    temporary.select();
    const copied = document.execCommand("copy");
    temporary.remove();
    if (!copied) throw new Error("Copy failed");
  }

  form.addEventListener("input", refreshSummary);
  form.addEventListener("change", refreshSummary);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError.textContent = "";
    try {
      const request = contract.buildRequest(currentInput());
      const canonicalRequest = contract.canonicalize(request);
      const hash = await sha256Hex(canonicalRequest);
      lastEnvelope = {
        request_id: `idx_${hash.slice(0, 16)}`,
        request_sha256: hash,
        request,
      };
      requestHash.textContent = hash;
      requestJson.textContent = contract.prettyCanonical(lastEnvelope);
      requestPanel.hidden = false;
      requestPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      formError.textContent = error.message;
      formError.focus();
    }
  });

  copyButton.addEventListener("click", async () => {
    if (!lastEnvelope) return;
    try {
      await copyText(contract.prettyCanonical(lastEnvelope));
      copyButton.textContent = "Copied";
      window.setTimeout(() => { copyButton.textContent = "Copy JSON"; }, 1600);
    } catch (_error) {
      formError.textContent = "Copy failed. Select the request JSON manually.";
    }
  });

  downloadButton.addEventListener("click", () => {
    if (!lastEnvelope) return;
    const blob = new Blob([`${contract.prettyCanonical(lastEnvelope)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${lastEnvelope.request_id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  refreshSummary();
}());
