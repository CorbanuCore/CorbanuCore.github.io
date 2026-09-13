(function () {
  "use strict";
  if (new URLSearchParams(window.location.search).has("index")) return;
  const form = document.getElementById("index-builder");
  if (!form) return;
  const el = id => document.getElementById(id);
  const api = "https://api.corbanu.com";
  function walletStatus() {
    const account = window.CorbanuWallet.account;
    el("builder-connect-wallet").textContent = account ? "Change or reconnect MetaMask" : "Connect MetaMask";
    el("builder-wallet-status").textContent = account ? `Connected: ${account}` : "MetaMask is not connected.";
  }
  window.addEventListener("corbanu:wallet-changed", () => { if (document.getElementById("builder-wallet-status")) walletStatus(); });
  el("builder-connect-wallet").addEventListener("click", async () => {
    el("builder-connect-wallet").disabled = true;
    try { await window.CorbanuWallet.connect(); walletStatus(); }
    catch (e) { el("builder-wallet-status").textContent = e.code === 4001 ? "Wallet connection was declined. You can try again." : e.message; }
    finally { el("builder-connect-wallet").disabled = false; }
  });
  let catalog = null, pending = null, busy = false, timer = null, preview = null, locked = null;
  let activeId = new URLSearchParams(window.location.search).get("preview");
  const names = {"corbanu/deepseek-v4.1-flash":"DeepSeek V4.1 Flash", "corbanu/glm-5.3":"GLM 5.3", "corbanu/glm-5.3-flash":"GLM 5.3 Flash"};
  function error(message = "") { el("form-error").textContent = message; }
  function controls() {
    el("builder-settings").disabled = !catalog || busy || !!activeId || !!pending;
    el("run-index").disabled = !catalog || busy || !!preview;
    el("run-index").textContent = busy ? "Working…" : activeId ? "Resume preview" : pending ? "Retry same preview" : "Run preview";
    el("lock-index").disabled = busy || !preview?.preview_sha256 || preview.status !== "completed" || !!locked;
    el("refresh-preview").disabled = busy;
    el("new-preview").hidden = busy || !(preview || locked);
    el("open-basket").hidden = !locked;
  }
  function options(id, values, selected) {
    const select = el(id); select.replaceChildren();
    for (const value of values) {
      const option = document.createElement("option");
      option.value = typeof value === "string" ? value : value.id;
      option.textContent = typeof value === "string" ? names[value] || value : value.label;
      select.append(option);
    }
    if (selected && Array.from(select.options).some(o => o.value === selected)) select.value = selected;
  }
  function settings() {
    el("custom-prompt-fields").hidden = el("prompt-choice").value !== "custom";
    el("custom-prompt").required = !el("custom-prompt-fields").hidden;
    if (el("external-funds").checked) el("deterministic").checked = true;
    if (el("deterministic").checked) el("model-choice").value = catalog.deterministic_default_model;
    el("model-choice").disabled = el("deterministic").checked;
    el("summary-title").textContent = el("index-title").value.trim() || "Untitled index";
    el("summary-phrase").textContent = el("index-phrase").value.trim() || "Your index mandate will appear here.";
  }
  async function request(path, body, requestId, authenticated = true) {
    const headers = {};
    if (authenticated) {
      const key = el("builder-api-key").value.trim();
      if (!key) throw new Error("Enter your Corbanu API key to continue.");
      headers.Authorization = `Bearer ${key}`;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (requestId) headers["X-Corbanu-Request-Id"] = requestId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), body !== undefined && !requestId ? 90000 : 30000);
    try {
      const response = await fetch(api + path, {method: body === undefined ? "GET" : "POST", headers,
        ...(body !== undefined ? {body: JSON.stringify(body)} : {}), signal: controller.signal, cache: "no-store"});
      let value;
      try { value = await response.json(); } catch { value = {}; }
      if (!response.ok) {
        const e = new Error(value.error || `Request failed (${response.status})`); e.status = response.status; throw e;
      }
      return value;
    } finally { clearTimeout(timeout); }
  }
  async function loadCatalog() {
    el("reload-catalog").hidden = true;
    try {
      const c = await request("/v2/indexes/catalog", undefined, undefined, false);
      if (c.schema !== "corbanu.index-workflow.v1" || !c.models?.length || !c.prompts?.length || !c.reasoning_efforts?.length || !c.disclosure?.version || !c.disclosure_sha256) throw new Error("The index service returned incomplete options.");
      catalog = c;
      options("model-choice", c.models, c.deterministic_default_model);
      options("prompt-choice", c.prompts, "thematic_v1");
      options("reasoning-effort", c.reasoning_efforts, "high");
      el("creator-disclosure").replaceChildren();
      for (const name of ["market_opinion", "indemnity", "token_exposure", "publication"]) {
        const p = document.createElement("p"); p.textContent = c.disclosure[name]; el("creator-disclosure").append(p);
      }
      el("accept-disclosure").checked = false;
      el("deterministic").disabled = !c.deterministic_available;
      el("external-funds").disabled = !c.deterministic_available;
      el("replay-availability").textContent = c.deterministic_available ? "Sharing and external funds require verified replay using DeepSeek V4.1 Flash." : "Deterministic replay is currently unavailable. Personal previews are available; public sharing and external funds are disabled.";
      el("catalog-status").textContent = activeId ? "Enter your API key to resume this preview." : "Connected to Corbanu. Choose your settings to preview a Felix basket.";
      settings();
    } catch (e) { el("catalog-status").textContent = e.message; el("reload-catalog").hidden = false; }
    controls();
  }
  function buildRequest() {
    const body = {mandate:{title:el("index-title").value.trim(),phrase:el("index-phrase").value.trim()},
      model:el("model-choice").value,prompt_id:el("prompt-choice").value,reasoning_effort:el("reasoning-effort").value,
      deterministic:el("deterministic").checked,external_funds:el("external-funds").checked,
      weighting:el("weighting-choice").value,relevance_cutoff:Number(el("relevance-cutoff").value),
      disclosure:{version:catalog.disclosure.version,sha256:catalog.disclosure_sha256,accepted:el("accept-disclosure").checked,conflicts:el("creator-conflicts").value.trim()}};
    if (!body.disclosure.accepted || !body.disclosure.conflicts) throw new Error("Accept the disclosure and state your material conflicts, or explicitly none.");
    if (!body.weighting || !el("relevance-cutoff").value) throw new Error("Select weighting and minimum relevance.");
    if (body.prompt_id === "custom") {
      body.prompt = el("custom-prompt").value.trim();
      if (!body.prompt) throw new Error("Enter your custom scoring instructions.");
    }
    if (el("user-inputs").value.trim()) {
      let inputs;
      try { inputs = JSON.parse(el("user-inputs").value); } catch { throw new Error("Source information must be valid JSON."); }
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) || Object.values(inputs).some(v => typeof v !== "string")) throw new Error("Source information must map security IDs to text.");
      body.user_inputs = inputs;
    }
    return body;
  }
  function rememberId(id) {
    activeId = id;
    const url = new URL(window.location.href); url.searchParams.set("preview", id); url.searchParams.delete("index");
    window.history.replaceState({}, "", url);
    el("resume-link").href = url.toString();
    el("request-result").hidden = false;
  }
  function render(value) {
    el("job-status").textContent = value.status;
    const messages = [`${value.progress?.scored || 0} / ${value.progress?.total || 0} companies scored.`];
    const run = value.execution_runs?.at(-1);
    if (value.status === "running") {
      messages.push(Number.isInteger(run?.concurrency) ? `Scoring with up to ${run.concurrency} parallel requests.` : "Scoring is running.");
      if (value.error) messages.push("Scoring resumed after an earlier error. Saved scores are being reused.");
    } else if (value.status === "queued") {
      messages.push(value.error ? "Paused before an automatic retry. Completed scores are saved." : "Waiting for a scoring worker.");
    }
    if (value.reasoning_effort) messages.push(`Reasoning: ${value.reasoning_effort}.`);
    const started = Date.parse(value.created_at);
    if (["queued", "running"].includes(value.status) && Number.isFinite(started) && started <= Date.now())
      messages.push(`Elapsed: ${Math.floor((Date.now() - started) / 60000)} min.`);
    if (value.error && value.status !== "running") messages.push(value.error);
    el("job-message").textContent = messages.join(" ");
    el("job-retry-detail").hidden = !value.error || value.status !== "running";
    el("job-retry-error").textContent = value.error || "";
    if (["queued", "running"].includes(value.status)) return;
    preview = value;
    if (value.status === "failed") { error(value.error || "Preview failed. You can start a new preview."); return; }
    const payload = value.preview?.payload;
    if (!payload?.construction) throw new Error("The completed preview is missing its holdings.");
    el("index-result").hidden = false;
    el("result-title").textContent = payload.request.mandate.title;
    el("summary-title").textContent = payload.request.mandate.title;
    el("summary-phrase").textContent = payload.request.mandate.phrase;
    const weights = payload.construction.weights || [];
    el("result-count").textContent = `${weights.length} holdings`;
    el("result-assurance").textContent = payload.validity.independent_inference_replay ? "Independent replay verified." : "Provider-backed result. Deterministic inference has not been verified.";
    el("result-holdings").replaceChildren();
    for (const row of weights) {
      const tr = document.createElement("tr");
      for (const text of [row.company_name || row.ticker, row.representation?.venue_symbol || row.security_id, String(row.score), `${(row.weight_units / 1e10).toFixed(2)}%`]) {
        const td = document.createElement("td"); td.textContent = text; tr.append(td);
      }
      el("result-holdings").append(tr);
    }
    el("result-exclusions").replaceChildren();
    for (const row of [...(payload.construction.excluded || []), ...(payload.construction.issues || [])]) {
      const p = document.createElement("p"); p.textContent = `${row.ticker || row.security_id || "Construction issue"}: ${row.error}`; el("result-exclusions").append(p);
    }
    el("preview-json").textContent = JSON.stringify(value.preview, null, 2);
    if (value.status === "needs_data") error("This preview needs additional data and cannot be locked. Review the reported issues.");
  }
  async function poll() {
    clearTimeout(timer);
    const id = activeId;
    if (!id) return;
    try {
      const value = await request(`/v2/indexes/previews/${encodeURIComponent(id)}`);
      if (id !== activeId) return;
      error(); render(value);
      if (["queued", "running"].includes(value.status)) timer = setTimeout(() => void poll(), 5000);
    } catch (e) { if (id === activeId) error(`${e.message} Use Refresh status to resume; no new preview will be created.`); }
    controls();
  }
  form.addEventListener("input", event => {
    if (event.target === el("deterministic") && !el("deterministic").checked) el("external-funds").checked = false;
    if (catalog && !pending && !activeId) settings();
  });
  el("deterministic").addEventListener("change", () => { if (!el("deterministic").checked) el("external-funds").checked = false; settings(); });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !catalog) return;
    if (!form.reportValidity()) return;
    error();
    if (activeId) { rememberId(activeId); await poll(); return; }
    try {
      if (!pending) pending = {id:crypto.randomUUID(),body:buildRequest()};
      busy = true; controls();
      const value = await request("/v2/indexes/previews", pending.body, pending.id);
      if (typeof value.id !== "string" || !value.id) throw new Error("The service did not return a preview ID. Retry this same request.");
      rememberId(value.id); pending = null; render(value);
      await poll();
    } catch (e) {
      if ([400, 409, 413, 422].includes(e.status)) pending = null;
      error(`${e.message}${pending ? " Keep this page open and retry; the same request ID prevents a duplicate job." : ""}`);
    } finally { busy = false; controls(); }
  });
  el("refresh-preview").addEventListener("click", () => void poll());
  el("reload-catalog").addEventListener("click", () => void loadCatalog());
  el("new-preview").addEventListener("click", () => {
    clearTimeout(timer); activeId = null; preview = null; pending = null; locked = null;
    const url = new URL(window.location.href); url.searchParams.delete("preview"); window.history.replaceState({}, "", url);
    el("request-result").hidden = true; el("index-result").hidden = true; error(); controls(); settings();
  });
  el("lock-index").addEventListener("click", async () => {
    if (busy || !preview?.preview_sha256 || preview.status !== "completed") return;
    busy = true; error(); controls();
    try {
      locked = await request(`/v2/indexes/${encodeURIComponent(activeId)}/lock`, {preview_sha256:preview.preview_sha256});
      if (locked.state !== "locked" && locked.state !== "published") { locked = null; throw new Error("Pinning is not complete. Retry confirmation to resume."); }
      el("job-status").textContent = "locked";
      el("job-message").textContent = "Index locked and pinned on IPFS. Open the basket to connect your wallet.";
    } catch (e) { error(`${e.message} Retry confirmation to resume the same lock.`); }
    finally { busy = false; controls(); }
  });
  el("open-basket").addEventListener("click", () => {
    if (!locked) return;
    clearTimeout(timer);
    window.CorbanuIndexSession = {key:el("builder-api-key").value.trim()};
    const url = new URL(window.location.href); url.searchParams.delete("preview"); url.searchParams.set("index", activeId);
    window.history.replaceState({}, "", url);
    window.dispatchEvent(new Event("corbanu:index-locked"));
  });
  window.addEventListener("pagehide", () => clearTimeout(timer));
  if (activeId) rememberId(activeId);
  void loadCatalog();
})();
