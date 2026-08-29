(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const money = (value) => value == null ? "—" : `$${Number(value).toFixed(2)}`;
  const date = (value) => value ? new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(value)) + " UTC" : "Unavailable";

  function renderGpu(market) {
    $("gpu-grid").innerHTML = market.metrics.map(row => `
      <article class="gpu-cell">
        <div class="sku"><span>${escapeHtml(row.sku)}</span><span>${escapeHtml(row.status)}</span></div>
        <div class="price">${money(row.capacityWeightedMedian)} <small>/ hr</small></div>
        <div class="capacity">${row.availableGpuCount.toLocaleString()} GPUs · ${row.machineCount.toLocaleString()} machines</div>
        <div class="range">P10 ${money(row.p10)} &nbsp; / &nbsp; P90 ${money(row.p90)}</div>
      </article>`).join("");
  }

  function renderCard(item) {
    const source = item.source?.url ? `<a class="card-source" href="${escapeHtml(item.source.url)}" rel="noopener">${escapeHtml(item.source.name)} ↗</a>` : "";
    const change = item.change == null ? "" : `<span class="change">${item.change > 0 ? "+" : ""}${escapeHtml(item.change)} ${escapeHtml(item.change_unit || "")}</span>`;
    return `<article class="card">
      <div class="card-top"><span class="tier">TIER ${item.tier}</span><span class="pill ${escapeHtml(item.state)}">${escapeHtml(item.state)}</span></div>
      <h3>${escapeHtml(item.label)}</h3><p class="card-value">${escapeHtml(item.display_value)}${change}</p>
      <p class="card-note">${escapeHtml(item.note || item.interpretation)}</p>
      <details><summary>Threshold and source</summary><p>${escapeHtml(item.threshold || "No locked threshold")}</p><p>Observed ${escapeHtml(date(item.observed_at))} · ${escapeHtml(item.freshness)}</p>${source}</details>
    </article>`;
  }

  function renderChart(item) {
    const svg = $("gpu-chart");
    const values = (item?.history || []).filter(p => Number.isFinite(Number(p.value)));
    if (!values.length) { svg.innerHTML = '<text x="20" y="100" fill="#747b71" font-family="monospace">First observation collected. Trend line will build every 15 minutes.</text>'; return; }
    const width=900,height=210,pad=25, nums=values.map(p=>Number(p.value));
    let min=Math.min(...nums),max=Math.max(...nums); if(min===max){min*=.95;max*=1.05}
    const points=values.map((p,i)=>`${pad+(i/Math.max(1,values.length-1))*(width-2*pad)},${height-pad-((Number(p.value)-min)/(max-min))*(height-2*pad)}`).join(" ");
    svg.innerHTML=`<line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" stroke="#293027"/><polyline points="${points}" fill="none" stroke="#ccff00" stroke-width="3" vector-effect="non-scaling-stroke"/><circle cx="${points.split(" ").at(-1).split(",")[0]}" cy="${points.split(" ").at(-1).split(",")[1]}" r="5" fill="#ccff00"/><text x="${pad}" y="18" fill="#9ba297" font-size="12" font-family="monospace">${money(max)}</text><text x="${pad}" y="${height-5}" fill="#9ba297" font-size="12" font-family="monospace">${money(min)}</text>`;
    $("chart-note").textContent=`${values.length} observations · ${item.change == null ? "baseline building" : item.change+"% from observed high"}`;
  }

  function installFilters(indicators) {
    const tier = $("tier-filter"), state = $("state-filter"), fresh = $("fresh-filter");
    const render = () => {
      const filtered = indicators.filter(item =>
        (tier.value === "all" || String(item.tier) === tier.value) &&
        (state.value === "all" || item.state === state.value) &&
        (fresh.value === "all" || item.freshness === fresh.value));
      const empty = '<article class="card"><p class="card-note">No indicators match these filters.</p></article>';
      $("leading-cards").innerHTML = filtered.filter(x=>x.column==="leading").map(renderCard).join("") || empty;
      $("confirming-cards").innerHTML = filtered.filter(x=>x.column==="confirming").map(renderCard).join("") || empty;
    };
    [tier,state,fresh].forEach(control => control.addEventListener("change", render));
    $("clear-filters").addEventListener("click", () => { tier.value=state.value=fresh.value="all"; render(); });
    render();
  }

  fetch("/assets/market-data/ai-capital-stack.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(data=>{
    $("verdict").dataset.state=data.composite.state; $("verdict").textContent=data.headline;
    $("summary").textContent=data.summary; $("generated").textContent=`Updated ${date(data.generatedAt)}`;
    renderGpu(data.gpuMarket);
    installFilters(data.indicators);
    renderChart(data.indicators.find(x=>x.indicator_id==="vast_h100_rental"));
    $("methodology").innerHTML=`<p>${escapeHtml(data.methodology.gpuPrice)}</p><p><strong>Critical:</strong> ${escapeHtml(data.methodology.criticalRule)}</p><p>${escapeHtml(data.methodology.limitations)}</p>`;
  }).catch(error=>{$("verdict").dataset.state="alert";$("verdict").textContent="Data unavailable";$("summary").textContent=`The monitor payload could not be loaded (${error.message}).`;});
})();
