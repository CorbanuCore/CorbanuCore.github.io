(function () {
  "use strict";
  const api = "https://api.corbanu.com";
  const node = (tag, text = "", className = "") => {
    const el = document.createElement(tag); el.textContent = text; el.className = className; return el;
  };
  let signedKey = null;
  async function request(path, body, key, requestId) {
    const headers = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (requestId) headers["X-Corbanu-Request-Id"] = requestId;
    const response = await fetch(api + path, {method:body === undefined ? "GET" : "POST",headers,
      credentials:"include",cache:"no-store",signal:AbortSignal.timeout(90000),
      ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const value = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(value.error || `Request failed (${response.status})`); error.status = response.status; throw error; }
    return value;
  }
  async function signIn(key) {
    if (!key || key === signedKey) return;
    await request("/v2/indexes/session", {}, key); signedKey = key;
  }
  async function session() { try { return (await request("/v2/indexes/session")).authenticated === true; } catch { return false; } }
  async function signOut() {
    const response = await fetch(api+"/v2/indexes/session", {method:"DELETE",credentials:"include",cache:"no-store"});
    if (!response.ok) throw new Error("Sign out failed. Try again."); signedKey = null;
  }
  function download(value, filename = "corbanu-index.json") {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
    const a = node("a"); a.href = url; a.download = filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function payload(value) {
    let p = value.artifact?.payload || value.preview?.payload || value.payload || value;
    if (p.index?.payload) p = p.index.payload;
    return p;
  }
  function holdings(value) {
    const p = payload(value), scores = p.scores || p.inference_artifact?.payload?.scores || [];
    const byId = new Map(scores.map(s=>[s.security_id,s]));
    return (p.construction?.weights || p.holdings || []).map(w=>({...byId.get(w.security_id),...w,
      weight_percent:w.weight_units === undefined ? w.weight_percent : w.weight_units/1e10})).sort((a,b)=>b.weight_percent-a.weight_percent);
  }
  function renderHoldings(value) {
    const rows = holdings(value), section = node("section", "", "index-holdings");
    const heading = node("h2", `Holdings · ${rows.length}`);
    const search = node("input"); search.type="search"; search.placeholder="Search company or ticker";search.setAttribute("aria-label","Search holdings");
    const chart = node("details", "", "holdings-chart"); chart.append(node("summary","Portfolio weights"));
    const bars = node("div", "", "weight-chart"), max = Math.max(1,...rows.map(r=>r.weight_percent));
    for (const r of rows.slice(0,20)) {
      const row=node("div","","weight-row"),track=node("span","","weight-track"),bar=node("i");
      bar.style.width=`${r.weight_percent/max*100}%`;track.append(bar);
      row.append(node("strong",r.ticker),track,node("b",`${r.weight_percent.toFixed(2)}%`));bars.append(row);
    }
    chart.append(node("p",rows.length>20?`Top 20 of ${rows.length} holdings. All weights appear below.`:"All portfolio weights."),bars);
    const count=node("p","","field-note"), list=node("div","","holding-list");
    function render() {
      const term=search.value.trim().toLowerCase();
      const shown=rows.filter(r=>[r.ticker,r.company_name,r.representation?.venue_symbol].some(x=>String(x||"").toLowerCase().includes(term)));
      count.textContent=`${shown.length} of ${rows.length} holdings`; list.replaceChildren();
      for (const r of shown) {
        const item=node("details","","holding-detail");
        const summary=node("summary");
        summary.append(node("strong",r.ticker),node("span",r.company_name||r.representation?.venue_symbol||r.ticker),node("b",`${r.weight_percent.toFixed(2)}%`));
        const content=node("div","","holding-content");
        content.append(node("p",`Relevance: ${r.score ?? "—"}/100 · Confidence: ${r.confidence ?? "—"}`),node("h3","Why this holding"));
        for(const paragraph of r.reasoning_block || []) content.append(node("p",paragraph));
        if(!r.reasoning_block?.length) content.append(node("p","No scoring explanation was retained for this holding."));
        if(r.representation){
          const rep=r.representation;
          content.append(node("p",`${rep.venue} · ${rep.venue_symbol} · ${rep.chain_id}`));
          const contract=node("a",rep.contract_address);contract.href=`https://etherscan.io/token/${encodeURIComponent(rep.contract_address)}`;contract.target="_blank";contract.rel="noopener noreferrer";content.append(contract);
        }
        item.append(summary,content);list.append(item);
      }
    }
    search.addEventListener("input",render);render();section.append(heading,chart,search,count,list);return section;
  }
  window.CorbanuIndexUI={node,request,signIn,session,signOut,download,payload,holdings,renderHoldings};
})();
