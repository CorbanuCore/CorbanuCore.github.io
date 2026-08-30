(function () {
  "use strict";

  const config = window.CorbanuIndexConfig || {};
  const apiBase = String(config.apiBase || "").replace(/\/$/, "");
  const count = document.getElementById("index-count");
  const status = document.getElementById("library-status");
  const grid = document.getElementById("index-library-grid");

  function compactHash(value) {
    const text = String(value || "");
    return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-8)}` : text;
  }

  function formatDate(epoch) {
    if (!epoch) return "Unknown date";
    return new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(Number(epoch) * 1000));
  }

  async function fetchJson(path) {
    if (!apiBase || apiBase.includes("__CORBANU")) throw new Error("The index registry is not connected.");
    const response = await fetch(`${apiBase}${path}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error((payload && payload.error) || `Registry returned HTTP ${response.status}.`);
    return payload;
  }

  function saveJson(filename, payload) {
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function metric(label, value) {
    const item = document.createElement("div");
    const name = document.createElement("span");
    const result = document.createElement("strong");
    name.textContent = label;
    result.textContent = String(value);
    item.append(name, result);
    return item;
  }

  function action(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  async function download(button, row, kind) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Preparing…";
    try {
      const path = kind === "recipe" ? row.replay_recipe_path : row.artifact_path;
      const payload = await fetchJson(path);
      saveJson(`${row.job_id}-${kind}.json`, payload);
      button.textContent = "Downloaded";
    } catch (error) {
      button.textContent = "Download failed";
      status.textContent = error.message;
      status.dataset.state = "error";
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 1600);
    }
  }

  function renderIndex(row) {
    const article = document.createElement("article");
    article.className = "library-card";

    const head = document.createElement("header");
    const identity = document.createElement("div");
    const label = document.createElement("span");
    const title = document.createElement("h3");
    label.className = "library-card-label";
    label.textContent = `${row.constituent_count} holdings · cutoff ${row.relevance_cutoff}`;
    title.textContent = row.index_title;
    identity.append(label, title);
    const profile = document.createElement("span");
    profile.className = "profile-badge current";
    profile.textContent = "Strict replay";
    head.append(identity, profile);

    const mandate = document.createElement("p");
    mandate.className = "library-mandate";
    mandate.textContent = row.index_mandate;

    const metrics = document.createElement("div");
    metrics.className = "library-metrics";
    metrics.append(
      metric("Byte replay", `${row.replay_proof.byte_identical_count} / ${row.replay_proof.comparison_count}`),
      metric("Batch exact", `${row.replay_proof.batch_byte_identical_count} / ${row.replay_proof.comparison_count}`),
      metric("Strict retries", row.replay_proof.strict_retry_count),
      metric("Completed", formatDate(row.completed_at_unix)),
    );

    const hashes = document.createElement("dl");
    hashes.className = "library-hashes";
    const artifactTerm = document.createElement("dt");
    artifactTerm.textContent = "Artifact";
    const artifactValue = document.createElement("dd");
    artifactValue.textContent = compactHash(row.artifact_sha256);
    artifactValue.title = row.artifact_sha256;
    const universeTerm = document.createElement("dt");
    universeTerm.textContent = "Universe";
    const universeValue = document.createElement("dd");
    universeValue.textContent = compactHash(row.universe.universe_sha256);
    universeValue.title = row.universe.universe_sha256;
    hashes.append(artifactTerm, artifactValue, universeTerm, universeValue);

    const actions = document.createElement("div");
    actions.className = "library-actions";
    const inspect = document.createElement("a");
    inspect.href = `/indexes/?job=${encodeURIComponent(row.job_id)}`;
    inspect.textContent = "Inspect holdings";
    inspect.className = "primary";
    const recipeButton = action("Download replay recipe", "", (event) => download(event.currentTarget, row, "recipe"));
    const artifactButton = action("Full artifact", "quiet", (event) => download(event.currentTarget, row, "artifact"));
    actions.append(inspect, recipeButton, artifactButton);

    const footer = document.createElement("footer");
    const job = document.createElement("code");
    const model = document.createElement("code");
    job.textContent = row.job_id;
    model.textContent = row.model.execution_profile;
    footer.append(job, model);

    article.append(head, mandate, metrics, hashes, actions, footer);
    return article;
  }

  async function loadRegistry() {
    try {
      const registry = await fetchJson("/v1/indexes");
      count.textContent = String(registry.index_count);
      grid.replaceChildren(...registry.indexes.map(renderIndex));
      status.textContent = registry.index_count
        ? `${registry.index_count} verified index artifacts, newest first.`
        : "No valid index artifacts have been published yet.";
      status.dataset.state = "ready";
    } catch (error) {
      status.textContent = error.message;
      status.dataset.state = "error";
    }
  }

  loadRegistry();
}());
