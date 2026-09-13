(function () {
  "use strict";
  function mount() {
  const id = new URLSearchParams(window.location.search).get("index");
  if (!id) return;
  const api = "https://api.corbanu.com";
  const ui = window.CorbanuIndexUI;
  let owner = false, generation = 0, walletOperation = false;
  const main = document.querySelector("main");
  if (!main) return;
  main.id="builder";
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
  if (wallet) connect.textContent = `MetaMask: ${wallet.slice(0,6)}…${wallet.slice(-4)}`;
  const publish = node("button", "Publish to index leaderboard");
  publish.id="publish-index";publish.disabled=true;
  const publication = node("label", "", "check-label");
  const consent = node("input");consent.type="checkbox";consent.id="publish-consent";
  publication.append(consent,document.createTextNode("Make this index, supplied inputs, disclosures, holdings and scoring explanations public, including permanent IPFS publication."));
  const claim = node("button", "Claim creator ownership");claim.id="claim-index";
  const creatorTools=node("details");creatorTools.id="creator-tools";creatorTools.append(node("summary","Creator ownership & publication"),claim,publication,publish);
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
  const buyWallet = node("button", "Buy basket with MetaMask");buyWallet.id="buy-index-wallet";buyWallet.disabled=true;
  const execution = node("section");execution.id="wallet-execution";
  const buy = node("button", "Open trades on Felix instead");
  buy.id = "prepare-felix-trades";
  buy.disabled = true;
  const trades = node("section");
  trades.id = "felix-trades";
  trades.setAttribute("aria-live", "polite");
  const tradeNote = node("p", "Trade each holding directly on Felix. Corbanu prepares the allocations; connect your wallet and review each order on Felix before signing. Orders are separate and fills are not tracked here.", "field-note");
  const estimates = node("section");
  const actions = node("section", "", "builder-form");
  actions.append(node("h2","Put on this index"),keyLabel, key, load, connect, amountLabel, amount, slippageLabel, slippage, buyWallet, execution, estimate, estimates, buy, tradeNote, trades,creatorTools);
  shell.append(title, status, detail, actions);
  main.replaceChildren(shell);
  document.title = "Corbanu — Index basket";

  async function request(path, body, authenticated = true) {
    const headers = {};
    if (authenticated) {
      if (key.value.trim()) headers.Authorization = `Bearer ${key.value.trim()}`;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(api + path, {method: body === undefined ? "GET" : "POST", headers,
      ...(body !== undefined ? {body: JSON.stringify(body)} : {}), credentials:"include",cache: "no-store"});
    const result = await response.json();
    if (!response.ok) { const e=new Error(result.error || `Request failed (${response.status})`);e.status=response.status;throw e; }
    return result;
  }
  function render(value, published) {
    current = value;
    trades.replaceChildren();
    estimates.replaceChildren();
    buy.disabled = !["locked", "published"].includes(value.state);
    const payload = published ? value.artifact.payload.index.payload : value.artifact.payload;
    title.textContent = payload.definition.mandate.title;
    detail.replaceChildren(node("p", payload.definition.mandate.phrase), node("p", `Status: ${value.state} · ${payload.validity.independent_inference_replay ? "Replay verified" : "Model-scored snapshot"}`));
    const weights=node("details");weights.className="basket-weights";weights.append(node("summary",`Weights and reasoning · ${payload.construction.weights.length} holdings`),ui.renderHoldings(value));
    detail.append(weights, node("p", payload.disclosure.token_exposure));
    const methods=node("details");methods.append(node("summary","Methodology, prompt and exclusions"));
    methods.append(node("pre",JSON.stringify({model:payload.definition.model,mandate:payload.definition.mandate,
      weighting:payload.definition.weighting,relevance_cutoff:payload.definition.relevance_cutoff,
      prompt:payload.definition.workflow.prompt,excluded:payload.construction.excluded,issues:payload.construction.issues},null,2)));
    const download=node("button","Download index JSON"); download.addEventListener("click",()=>ui.download(value.artifact));
    detail.append(methods,download);
    publication.hidden=!owner || value.public;publish.hidden=!owner || value.public;
    publish.disabled=!value.claim || !consent.checked;
    creatorTools.hidden=!owner;claim.hidden=!owner; keyLabel.hidden=owner;key.hidden=owner;load.hidden=owner;
    const canTrade=owner || payload.definition.workflow.external_funds===true;
    buy.disabled=!canTrade;buyWallet.disabled=!canTrade;estimate.disabled=!canTrade;
    tradeNote.textContent=canTrade?"Review allocations and sign each order on Felix with your wallet. Orders execute separately.":"The creator has published this index for inspection. Trading by other investors requires verified deterministic replay and the creator enabling external funds.";
    status.textContent = value.claim ? `Creator wallet: ${value.claim.wallet}. Commission and affiliate revenue payouts await configured revenue-sharing terms and settlement.` : "Index locked. The creator can connect MetaMask to claim ownership.";
    claim.disabled = !owner || !wallet || !!value.claim;
  }
  async function open() {
    const currentGeneration=++generation;
    status.textContent="Loading index…";
    try {
      await ui.signIn(key.value.trim());
      let value;
      try {value=await request(`/v2/indexes/${encodeURIComponent(id)}`);owner=true;}
      catch(e) {
        if(![401,404].includes(e.status)) throw e;
        value=await request(`/v2/indexes/published/${encodeURIComponent(id)}`,undefined,false);owner=false;
      }
      if(currentGeneration!==generation)return;
      render(value, !!value.public_cid);
    } catch (e) { if(currentGeneration===generation)status.textContent=e.status===404?"This private index needs its creator’s Corbanu session. Sign in above to open it.":e.message; }
  }
  key.addEventListener("input",()=>{generation++;current=null;owner=false;detail.replaceChildren();trades.replaceChildren();estimates.replaceChildren();buy.disabled=true;claim.disabled=true;publish.disabled=true;});
  consent.addEventListener("change",()=>{publish.disabled=!owner||!current?.claim||!consent.checked;});
  function handle(button, fn) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await fn(); } catch (e) { status.textContent = e.message || "Operation failed"; }
      finally { button.disabled = button === claim ? !owner || !wallet || !!current?.claim : button === buy ? !current || !(owner || ui.payload(current).definition.workflow.external_funds) : button === publish ? !owner || !current?.claim || !consent.checked : false; }
    });
  }
  handle(load, open);
  handle(publish, async()=>{
    if(!consent.checked)throw new Error("Accept public publication before publishing.");
    const p=ui.payload(current);
    const catalog=await request("/v2/indexes/catalog",undefined,false);
    const disclosure={...p.definition.workflow.disclosure,version:catalog.disclosure.version,sha256:catalog.disclosure_sha256,accepted:true};
    await request(`/v2/indexes/${encodeURIComponent(id)}/publish`,disclosure);
    await open();status.textContent="Published. Your index now appears on the index leaderboard.";
    const link=node("a","View index leaderboard →");link.href="/indexes/library/";detail.prepend(link);
  });
  handle(connect, async () => {
    wallet = await window.CorbanuWallet.connect();
    connect.textContent = wallet ? `MetaMask: ${wallet.slice(0,6)}…${wallet.slice(-4)}` : "Connect MetaMask";
    claim.disabled = !owner || !wallet || !!current?.claim;
  });
  window.addEventListener("corbanu:wallet-changed", () => {
    wallet = window.CorbanuWallet.account;
    trades.replaceChildren();execution.replaceChildren();
    connect.textContent = wallet ? `MetaMask: ${wallet.slice(0,6)}…${wallet.slice(-4)}` : "Connect MetaMask";
    claim.disabled = !owner || !wallet || !!current?.claim;
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
  amount.addEventListener("input", () => { trades.replaceChildren(); estimates.replaceChildren(); execution.replaceChildren(); });
  slippage.addEventListener("input",()=>execution.replaceChildren());
  handle(buyWallet, async()=>{
    if(walletOperation)throw new Error("Finish the pending wallet transaction first.");
    const requestedAmount=atomicAmount();
    if(!slippage.value || !Number.isInteger(Number(slippage.value)) || Number(slippage.value)<0 || Number(slippage.value)>10000)throw new Error("Set maximum slippage between 0 and 10,000 basis points.");
    const tolerance=Number(slippage.value),signedIndex=current.index_sha256;
    status.textContent="Connect MetaMask, then sign in to your existing Felix account.";
    const account=await window.CorbanuFelix.login();
    const plan=await request(`/v2/indexes/${encodeURIComponent(id)}/felix-handoff`,{amount_usdc_atomic:requestedAmount});
    if(plan.index_id!==id || plan.index_sha256!==signedIndex || atomicAmount()!==requestedAmount)throw new Error("Basket changed. Start again.");
    execution.replaceChildren(node("h2","Buy with MetaMask"),node("p","Each holding is a separate Ethereum transaction. Review the firm quote, approve USDC when needed, then sign the purchase. Completed transactions remain completed if a later order fails."));
    const progress=node("p",`0 of ${plan.legs.length} purchases confirmed`,"field-note");execution.append(progress);
    let confirmed=0;
    for(const [legIndex,leg] of plan.legs.entries()){
      const row=node("article","","felix-trade-leg"),budget=BigInt(leg.amount_usdc_atomic);
      row.append(node("h3",`${leg.representation.underlying.ticker} · ${leg.amount_usdc} USDC`));
      const message=node("p","Request a firm quote to see the tokens received, brokerage fee and Ethereum gas.");
      const retryReport=node("button","Check transaction & retry Felix reporting");retryReport.hidden=true;
      const quoteButton=node("button","Get firm quote"),approveButton=node("button","Approve this USDC amount"),signButton=node("button","Sign purchase in MetaMask");
      quoteButton.className="get-firm-quote";approveButton.hidden=true;signButton.disabled=true;let quote=null,baseline=null,tradeHash=null,inFlight=false;
      const stateKey=`corbanu-index-tx:${account.toLowerCase()}:${id}:${leg.security_id}:${requestedAmount}`;
      let saved=null;try{saved=JSON.parse(localStorage.getItem(stateKey)||"null");}catch{}
      if(saved?.tx_hash){tradeHash=saved.tx_hash;quoteButton.disabled=true;retryReport.hidden=false;message.textContent=`Previously submitted: ${tradeHash}. Check its receipt before placing another order.`;}
      function unchanged(){
        if(!row.isConnected||atomicAmount()!==requestedAmount||Number(slippage.value)!==tolerance||!wallet||wallet.toLowerCase()!==account.toLowerCase())throw new Error("Wallet, amount or slippage changed. Start again.");
      }
      async function getQuote(){
        unchanged();signButton.disabled=true;approveButton.hidden=true;message.textContent="Requesting a firm Felix quote…";
        const next=await window.CorbanuFelix.api(`/v2/indexes/${encodeURIComponent(id)}/felix-quotes`,{amount_usdc_atomic:requestedAmount,security_id:leg.security_id,wallet:account},key.value.trim());
        unchanged();
        if(next.representation.contract_address.toLowerCase()!==leg.representation.contract_address.toLowerCase())throw new Error("Quoted token differs from the locked basket.");
        const tokens=BigInt(next.token_amount_atomic);
        if(baseline!==null && tokens*10000n<baseline*BigInt(10000-tolerance))throw new Error("Refreshed quote exceeds your slippage tolerance. Review a new basket before continuing.");
        if(baseline===null)baseline=tokens;
        const info=await window.CorbanuFelix.inspect(next,id,signedIndex,account,budget);unchanged();quote=next;
        message.textContent=`Receive ${info.token_amount} ${leg.representation.venue_symbol}. Brokerage fee included in allocation: ${(Number(info.fee_usdc_atomic)/1e6).toFixed(6)} USDC. `+
          (info.gas_estimate_wei===null?"Purchase gas is estimated after USDC approval.":`Estimated purchase gas: ${(Number(info.gas_estimate_wei)/1e18).toFixed(8)} ETH.`)+` Quote expires ${new Date(next.expires_at).toLocaleTimeString()}.`;
        approveButton.hidden=!info.approval_required;signButton.disabled=info.approval_required;
      }
      function action(button,fn){button.addEventListener("click",async()=>{
        if(inFlight)return;
        const signs=button===approveButton||button===signButton;
        if(walletOperation){message.textContent="Finish the pending wallet transaction before starting another step.";return;}
        inFlight=true;if(signs){walletOperation=true;for(const control of [amount,slippage,buyWallet,connect])control.disabled=true;}button.disabled=true;quoteButton.disabled=true;
        try{await fn();}
        catch(e){message.textContent=e.code===4001?"Signature declined. No new transaction was submitted.":e.message;}
        finally{inFlight=false;if(signs){walletOperation=false;for(const control of [amount,slippage,buyWallet,connect])control.disabled=false;}quoteButton.disabled=!!tradeHash;
          if(button===approveButton||button===retryReport)button.disabled=false;}
      });}
      action(quoteButton,getQuote);
      action(approveButton,async()=>{
        unchanged();if(!quote)throw new Error("Get a quote first.");
        await window.CorbanuFelix.approve(quote,id,signedIndex,account,budget,hash=>{message.textContent=`Approval submitted: ${hash}. Waiting for confirmation…`;});
        await getQuote();
      });
      action(signButton,async()=>{
        unchanged();if(!quote||tradeHash)throw new Error("Refresh the quote before signing.");
        const q=quote;
        let hash;
        try {hash=await window.CorbanuFelix.execute(q,id,signedIndex,account,budget,tx=>{
          tradeHash=tx;quoteButton.disabled=true;
          const receipt={tx_hash:tx,order_id:q.order_id,report_token:q.report_token};
          saved=receipt;retryReport.hidden=false;receiptLink.hidden=false;receiptLink.href=`https://etherscan.io/tx/${tx}`;
          try{localStorage.setItem(stateKey,JSON.stringify(receipt));}catch{}
          message.textContent=`Purchase submitted: ${tx}. Waiting for Ethereum confirmation…`;
        });}catch(e){if(tradeHash){message.textContent=`Transaction ${tradeHash} was broadcast. Check its receipt before retrying. ${e.message}`;return;}throw e;}
        confirmed++;progress.textContent=`${confirmed} of ${plan.legs.length} purchases confirmed`;
        message.textContent=`Confirmed on Ethereum: ${hash}. Linking the order to Felix…`;
        try{await window.CorbanuFelix.api(`/v2/indexes/${encodeURIComponent(id)}/felix-orders/report`,{report_token:q.report_token,tx_hash:hash},key.value.trim());message.textContent=`Confirmed on Ethereum and reported to Felix: ${hash}`;}
        catch(e){message.textContent=`Confirmed on Ethereum: ${hash}. Felix reporting needs retry: ${e.message}`;}
      });
      action(retryReport,async()=>{
        if(!saved?.tx_hash)throw new Error("No submitted transaction to check.");
        const receipt=await window.CorbanuFelix.receipt(saved.tx_hash,account);
        if(receipt.status==="reverted"){
          try{localStorage.removeItem(stateKey);}catch{}tradeHash=null;saved=null;quote=null;quoteButton.disabled=false;retryReport.hidden=true;
          message.textContent="Transaction reverted. No purchase completed. Request a new quote to retry.";return;
        }
        await window.CorbanuFelix.api(`/v2/indexes/${encodeURIComponent(id)}/felix-orders/report`,{report_token:saved.report_token,tx_hash:saved.tx_hash},key.value.trim());
        message.textContent=`Confirmed on Ethereum and reported to Felix: ${saved.tx_hash}`;retryReport.hidden=true;
      });
      const receiptLink=node("a","View transaction on Etherscan ↗");receiptLink.target="_blank";receiptLink.rel="noopener noreferrer";receiptLink.hidden=!tradeHash;
      if(tradeHash)receiptLink.href=`https://etherscan.io/tx/${tradeHash}`;
      row.append(message,quoteButton,approveButton,signButton,retryReport,receiptLink);execution.append(row);
      if(legIndex===0 && !tradeHash)quoteButton.click();
    }
    status.textContent="Felix wallet session connected. Review and sign purchases below.";
  });
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
