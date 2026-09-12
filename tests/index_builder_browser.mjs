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
const errors = [], creates = [], locks = [];
let reads = 0, needsData = false, catalogUnavailable = false;
const hash = "a".repeat(64), key = "synthetic-test-key-not-a-real-credential";
const catalog = {schema:"corbanu.index-workflow.v1", models:["corbanu/deepseek-v4.1-flash","corbanu/glm-5.3"],
  deterministic_default_model:"corbanu/deepseek-v4.1-flash", deterministic_available:false,
  reasoning_efforts:["low","high","max"], prompts:[{id:"thematic_v1",label:"Thematic relevance"},{id:"custom",label:"Custom"}],
  disclosure:{version:"fixture-v1",market_opinion:"Synthetic market opinion disclosure",indemnity:"Synthetic indemnity",token_exposure:"Synthetic token disclosure",publication:"Synthetic public consent"}, disclosure_sha256:hash};
const payload = {request:{mandate:{title:"Synthetic theme",phrase:"A synthetic theme used only for browser verification."}},
  validity:{independent_inference_replay:false},construction:{weights:[{ticker:"TEST",company_name:"Test Company",score:80,weight_units:1000000000000,representation:{venue_symbol:"TESTon",contract_address:"0x"+"1".repeat(40)}}],excluded:[{ticker:"MISSING",error:"capitalization_unavailable"}]}};
await context.route("https://api.corbanu.com/**", async route => {
  const req = route.request(), path = new URL(req.url()).pathname;
  const send = (value, status=200) => route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
  if (path.endsWith("/catalog")) return catalogUnavailable ? send({error:"catalog unavailable"},503) : send(catalog);
  if (path === "/v2/indexes/previews") {
    creates.push({body:req.postDataJSON(),id:req.headers()["x-corbanu-request-id"],key:req.headers().authorization});
    if (creates.length === 1) return route.abort("failed");
    return send({id:"fixture-preview",status:"queued",progress:{scored:0,total:2}},202);
  }
  if (path === "/v2/indexes/previews/fixture-preview") {
    reads++;
    if (reads === 1) return send({id:"fixture-preview",status:"running",progress:{scored:1,total:2}});
    return send({id:"fixture-preview",status:needsData?"needs_data":"completed",progress:{scored:2,total:2},preview_sha256:needsData?null:hash,preview:{payload}});
  }
  if (path.endsWith("/lock")) {
    locks.push(req.postDataJSON());
    if (locks.length === 1) return send({error:"temporary pin failure"},502);
    return send({id:"fixture-preview",state:"locked",cache_cid:"test-cid"});
  }
  if (path === "/v2/indexes/fixture-preview") {
    assert.equal(req.headers().authorization,`Bearer ${key}`);
    return send({id:"fixture-preview",state:"locked",public:false,artifact:{payload:{...payload,definition:payload.request,disclosure:catalog.disclosure}}});
  }
  throw new Error("Unexpected request: " + path);
});
try {
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
  assert.equal(await page.getByRole("button",{name:"Connected: 0x"+"1".repeat(40),exact:true}).count(),1);
  await page.evaluate(()=>window.walletListeners.accountsChanged([]));
  assert.equal(await page.getByRole("button",{name:"Connect MetaMask",exact:true}).count(),1);
  assert.equal(await page.getByRole("button",{name:"Claim creator ownership",exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.walletCalls.some(c=>c.method==="personal_sign"||c.method==="eth_sendTransaction")),false);

  // Reloaded preview asks for a key and retrieves the job without creating it again.
  const resumed = await context.newPage(); resumed.on("pageerror",e=>errors.push(e.message));
  await resumed.goto(origin+"/indexes/?preview=fixture-preview");
  await resumed.waitForFunction(() => !document.querySelector("#run-index").disabled);
  assert.equal(await resumed.locator("#builder-api-key").inputValue(),"");
  await resumed.locator("#builder-api-key").fill(key);
  await resumed.locator("#run-index").click();
  await resumed.waitForFunction(() => !document.querySelector("#lock-index").disabled);
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
