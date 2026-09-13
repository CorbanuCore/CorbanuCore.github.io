(function () {
  "use strict";
  function mount() {
  const id = new URLSearchParams(window.location.search).get("index");
  if (!id) return;
  const api = "https://api.corbanu.com";
  const main = document.querySelector("main");
  if (!main) return;
  let wallet = window.CorbanuWallet.account;
  let current = null;
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  const shell = node("div", "", "builder-shell");
  const title = node("h1", "Your index");
  const status = node("p", "Loading index…");
  status.setAttribute("role", "status");
  const detail = node("section");
  const keyLabel = node("label", "Corbanu API key (for a private index or creator actions)", "field-label");
  const key = node("input");
  key.type = "password";
  key.value = window.CorbanuIndexSession?.key || "";
  delete window.CorbanuIndexSession;
  key.autocomplete = "off";
  key.id = "basket-api-key";
  keyLabel.htmlFor = key.id;
  const load = node("button", "Open index");
  const connect = node("button", "Connect MetaMask");
  if (wallet) connect.textContent = `Connected: ${wallet}`;
  const claim = node("button", "Claim creator ownership");
  claim.disabled = true;
  const amountLabel = node("label", "Basket amount in USDC", "field-label");
  const amount = node("input");
  amount.type = "text";
  amount.inputMode = "decimal";
  amount.placeholder = "100.00";
  amount.id = "basket-amount";
  amountLabel.htmlFor = amount.id;
  const slippageLabel = node("label", "Maximum slippage (basis points; 100 = 1%)", "field-label");
  const slippage = node("input");
  slippage.type = "number";
  slippage.min = "0";
  slippage.max = "10000";
  slippage.id = "basket-slippage";
  slippageLabel.htmlFor = slippage.id;
  const estimate = node("button", "Estimate basket");
  const buy = node("button", "Prepare trades on Felix");
  buy.id = "prepare-felix-trades";
  buy.disabled = true;
  const trades = node("section");
  trades.id = "felix-trades";
  trades.setAttribute("aria-live", "polite");
  const tradeNote = node("p", "Trade each holding directly on Felix. Corbanu prepares the allocations; connect your wallet and review each order on Felix before signing. Orders are separate and fills are not tracked here.", "field-note");
  const estimates = node("section");
  const actions = node("section", "", "builder-form");
  actions.append(keyLabel, key, load, connect, claim, amountLabel, amount, buy, tradeNote, trades, slippageLabel, slippage, estimate, estimates);
  shell.append(title, status, detail, actions);
  main.replaceChildren(shell);
  document.title = "Corbanu — Index basket";

  async function request(path, body, authenticated = true) {
    const headers = {};
    if (authenticated) {
      if (!key.value.trim()) throw new Error("Enter your Corbanu API key.");
      headers.Authorization = `Bearer ${key.value.trim()}`;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(api + path, {method: body === undefined ? "GET" : "POST", headers,
      ...(body !== undefined ? {body: JSON.stringify(body)} : {}), cache: "no-store"});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  }
  function render(value, published) {
    current = value;
    trades.replaceChildren();
    estimates.replaceChildren();
    buy.disabled = !["locked", "published"].includes(value.state);
    const payload = published ? value.artifact.payload.index.payload : value.artifact.payload;
    title.textContent = payload.definition.mandate.title;
    detail.replaceChildren(node("p", payload.definition.mandate.phrase), node("p", `Status: ${value.state} · ${payload.validity.independent_inference_replay ? "Replay verified" : "Provider-backed preview"}`));
    const table = node("table", "", "holdings-table");
    const header = node("tr");
    for (const text of ["Underlying", "Felix token", "Weight", "Ethereum contract"]) header.append(node("th", text));
    const head = node("thead"); head.append(header); table.append(head);
    const body = node("tbody");
    for (const row of payload.construction.weights) {
      const tr = node("tr");
      for (const text of [row.ticker, row.representation.venue_symbol, `${(row.weight_units / 1e10).toFixed(2)}%`, row.representation.contract_address]) tr.append(node("td", text));
      body.append(tr);
    }
    table.append(body);
    const wrap = node("div", "", "holdings-table-wrap");
    wrap.append(table);
    detail.append(wrap, node("p", payload.disclosure.token_exposure));
    status.textContent = value.claim ? `Creator wallet: ${value.claim.wallet}. Commission and affiliate revenue payouts await configured revenue-sharing terms and settlement.` : "Index locked. The creator can connect MetaMask to claim ownership.";
    claim.disabled = !wallet || !!value.claim;
  }
  async function open() {
    try {
      const value = key.value.trim() ? await request(`/v2/indexes/${encodeURIComponent(id)}`) : await request(`/v2/indexes/published/${encodeURIComponent(id)}`, undefined, false);
      render(value, !!value.public && !!value.public_cid);
    } catch (e) { status.textContent = `${e.message} Private indexes require their owner's API key.`; }
  }
  function handle(button, fn) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await fn(); } catch (e) { status.textContent = e.message || "Operation failed"; }
      finally { button.disabled = button === claim ? !wallet || !!current?.claim : button === buy ? !["locked", "published"].includes(current?.state) : false; }
    });
  }
  handle(load, open);
  handle(connect, async () => {
    wallet = await window.CorbanuWallet.connect();
    connect.textContent = wallet ? `Connected: ${wallet}` : "Connect MetaMask";
    claim.disabled = !wallet || !!current?.claim;
  });
  window.addEventListener("corbanu:wallet-changed", () => {
    wallet = window.CorbanuWallet.account;
    trades.replaceChildren();
    connect.textContent = wallet ? `Connected: ${wallet}` : "Connect MetaMask";
    claim.disabled = !wallet || !!current?.claim;
  });
  handle(claim, async () => {
    if (!wallet) throw new Error("Connect MetaMask first.");
    const challenge = await request(`/v2/indexes/${encodeURIComponent(id)}/claim-challenge`, {wallet});
    const signature = await window.CorbanuWallet.signMessage(challenge.message, wallet);
    await request(`/v2/indexes/${encodeURIComponent(id)}/claim`, {nonce: challenge.nonce, signature});
    await open();
  });
  function atomicAmount() {
    const parts = amount.value.trim().split(".");
    if (parts.length > 2 || !parts[0] || parts.join("").length > 16 || (parts[1]?.length || 0) > 6 || [...parts.join("")].some(c => c < "0" || c > "9")) throw new Error("Enter a positive USDC amount with at most six decimal places.");
    const atomic = BigInt(parts[0]) * 1000000n + BigInt((parts[1] || "").padEnd(6, "0"));
    if (atomic <= 0n) throw new Error("Enter a positive USDC amount.");
    return atomic.toString();
  }
  amount.addEventListener("input", () => { trades.replaceChildren(); estimates.replaceChildren(); });
  handle(buy, async () => {
    const requestedAmount = atomicAmount();
    trades.replaceChildren();
    const plan = await request(`/v2/indexes/${encodeURIComponent(id)}/felix-handoff`, {amount_usdc_atomic:requestedAmount});
    if (atomicAmount() !== requestedAmount) throw new Error("The basket amount changed. Prepare the trades again.");
    if (plan.index_id !== id || plan.index_sha256 !== current.index_sha256 || plan.kind !== "external_manual" || plan.amount_usdc_atomic !== requestedAmount) throw new Error("The trade plan does not match this locked index.");
    const links = plan.legs.map(leg => {
      const expected = `https://trade.usefelix.xyz/equities/${encodeURIComponent(leg.representation.underlying.ticker)}`;
      if (leg.trade_url !== expected) throw new Error("Unexpected Felix destination.");
      return expected;
    });
    trades.append(node("h2", "Trade your basket on Felix"), node("p", plan.instructions, "field-note"),
      node("p", "Amounts are allocation targets. Felix may charge fees or round order sizes. Copy each amount into Felix’s USDC size field; amounts and your Corbanu slippage setting are not transferred automatically.", "field-note"));
    if (wallet) trades.append(node("p", `Use this wallet on Felix: ${wallet}`, "field-note"));
    const download = node("button", "Download basket allocations");
    handle(download, async () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], {type:"application/json"}));
      const link = node("a"); link.href = url; link.download = "corbanu-felix-allocations.json";
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    trades.append(download);
    plan.legs.forEach((leg, i) => {
      const row = node("article", "", "felix-trade-leg");
      row.append(node("h3", `${i + 1}. ${leg.representation.underlying.ticker} · ${leg.representation.venue_symbol}`));
      const allocation = node("input"); allocation.value = leg.amount_usdc; allocation.readOnly = true;
      allocation.setAttribute("aria-label", `${leg.representation.venue_symbol} USDC allocation`);
      const copy = node("button", "Copy USDC amount");
      handle(copy, async () => {
        try { await navigator.clipboard.writeText(leg.amount_usdc); copy.textContent = "Amount copied"; }
        catch { allocation.focus(); allocation.select(); status.textContent = "Copy the selected USDC amount, then enter it on Felix."; }
      });
      const link = node("a", `Trade ${leg.representation.underlying.ticker} on Felix ↗`);
      link.href = links[i]; link.target = "_blank"; link.rel = "noopener noreferrer";
      const contract = node("a", "Verify Ethereum token contract ↗", "field-note");
      contract.href = `https://etherscan.io/token/${encodeURIComponent(leg.representation.contract_address)}`;
      contract.target = "_blank"; contract.rel = "noopener noreferrer";
      row.append(node("p", "Target amount in USDC"), allocation, copy, link, contract);
      trades.append(row);
    });
    status.textContent = "Allocations ready. Open each holding on Felix to trade. Corbanu has not submitted any orders.";
  });
  handle(estimate, async () => {
    const atomic = atomicAmount();
    if (!slippage.value) throw new Error("Set your slippage tolerance.");
    const value = await request(`/v2/indexes/${encodeURIComponent(id)}/estimate`, {amount_usdc_atomic: atomic.toString(), slippage_bps: Number(slippage.value)});
    estimates.replaceChildren(node("h2", "Indicative estimate"), node("p", "Felix venue fees, gas and actual slippage require a firm quote. This estimate cannot be signed or executed."));
    for (const leg of value.legs) estimates.append(node("p", `${leg.representation.venue_symbol}: ${(Number(leg.amount_usdc_atomic) / 1e6).toFixed(6)} USDC · token reference price $${leg.reference_token_price_usd}`));
    status.textContent = `Estimate expires ${value.expires_at}. No trade was submitted.`;
  });
  void open();
  }
  window.addEventListener("corbanu:index-locked", mount);
  mount();
})();
