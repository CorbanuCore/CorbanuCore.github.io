(function () {
  "use strict";

  const contract = window.CorbanuIndexContract;
  const config = window.CorbanuIndexConfig || {};
  const apiBase = String(config.apiBase || "").replace(/\/$/, "");
  const form = document.getElementById("index-builder");
  const title = document.getElementById("index-title");
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
  const titleSummary = document.getElementById("summary-title");
  const requestPanel = document.getElementById("request-result");
  const requestHash = document.getElementById("request-hash");
  const requestJson = document.getElementById("request-json");
  const formError = document.getElementById("form-error");
  const runButton = document.getElementById("run-index");
  const copyButton = document.getElementById("copy-request");
  const downloadButton = document.getElementById("download-request");
  const jobHeading = document.getElementById("job-heading");
  const jobMessage = document.getElementById("job-message");
  const jobStatus = document.getElementById("job-status");
  const jobProgress = document.getElementById("job-progress");
  const jobStage = document.getElementById("job-stage");
  const jobProgressBar = document.getElementById("job-progress-bar");
  const jobProgressCount = document.getElementById("job-progress-count");
  const resultPanel = document.getElementById("index-result");
  const resultTitle = document.getElementById("result-title");
  const resultReplay = document.getElementById("result-replay");
  const resultCount = document.getElementById("result-count");
  const resultHash = document.getElementById("result-hash");
  const resultHoldings = document.getElementById("result-holdings");
  const downloadArtifact = document.getElementById("download-artifact");
  const copyResultLink = document.getElementById("copy-result-link");
  const gateRequest = document.getElementById("gate-request");
  const gateRun = document.getElementById("gate-run");
  const gateReplay = document.getElementById("gate-replay");
  const contractStatus = document.getElementById("contract-status");
  let lastEnvelope = null;
  let lastArtifact = null;
  let activeJobId = null;
  let pollTimer = null;

  function currentInput() {
    const isDefault = model.value === "qwen-3.8-27b";
    return {
      title: title.value,
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
    return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function refreshSummary() {
    const input = currentInput();
    cutoffOutput.value = String(input.relevance_cutoff);
    cutoffSummary.textContent = `${input.relevance_cutoff} / 100`;
    rebalanceSummary.textContent = titleCase(input.rebalance_frequency);
    weightingSummary.textContent = input.weighting === "fundamental" ? "Fundamental" : "Market cap";
    modelSummary.textContent = model.value === "qwen-3.8-27b" ? "Qwen 3.8 27B" : (input.model_id || "Custom model");
    titleSummary.textContent = contract.normalizePhrase(input.title) || "Untitled index";
    phraseSummary.textContent = contract.normalizePhrase(input.phrase) || "Your index mandate will appear here.";
    customModel.hidden = model.value !== "custom";
    if (!activeJobId) {
      requestPanel.hidden = true;
      resultPanel.hidden = true;
      lastEnvelope = null;
      lastArtifact = null;
    }
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

  async function fetchJson(path, options) {
    if (!apiBase || apiBase.includes("__CORBANU")) throw new Error("The local index operator is not connected.");
    const response = await fetch(`${apiBase}${path}`, options);
    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      throw new Error(`Index operator returned HTTP ${response.status}.`);
    }
    if (!response.ok) throw new Error(payload.error || `Index operator returned HTTP ${response.status}.`);
    return payload;
  }

  function setGate(state) {
    [gateRequest, gateRun, gateReplay].forEach((element) => element.classList.remove("active", "complete"));
    gateRequest.classList.add("complete");
    if (["running", "valid"].includes(state.status)) gateRun.classList.add("complete");
    else if (state.status === "queued") gateRun.classList.add("active");
    if (state.status === "valid") gateReplay.classList.add("complete");
    else if (state.stage === "scoring_primary_and_replay" || state.stage === "constructing_weights") gateReplay.classList.add("active");
  }

  function setJobState(state) {
    activeJobId = state.job_id;
    requestHash.textContent = state.request_sha256 || "";
    const completed = Number((state.progress || {}).completed || 0);
    const total = Number((state.progress || {}).total || 0);
    const percent = total ? Math.min(100, Math.round(completed / total * 100)) : 0;
    requestPanel.hidden = false;
    jobProgress.hidden = false;
    jobHeading.textContent = state.status === "valid" ? "Index created" : "Index job running";
    jobMessage.textContent = state.status === "queued"
      ? "The request is frozen and waiting for the local operator."
      : state.status === "valid"
        ? "Primary execution and independent replay matched."
        : state.status === "failed"
          ? (state.error || "The job failed.")
          : "The two H200s are producing and replaying the company scores.";
    jobStatus.textContent = titleCase(state.status);
    jobStatus.dataset.status = state.status;
    contractStatus.textContent = state.status === "valid" ? "Valid" : titleCase(state.status);
    contractStatus.dataset.status = state.status;
    jobStage.textContent = titleCase(state.stage);
    jobProgressBar.style.width = `${percent}%`;
    jobProgressCount.textContent = `${completed} / ${total}`;
    setGate(state);
    runButton.disabled = ["queued", "running"].includes(state.status);
    runButton.textContent = runButton.disabled ? "Index running…" : "Run index";
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([`${contract.prettyCanonical(payload)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function renderArtifact(artifact) {
    lastArtifact = artifact;
    resultTitle.textContent = artifact.index_title;
    resultReplay.textContent = `${artifact.replay_proof.byte_identical_count} / ${artifact.replay_proof.comparison_count} byte-identical`;
    resultCount.textContent = String(artifact.constituent_count);
    resultHash.textContent = artifact.artifact_sha256;
    resultHoldings.replaceChildren();
    artifact.holdings.slice(0, 30).forEach((holding, index) => {
      const row = document.createElement("tr");
      const rankCell = document.createElement("td");
      rankCell.textContent = String(index + 1);
      const companyCell = document.createElement("td");
      const tickerText = document.createElement("strong");
      tickerText.textContent = holding.ticker;
      const nameText = document.createElement("small");
      nameText.textContent = holding.company_name;
      companyCell.append(tickerText, nameText);
      const scoreCell = document.createElement("td");
      scoreCell.textContent = String(holding.score);
      const weightCell = document.createElement("td");
      weightCell.textContent = `${Number(holding.weight_percent).toFixed(2)}%`;
      const reasoningCell = document.createElement("td");
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Inspect";
      const reasoning = document.createElement("div");
      reasoning.className = "reasoning-block";
      (holding.reasoning_block || []).forEach((paragraph) => {
        const text = document.createElement("p");
        text.textContent = paragraph;
        reasoning.appendChild(text);
      });
      details.append(summary, reasoning);
      reasoningCell.appendChild(details);
      row.append(rankCell, companyCell, scoreCell, weightCell, reasoningCell);
      resultHoldings.appendChild(row);
    });
    resultPanel.hidden = false;
    const location = new URL(window.location.href);
    location.searchParams.set("job", artifact.job_id);
    window.history.replaceState({}, "", location);
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadArtifact(jobId) {
    const artifact = await fetchJson(`/v1/indexes/${encodeURIComponent(jobId)}/artifact`);
    renderArtifact(artifact);
  }

  async function pollJob(jobId) {
    window.clearTimeout(pollTimer);
    try {
      const state = await fetchJson(`/v1/indexes/${encodeURIComponent(jobId)}`);
      setJobState(state);
      if (state.status === "valid") {
        await loadArtifact(jobId);
        return;
      }
      if (state.status === "failed") {
        formError.textContent = state.error || "The index run failed.";
        return;
      }
      pollTimer = window.setTimeout(() => pollJob(jobId), 4000);
    } catch (error) {
      formError.textContent = error.message;
      runButton.disabled = false;
      runButton.textContent = "Run index";
    }
  }

  form.addEventListener("input", refreshSummary);
  form.addEventListener("change", refreshSummary);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError.textContent = "";
    resultPanel.hidden = true;
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
      runButton.disabled = true;
      runButton.textContent = "Creating job…";
      const state = await fetchJson("/v1/indexes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lastEnvelope),
      });
      setJobState(state);
      requestPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      await pollJob(state.job_id);
    } catch (error) {
      formError.textContent = error.message;
      formError.focus();
      runButton.disabled = false;
      runButton.textContent = "Run index";
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
    if (lastEnvelope) downloadJson(`${lastEnvelope.request_id}.json`, lastEnvelope);
  });

  downloadArtifact.addEventListener("click", () => {
    if (lastArtifact) downloadJson(`${lastArtifact.job_id}-artifact.json`, lastArtifact);
  });

  copyResultLink.addEventListener("click", async () => {
    try {
      await copyText(window.location.href);
      copyResultLink.textContent = "Copied";
      window.setTimeout(() => { copyResultLink.textContent = "Copy result link"; }, 1600);
    } catch (_error) {
      formError.textContent = "Could not copy the result link.";
    }
  });

  refreshSummary();
  const requestedJob = new URLSearchParams(window.location.search).get("job");
  if (requestedJob && /^idx_[0-9a-f]{16}$/.test(requestedJob)) {
    requestPanel.hidden = false;
    pollJob(requestedJob);
  }
}());
