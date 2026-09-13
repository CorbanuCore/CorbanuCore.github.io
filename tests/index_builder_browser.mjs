import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const { chromium } = await import(process.env.CORBANU_PLAYWRIGHT_MODULE || "playwright");
const root = resolve(new URL("..", import.meta.url).pathname);
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = resolve(root, "." + path + (path.endsWith("/") ? "index.html" : ""));
    if (!file.startsWith(root + "/")) { res.writeHead(403).end(); return; }
    res.setHeader("Content-Type", ({".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".webp":"image/webp"})[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true});
const context = await browser.newContext();
const errors = [], creates = [], locks = [], handoffs = [];
let authenticated=false;
let reads = 0, needsData = false, catalogUnavailable = false;
const hash = "a".repeat(64), key = "synthetic-test-key-not-a-real-credential";
const catalog = {schema:"corbanu.index-workflow.v1", models:["corbanu/deepseek-v4.1-flash","corbanu/glm-5.3"],
  deterministic_default_model:"corbanu/deepseek-v4.1-flash", deterministic_available:false,
  reasoning_efforts:["low","high","max"], prompts:[{id:"thematic_v1",label:"Thematic relevance"},{id:"custom",label:"Custom"}],
  disclosure:{version:"fixture-v1",market_opinion:"Synthetic market opinion disclosure",indemnity:"Synthetic indemnity",token_exposure:"Synthetic token disclosure",publication:"Synthetic public consent"}, disclosure_sha256:hash};
const payload = {scores:[{security_id:"felix:TESTon",reasoning_block:["Test thematic exposure.","Evidence from frozen inputs.","Counterevidence retained."],confidence:"high"}],request:{workflow:{external_funds:false,prompt:null,disclosure:{conflicts:"None"}},mandate:{title:"Synthetic theme",phrase:"A synthetic theme used only for browser verification."}},
  validity:{independent_inference_replay:false},construction:{weights:[{security_id:"felix:TESTon",ticker:"TEST",company_name:"Test Company",score:80,weight_units:1000000000000,representation:{venue_symbol:"TESTon",contract_address:"0x"+"1".repeat(40)}}],excluded:[{ticker:"MISSING",error:"capitalization_unavailable"}]}};
await context.route("https://api.corbanu.com/**", async route => {
  const req = route.request(), path = new URL(req.url()).pathname;
  const send = (value, status=200) => route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
  if(path==="/v2/indexes/session") {
    if(req.method()==="DELETE"){authenticated=false;return send({authenticated:false});}
    if(req.method()==="POST"){
      if(req.headers().authorization!==`Bearer ${key}`)return send({error:"Invalid API key"},401);
      authenticated=true;return send({authenticated:true});
    }
    return authenticated?send({authenticated:true}):send({error:"Sign in"},401);
  }
  if (path === "/v2/indexes") {
    if (!authenticated && req.headers().authorization !== `Bearer ${key}`) return send({error:"Invalid API key"},401);
    return send({limit:100,indexes:[{id:"fixture-preview",title:"Saved preview <test>",mandate:"Saved private mandate",state:"completed",public:false,
      progress:{scored:452,total:452},created_at:"2026-09-13T00:00:00Z",page_url:"https://corbanu.com/indexes/?preview=fixture-preview",result_available:true},
      {id:"fixture-locked",title:"Locked basket",mandate:"Another private mandate",state:"locked",public:false,
      progress:{scored:452,total:452},created_at:"2026-09-13T00:00:00Z",page_url:"https://corbanu.com/indexes/?index=fixture-locked",result_available:true}]});
  }
  if (path === "/v1/indexes/fixture-preview/result") {
    assert.ok(authenticated || req.headers().authorization===`Bearer ${key}`);
    return send({payload});
  }
  if (path.endsWith("/catalog")) return catalogUnavailable ? send({error:"catalog unavailable"},503) : send(catalog);
  if (path === "/v2/indexes/previews") {
    creates.push({body:req.postDataJSON(),id:req.headers()["x-corbanu-request-id"],key:req.headers().authorization});
    if (creates.length === 1) return route.abort("failed");
    return send({id:"fixture-preview",status:"queued",progress:{scored:0,total:2}},202);
  }
  if (path === "/v2/indexes/previews/fixture-preview") {
    reads++;
    if (reads === 1) return send({id:"fixture-preview",status:"running",progress:{scored:1,total:2},
      execution_runs:[{concurrency:8}],reasoning_effort:"high",created_at:new Date(Date.now()-120000).toISOString(),
      error:"Index model HTTP 429; 4 attempt(s). Completed company scores are saved."});
    return send({id:"fixture-preview",status:needsData?"needs_data":"completed",progress:{scored:2,total:2},preview_sha256:needsData?null:hash,preview:{payload}});
  }
  if (path.endsWith("/lock")) {
    locks.push(req.postDataJSON());
    if (locks.length === 1) return send({error:"temporary pin failure"},502);
    return send({id:"fixture-preview",state:"locked",cache_cid:"test-cid"});
  }
  if (path === "/v2/indexes/fixture-preview") {
    assert.ok(authenticated || req.headers().authorization===`Bearer ${key}`);
    return send({id:"fixture-preview",state:"locked",public:false,index_sha256:hash,artifact:{payload:{...payload,definition:payload.request,disclosure:catalog.disclosure}}});
  }
  if (path.endsWith("/felix-handoff")) {
    assert.ok(authenticated || req.headers().authorization===`Bearer ${key}`);
    handoffs.push(req.postDataJSON());
    return send({schema:"corbanu.felix-handoff.v1",kind:"external_manual",executable:false,index_id:"fixture-preview",index_sha256:hash,
      amount_usdc_atomic:"100000001",instructions:"Review each order on Felix before signing.",legs:[{
        amount_usdc:"100.000001",amount_usdc_atomic:"100000001",trade_url:"https://trade.usefelix.xyz/equities/TEST",
        representation:{...payload.construction.weights[0].representation,underlying:{ticker:"TEST"}}
      }]});
  }
  throw new Error("Unexpected request: " + path);
});
try {
  const mine=await context.newPage(); mine.on("pageerror",e=>errors.push(e.message));
  await mine.goto(origin+"/indexes/mine/");
  await mine.locator("#my-indexes-key").fill("invalid");
  await mine.locator("#load-my-indexes").click();
  await mine.waitForFunction(()=>document.querySelector("#my-indexes-status").textContent==="Invalid API key");
  await mine.locator("#my-indexes-key").fill(key);
  await mine.locator("#load-my-indexes").click();
  await mine.getByRole("link",{name:"Open basket →",exact:true}).waitFor();
  assert.equal(await mine.getByRole("link",{name:"Open preview →",exact:true}).getAttribute("href"),"https://corbanu.com/indexes/?preview=fixture-preview");
  assert.equal(await mine.getByRole("link",{name:"Open basket →",exact:true}).getAttribute("href"),"https://corbanu.com/indexes/?index=fixture-locked");
  assert.equal(await mine.locator(".saved-index-card").count(),2);
  assert.equal(await mine.getByRole("heading",{name:"Saved preview <test>",exact:true}).count(),1);
  assert.equal(await mine.evaluate(()=>localStorage.length+sessionStorage.length),0);
  const savedDownload=mine.waitForEvent("download");
  await mine.getByRole("button",{name:"Download saved result",exact:true}).first().click();
  const savedResult=JSON.parse(await readFile(await (await savedDownload).path(),"utf8"));
  assert.deepEqual(savedResult.payload,payload);
  assert.equal(JSON.stringify(savedResult).includes(key),false);
  await mine.setViewportSize({width:390,height:844});
  assert.equal(await mine.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  if (process.env.CORBANU_MY_INDEXES_SCREENSHOT) await mine.screenshot({path:process.env.CORBANU_MY_INDEXES_SCREENSHOT,fullPage:true});
  await mine.locator("#clear-my-indexes").click();
  await mine.waitForFunction(()=>document.querySelector("#my-indexes-key").value==="");
  assert.equal(await mine.locator("#my-indexes-key").inputValue(),"");
  assert.equal(await mine.locator(".saved-index-card").count(),0);
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + "/indexes/");
  await page.waitForFunction(() => !document.querySelector("#run-index").disabled);
  assert.equal(await page.locator("#deterministic").isDisabled(),true);
  assert.equal(await page.locator("#external-funds").isDisabled(),true);
  assert.equal(await page.locator("#model-choice").inputValue(),"corbanu/deepseek-v4.1-flash");
  await page.locator("#builder-connect-wallet").click();
  await page.waitForFunction(() => document.querySelector("#builder-wallet-status").textContent.includes("MetaMask browser"));
  await page.evaluate(() => {
    window.walletCalls=[]; window.walletListeners={}; window.walletDecline=true;
    const provider={request:async args=>{
      window.walletCalls.push(args);
      if(args.method==="eth_requestAccounts" && window.walletDecline) {window.walletDecline=false;throw Object.assign(new Error("Declined"),{code:4001});}
      if(args.method==="eth_requestAccounts" || args.method==="eth_accounts") return ["0x"+"1".repeat(40)];
      if(args.method==="personal_sign") return "synthetic-signature";
      throw new Error("Unexpected wallet action");
    },on:(name,fn)=>{window.walletListeners[name]=fn;}};
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{info:{rdns:"io.metamask"},provider}}));
  });
  await page.locator("#builder-connect-wallet").click();
  await page.waitForFunction(() => document.querySelector("#builder-wallet-status").textContent.includes("declined"));
  await page.locator("#builder-connect-wallet").click();
  await page.waitForFunction(() => document.querySelector("#builder-wallet-status").textContent.includes("Connected: 0x"));
  assert.deepEqual(await page.evaluate(()=>window.walletCalls.map(c=>c.method)),["eth_requestAccounts","eth_requestAccounts"]);
  await page.locator("#builder-api-key").fill(key);
  await page.locator("#index-title").fill("Synthetic theme");
  await page.locator("#index-phrase").fill(payload.request.mandate.phrase);
  await page.locator("#weighting-choice").selectOption("market_cap_rank");
  await page.locator("#relevance-cutoff").fill("68");
  await page.locator("#reasoning-effort").selectOption("max");
  await page.locator("#prompt-choice").selectOption("custom");
  await page.locator("#custom-prompt").fill("Use this synthetic scoring instruction.");
  await page.locator("#creator-conflicts").fill("None; synthetic test.");
  await page.locator("#accept-disclosure").check();
  await page.locator("#run-index").click();
  await page.waitForFunction(() => document.querySelector("#run-index").textContent === "Retry same preview");
  assert.equal(await page.locator("#index-title").isDisabled(),true);
  await page.locator("#run-index").click();
  await page.waitForFunction(() => document.querySelector("#job-status").textContent === "running");
  assert.match(await page.locator("#job-message").innerText(),/8 parallel requests/);
  assert.match(await page.locator("#job-message").innerText(),/Scoring resumed/);
  assert.match(await page.locator("#job-message").innerText(),/Elapsed: 2 min/);
  assert.equal((await page.locator("#job-message").innerText()).includes("HTTP 429"),false);
  assert.equal(await page.locator("#job-retry-detail").isVisible(),true);
  await page.locator("#job-retry-detail summary").click();
  assert.match(await page.locator("#job-retry-error").innerText(),/HTTP 429/);
  assert.deepEqual(creates[0],creates[1]);
  assert.equal(creates[1].body.weighting,"market_cap_rank");
  assert.equal(creates[1].body.relevance_cutoff,68);
  assert.equal(creates[1].body.reasoning_effort,"max");
  assert.equal(creates[1].body.prompt,"Use this synthetic scoring instruction.");
  assert.equal(creates[1].body.disclosure.sha256,hash);
  await page.locator("#refresh-preview").click();
  await page.waitForFunction(() => !document.querySelector("#lock-index").disabled);
  assert.match(await page.locator("#result-holdings").innerText(),/Test Company/);
  assert.match(await page.locator("#result-exclusions").innerText(),/MISSING/);
  await page.locator("#lock-index").click();
  await page.waitForFunction(() => document.querySelector("#form-error").textContent.includes("temporary pin failure"));
  await page.locator("#lock-index").click();
  await page.waitForFunction(() => !document.querySelector("#open-basket").hidden);
  assert.deepEqual(locks,[{preview_sha256:hash},{preview_sha256:hash}]);
  await page.locator("#open-basket").click();
  await page.waitForFunction(() => document.querySelector("#basket-api-key"));
  assert.equal(await page.locator("#basket-api-key").inputValue(),key);
  assert.match(page.url(),/\?index=fixture-preview/);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length),0);
  assert.equal(await page.evaluate(() => window.CorbanuIndexSession),undefined);
  assert.equal(creates.length,2);
  assert.equal(await page.getByRole("button",{name:"MetaMask: 0x1111…1111",exact:true}).count(),1);
  await page.locator("#basket-amount").fill("100.000001");
  await page.locator("#prepare-felix-trades").click();
  await page.getByRole("link",{name:"Trade TEST on Felix ↗",exact:true}).waitFor();
  assert.deepEqual(handoffs,[{amount_usdc_atomic:"100000001"}]);
  assert.equal(await page.getByRole("link",{name:"Trade TEST on Felix ↗",exact:true}).getAttribute("href"),"https://trade.usefelix.xyz/equities/TEST");
  assert.equal(await page.getByRole("link",{name:"Trade TEST on Felix ↗",exact:true}).getAttribute("rel"),"noopener noreferrer");
  assert.equal(await page.getByRole("textbox",{name:"TESTon USDC allocation"}).inputValue(),"100.000001");
  assert.match(await page.locator("#felix-trades").innerText(),/not transferred automatically/);
  const downloadPromise=page.waitForEvent("download");
  await page.getByRole("button",{name:"Download basket allocations"}).click();
  const download=await downloadPromise;
  const exported=JSON.parse(await readFile(await download.path(),"utf8"));
  assert.equal(exported.index_sha256,hash);
  assert.equal(JSON.stringify(exported).includes(key),false);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,"basket must fit mobile viewport");
  await page.locator("#basket-amount").fill("200");
  assert.equal(await page.locator("#felix-trades").innerText(),"");
  await page.locator("#basket-amount").fill("0");
  await page.locator("#prepare-felix-trades").click();
  assert.equal(handoffs.length,1,"invalid amounts must not prepare orders");
  await page.evaluate(()=>window.walletListeners.accountsChanged([]));
  assert.equal(await page.getByRole("button",{name:"Connect MetaMask",exact:true}).count(),1);
  assert.equal(await page.locator("#claim-index").isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.walletCalls.some(c=>c.method==="personal_sign"||c.method==="eth_sendTransaction")),false);

  // A saved-preview navigation uses the index session and loads without re-entering a key or submitting the creation form.
  const resumed = await context.newPage(); resumed.on("pageerror",e=>errors.push(e.message));
  await resumed.goto(origin+"/indexes/?preview=fixture-preview");
  await resumed.waitForFunction(() => !document.querySelector("#lock-index").disabled);
  assert.equal(await resumed.locator("#builder-api-key").inputValue(),"");
  await resumed.locator(".holding-detail summary").click();
  assert.match(await resumed.locator(".holding-content").innerText(),/Test thematic exposure/);
  assert.equal(creates.length,2);
  await resumed.setViewportSize({width:390,height:844});
  const overflow=await resumed.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow,false,"mobile page must not overflow horizontally");
  if (process.env.CORBANU_BROWSER_SCREENSHOT) await resumed.screenshot({path:process.env.CORBANU_BROWSER_SCREENSHOT,fullPage:true});

  needsData=true;
  await resumed.locator("#refresh-preview").click();
  await resumed.waitForFunction(() => document.querySelector("#job-status").textContent === "needs_data");
  assert.equal(await resumed.locator("#lock-index").isDisabled(),true);
  catalogUnavailable=true;
  const unavailable=await context.newPage(); await unavailable.goto(origin+"/indexes/");
  await unavailable.waitForFunction(() => !document.querySelector("#reload-catalog").hidden);
  assert.equal(await unavailable.locator("#run-index").isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log("Browser checks passed: live-schema builder, idempotent retry, progress, exclusions, pin recovery, basket handoff, resume, mobile layout and unavailable-state gates.");
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
