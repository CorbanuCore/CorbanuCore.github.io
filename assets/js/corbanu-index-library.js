(function () {
  "use strict";
  const ui=window.CorbanuIndexUI, list=document.getElementById("index-library-grid"),status=document.getElementById("library-status");
  const count=document.getElementById("index-count"), search=document.getElementById("library-search"),sort=document.getElementById("library-sort");
  let rows=[];
  function render() {
    const term=search.value.trim().toLowerCase();
    const visible=rows.filter(r=>`${r.title} ${r.mandate}`.toLowerCase().includes(term)).sort((a,b)=>sort.value==="holdings"?b.constituent_count-a.constituent_count:sort.value==="name"?a.title.localeCompare(b.title):String(b.published_at||"").localeCompare(String(a.published_at||"")));
    list.replaceChildren();count.textContent=String(rows.length);
    for(const [i,row] of visible.entries()) {
      const article=ui.node("article","","library-row");
      const details=ui.node("details"),summary=ui.node("summary","","library-row-toggle");
      summary.append(ui.node("span",String(i+1).padStart(2,"0"),"library-row-rank"));
      const identity=ui.node("span","","library-row-identity");identity.append(ui.node("strong",row.title),ui.node("small",row.mandate));
      summary.append(identity,ui.node("span",`${row.constituent_count ?? "—"} holdings`,"library-row-stat"),ui.node("span",row.deterministic?"Replay verified":"Model-scored snapshot","library-row-replay"),ui.node("span","Expand holdings","library-row-affordance"));
      const body=ui.node("div","","library-row-detail"),open=ui.node("a",row.external_funds?"Open basket & connect MetaMask →":"Open index →");
      open.href=`/indexes/?index=${encodeURIComponent(row.id)}`;
      body.append(ui.node("p",row.mandate),open);
      const data=ui.node("section");body.append(data);let loaded=false,busy=false;
      details.addEventListener("toggle",async()=>{
        if(!details.open||loaded||busy)return;busy=true;data.textContent="Loading holdings and scoring explanations…";
        try {const value=await ui.request(`/v2/indexes/published/${encodeURIComponent(row.id)}`);data.replaceChildren(ui.renderHoldings(value));loaded=true;}
        catch(e){data.textContent=e.message+" Close and expand to retry.";}finally{busy=false;}
      });
      details.append(summary,body);article.append(details);list.append(article);
    }
    status.textContent=rows.length?`${visible.length} of ${rows.length} published indexes. Sorted by ${sort.selectedOptions[0].textContent.toLowerCase()}. Performance ranking is not yet tracked.`:"No user indexes have been published yet. Open a saved preview, lock it, claim it, and publish it here.";
  }
  async function load(){status.textContent="Loading published indexes…";try{const value=await ui.request("/v2/indexes/published");rows=value.indexes;render();}catch(e){status.textContent=e.message;}}
  search.addEventListener("input",render);sort.addEventListener("change",render);document.getElementById("library-retry").addEventListener("click",load);void load();
})();
