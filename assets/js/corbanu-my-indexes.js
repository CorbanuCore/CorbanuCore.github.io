(function () {
  "use strict";
  const api = "https://api.corbanu.com";
  const form = document.getElementById("my-indexes-form"), key = document.getElementById("my-indexes-key");
  const status = document.getElementById("my-indexes-status"), list = document.getElementById("my-indexes-list");
  const load = document.getElementById("load-my-indexes");
  const states = {completed:"Ready to review",running:"Scoring",queued:"Queued",failed:"Failed",needs_data:"Needs data",pinning:"Lock needs retry",locked:"Locked",published:"Published"};
  let generation = 0;
  function node(tag, text, className) {
    const el = document.createElement(tag); el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  async function request(path, credential) {
    await window.CorbanuIndexUI.signIn(credential);
    const response = await fetch(api + path, {headers:credential ? {Authorization:`Bearer ${credential}`} : {},credentials:"include",cache:"no-store"});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`);
    return value;
  }
  function reset() { generation++; list.replaceChildren(); status.textContent = "Enter your API key to see your saved indexes."; load.disabled = false; }
  key.addEventListener("input", reset);
  document.getElementById("clear-my-indexes").addEventListener("click", async () => { try { await window.CorbanuIndexUI.signOut(); key.value = ""; reset(); } catch(e) { status.textContent=e.message; } });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const credential = key.value.trim(), current = ++generation;

    load.disabled = true; list.replaceChildren(); status.textContent = "Loading saved indexes…";
    try {
      const data = await request("/v2/indexes", credential);
      if (current !== generation) return;
      if (!Array.isArray(data.indexes)) throw new Error("Invalid saved-index response.");
      for (const index of data.indexes) {
        const card = node("article", "", "saved-index-card");
        card.append(node("h2", index.title), node("p", index.mandate));
        const created = new Date(index.created_at);
        const date = Number.isFinite(created.getTime()) ? created.toLocaleString() : "Unknown creation date";
        card.append(node("p", `${states[index.state] || index.state} · ${index.public ? "Public" : "Private"} · ${index.progress.scored}/${index.progress.total} scored`, "field-note"), node("p", `Created ${date}`, "field-note"));
        if (index.page_url) {
          const expected = `https://corbanu.com/indexes/?${["locked","published"].includes(index.state) ? "index" : "preview"}=${encodeURIComponent(index.id)}`;
          if (index.page_url !== expected) throw new Error("Unexpected saved-index destination.");
          const link = node("a", ["locked","published"].includes(index.state) ? "Open basket →" : "Open preview →");
          link.href = index.page_url; card.append(link);
        }
        if (index.result_available) {
          const download = node("button", "Download saved result"); download.type = "button";
          download.addEventListener("click", async () => {
            if (current !== generation) return;
            download.disabled = true;
            try {
              const result = await request(`/v1/indexes/${encodeURIComponent(index.id)}/result`, credential);
              if (current !== generation) return;
              const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], {type:"application/json"}));
              const link = node("a", ""); link.href = url; link.download = "corbanu-index-result.json"; link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) { if (current === generation) status.textContent = e.message || "Could not download the result."; }
            finally { download.disabled = false; }
          });
          const details=node("details"),summary=node("summary","Expand weights and reasoning"),content=node("section");
          let expanded=false;
          details.append(summary,content);
          details.addEventListener("toggle",async()=>{
            if(!details.open||expanded||current!==generation)return;expanded=true;content.textContent="Loading holdings…";
            try {const result=await request(`/v1/indexes/${encodeURIComponent(index.id)}/result`,credential);
              if(current!==generation)return;content.replaceChildren(window.CorbanuIndexUI.renderHoldings(result));
            }catch(e){expanded=false;content.textContent=e.message+" Close and expand to retry.";}
          });
          card.append(download,details);
        }
        list.append(card);
      }
      status.textContent = data.indexes.length ? `${data.indexes.length} saved indexes.` : "No indexes found for this account. Create your first index below.";
    } catch (e) { if (current === generation) { list.replaceChildren(); status.textContent = e.message || "Could not load your indexes."; } }
    finally { if (current === generation) load.disabled = false; }
  });
  void window.CorbanuIndexUI.session().then(active => { if(active) { key.required=false; form.requestSubmit(); } });
})();
