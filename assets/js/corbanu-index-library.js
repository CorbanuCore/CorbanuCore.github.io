(function () {
  "use strict";

  const config = window.CorbanuIndexConfig || {};
  const apiBase = String(config.apiBase || "").replace(/\/$/, "");
  const count = document.getElementById("index-count");
  const status = document.getElementById("library-status");
  const list = document.getElementById("index-library-grid");

  function compactHash(value) {
    const text = String(value || "");
    return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-8)}` : text;
  }

  function formatDate(epoch, compact = false) {
    if (!epoch) return "Unknown";
    return new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
      ...(compact ? {} : { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
      timeZone: "UTC",
    }).format(new Date(Number(epoch) * 1000));
  }

  function formatWeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `${number.toFixed(number >= 10 ? 2 : 3)}%`;
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

  function appendTextCell(row, text, className = "") {
    const cell = document.createElement("td");
    cell.className = className;
    cell.textContent = String(text);
    row.appendChild(cell);
  }

  function renderReasoning(holding) {
    const details = document.createElement("details");
    details.className = "holding-reasoning";
    const summary = document.createElement("summary");
    summary.textContent = "Why this score";
    const body = document.createElement("div");
    for (const paragraph of holding.reasoning_block || []) {
      const text = document.createElement("p");
      text.textContent = paragraph;
      body.appendChild(text);
    }
    details.append(summary, body);
    return details;
  }

  function renderWeightChart(holdings) {
    const section = document.createElement("section");
    section.className = "holdings-chart";
    const header = document.createElement("header");
    const title = document.createElement("h4");
    title.textContent = "Portfolio weights";
    const note = document.createElement("span");
    const visible = holdings.slice(0, 20);
    note.textContent = holdings.length > 20 ? `Top 20 of ${holdings.length}` : `${holdings.length} constituents`;
    header.append(title, note);

    const chart = document.createElement("div");
    chart.className = "weight-chart";
    const maxWeight = Math.max(...visible.map((holding) => Number(holding.weight_percent) || 0), 1);
    visible.forEach((holding, index) => {
      const item = document.createElement("div");
      item.className = "weight-row";
      const rank = document.createElement("span");
      rank.className = "weight-rank";
      rank.textContent = String(index + 1).padStart(2, "0");
      const ticker = document.createElement("strong");
      ticker.textContent = holding.ticker;
      ticker.title = holding.company_name;
      const track = document.createElement("span");
      track.className = "weight-track";
      const bar = document.createElement("i");
      bar.style.width = `${Math.max(1.5, ((Number(holding.weight_percent) || 0) / maxWeight) * 100)}%`;
      track.appendChild(bar);
      const value = document.createElement("b");
      value.textContent = formatWeight(holding.weight_percent);
      item.append(rank, ticker, track, value);
      chart.appendChild(item);
    });
    section.append(header, chart);
    return section;
  }

  function renderHoldingsTable(holdings) {
    const wrap = document.createElement("div");
    wrap.className = "library-holdings-table-wrap";
    const table = document.createElement("table");
    table.className = "library-holdings-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["#", "Holding", "Score", "Confidence", "Weight", "Evidence"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    const body = document.createElement("tbody");
    holdings.forEach((holding, index) => {
      const row = document.createElement("tr");
      appendTextCell(row, index + 1, "holding-rank");
      const identity = document.createElement("td");
      const ticker = document.createElement("strong");
      ticker.textContent = holding.ticker;
      const company = document.createElement("small");
      company.textContent = holding.company_name;
      identity.append(ticker, company);
      row.appendChild(identity);
      appendTextCell(row, holding.score, "holding-score");
      appendTextCell(row, holding.confidence);
      appendTextCell(row, formatWeight(holding.weight_percent), "holding-weight");
      const evidence = document.createElement("td");
      evidence.appendChild(renderReasoning(holding));
      row.appendChild(evidence);
      body.appendChild(row);
    });
    table.append(head, body);
    wrap.appendChild(table);
    return wrap;
  }

  function renderArtifact(detail, artifact) {
    const holdings = Array.from(artifact.holdings || []).sort(
      (left, right) => Number(right.weight_percent) - Number(left.weight_percent),
    );
    const content = document.createElement("div");
    content.className = "library-detail-grid";
    content.append(renderWeightChart(holdings), renderHoldingsTable(holdings));
    detail.replaceChildren(content);
  }

  function renderIndex(row, index) {
    const article = document.createElement("article");
    article.className = "library-row";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "library-row-toggle";
    toggle.setAttribute("aria-expanded", "false");
    const detailId = `holdings-${row.job_id}`;
    toggle.setAttribute("aria-controls", detailId);

    const rank = document.createElement("span");
    rank.className = "library-row-rank";
    rank.textContent = String(index + 1).padStart(2, "0");
    const identity = document.createElement("span");
    identity.className = "library-row-identity";
    const title = document.createElement("strong");
    title.textContent = row.index_title;
    const mandate = document.createElement("small");
    mandate.textContent = row.index_mandate;
    identity.append(title, mandate);

    const holdings = document.createElement("span");
    holdings.className = "library-row-stat";
    holdings.append(document.createTextNode(String(row.constituent_count)));
    const holdingsLabel = document.createElement("small");
    holdingsLabel.textContent = "holdings";
    holdings.appendChild(holdingsLabel);

    const cutoff = document.createElement("span");
    cutoff.className = "library-row-stat";
    cutoff.append(document.createTextNode(String(row.relevance_cutoff)));
    const cutoffLabel = document.createElement("small");
    cutoffLabel.textContent = "cutoff";
    cutoff.appendChild(cutoffLabel);

    const replay = document.createElement("span");
    replay.className = "library-row-replay";
    replay.append(document.createTextNode(`${row.replay_proof.byte_identical_count}/${row.replay_proof.comparison_count}`));
    const replayLabel = document.createElement("small");
    replayLabel.textContent = "byte exact";
    replay.appendChild(replayLabel);

    const date = document.createElement("span");
    date.className = "library-row-date";
    date.textContent = formatDate(row.completed_at_unix, true);

    const affordance = document.createElement("span");
    affordance.className = "library-row-affordance";
    const affordanceText = document.createElement("span");
    affordanceText.textContent = "Expand holdings";
    const arrow = document.createElement("i");
    arrow.setAttribute("aria-hidden", "true");
    affordance.append(affordanceText, arrow);
    toggle.append(rank, identity, holdings, cutoff, replay, date, affordance);

    const detail = document.createElement("section");
    detail.id = detailId;
    detail.className = "library-row-detail";
    detail.hidden = true;

    const utility = document.createElement("div");
    utility.className = "library-row-utility";
    const proof = document.createElement("span");
    proof.textContent = `Strict replay · batch ${row.replay_proof.batch_byte_identical_count}/${row.replay_proof.comparison_count} · zero retries · artifact ${compactHash(row.artifact_sha256)}`;
    const actions = document.createElement("div");
    const inspect = document.createElement("a");
    inspect.href = `/indexes/?job=${encodeURIComponent(row.job_id)}`;
    inspect.textContent = "Open run";
    const recipe = action("Replay recipe", "", (event) => download(event.currentTarget, row, "recipe"));
    const artifact = action("Full artifact", "quiet", (event) => download(event.currentTarget, row, "artifact"));
    actions.append(inspect, recipe, artifact);
    utility.append(proof, actions);
    detail.appendChild(utility);

    let loaded = false;
    toggle.addEventListener("click", async () => {
      const opening = detail.hidden;
      detail.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      affordanceText.textContent = opening ? "Collapse" : "Expand holdings";
      if (!opening || loaded) return;
      const loading = document.createElement("p");
      loading.className = "holdings-loading";
      loading.textContent = "Loading holdings and weights…";
      detail.appendChild(loading);
      try {
        const payload = await fetchJson(row.artifact_path);
        renderArtifact(detail, payload);
        detail.prepend(utility);
        loaded = true;
      } catch (error) {
        loading.textContent = error.message;
        loading.dataset.state = "error";
      }
    });

    article.append(toggle, detail);
    return article;
  }

  async function loadRegistry() {
    try {
      const registry = await fetchJson("/v1/indexes");
      count.textContent = String(registry.index_count);
      list.replaceChildren(...registry.indexes.map(renderIndex));
      status.textContent = registry.index_count
        ? `${registry.index_count} strict replay artifact${registry.index_count === 1 ? "" : "s"}, newest first.`
        : "No strict replay artifacts have been published yet.";
      status.dataset.state = "ready";
    } catch (error) {
      status.textContent = error.message;
      status.dataset.state = "error";
    }
  }

  loadRegistry();
}());
