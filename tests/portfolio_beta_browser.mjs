import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {chromium} from 'playwright';
const root = resolve(new URL('..', import.meta.url).pathname);
const day = 86400000, now = Date.now(), end = Math.floor(now/day)*day-1;
const series = {}; let bookPrice = 1000, spxPrice = 1000, btcPrice = 10000;
for (let i=0; i<=94; i++) {
  const T = end-(94-i)*day, x = ((i%5)-2)*.01;
  if (i) { bookPrice*=1+1.5*x+.001; spxPrice*=1+x; btcPrice*=1-2*x; }
  for (const [s,price] of [['xyz:FIXTURE',bookPrice],['xyz:SP500',spxPrice],['BTC',btcPrice]]) {
    (series[s] ||= []).push({s,i:'1d',t:T-day+1,T,c:String(price)});
  }
}
for (const s of Object.keys(series)) series[s].push({s,i:'1d',t:end+1,T:end+day,c:'1000000000'});
const iso = t => new Date(t).toISOString();
const ledger = {schema:'corbanu.portfolio.v1',state:'ready',initialCapital:1000,inception:iso(end-30*day-12*3600000),positions:[
  {id:'fixture',symbol:'FIXTURE',name:'Synthetic beta holding',rawSymbol:'xyz:FIXTURE',markAdapter:'hyperliquid'}],events:[]};
function entry() {
  const first = series['xyz:FIXTURE'].find(row=>row.T>=Date.parse(ledger.inception));
  ledger.events=[{id:'entry',positionId:'fixture',type:'trade',at:ledger.inception,quantity:1000/Number(first.c),price:Number(first.c),targetWeightPct:100}];
}
entry();
const marks = {schema:'corbanu.portfolio-marks.v1',observations:[{at:iso(end),marks:{fixture:{price:bookPrice,observedAt:iso(end),source:'Synthetic daily close'}}}]};
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}});
let rejectDaily=false, requests=[]; const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('https://corbanu.com/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/assets/portfolio/ledger.json')return route.fulfill({json:ledger});
  if(path==='/assets/portfolio/marks.json')return route.fulfill({json:marks});
  if(path==='/assets/portfolio/statistics.json')return route.fulfill({json:{schema:'corbanu.portfolio-statistics.v1',positions:{}}});
  const file=resolve(root,'.'+path+(path.endsWith('/')?'index.html':''));
  try{await route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[extname(file)]||'image/png',body:await readFile(file)});}catch{await route.fulfill({status:404});}
});
await page.route('https://api.hyperliquid.xyz/**',async route=>{
  const body=route.request().postDataJSON();
  if(body.type==='metaAndAssetCtxs')return route.fulfill({json:[{universe:[{name:'xyz:FIXTURE'}]},[{markPx:String(bookPrice)}]]});
  assert.equal(body.type,'candleSnapshot');assert.equal(body.req.interval,'1d');requests.push(body.req.coin);
  assert.ok(body.req.startTime>=Math.floor(now/day)*day-91*day);
  if(rejectDaily)return route.fulfill({status:503});
  return route.fulfill({json:series[body.req.coin].filter(row=>row.T>=body.req.startTime)});
});
await page.clock.install({time:new Date(now)});
try {
  await page.goto('https://corbanu.com/portfolio/');
  const spx='[data-beta-days="30"] [data-benchmark="sp500"] strong',btc='[data-beta-days="30"] [data-benchmark="btc"] strong';
  await page.waitForFunction(()=>document.querySelector('[data-beta-days="30"] [data-benchmark="sp500"] strong')?.textContent==='+1.500');
  assert.equal(await page.locator(btc).textContent(),'−0.750');
  assert.equal(await page.locator('#portfolio-betas tr').count(),1);
  assert.match(await page.locator('#portfolio-beta-status').textContent(),/3M unavailable/);
  assert.match(await page.locator('#portfolio-betas').textContent(),/30\/30 paired daily returns/);
  assert.deepEqual([...new Set(requests)].sort(),['BTC','xyz:FIXTURE','xyz:SP500']);assert.equal(requests.length,3);
  rejectDaily=true;await page.clock.fastForward(300001);
  await page.waitForFunction(()=>document.querySelector('#portfolio-beta-status').textContent.includes('retained'));
  assert.equal(await page.locator(spx).textContent(),'+1.500');assert.equal(await page.locator(btc).textContent(),'−0.750');
  rejectDaily=false;ledger.inception=iso(end-94*day-12*3600000);entry();
  await page.clock.fastForward(300001);
  await page.waitForFunction(()=>document.querySelectorAll('#portfolio-betas tr').length===2);
  assert.equal(await page.locator('[data-beta-days="90"] [data-benchmark="sp500"] strong').textContent(),'+1.500');
  assert.equal(await page.locator('[data-beta-days="90"] [data-benchmark="btc"] strong').textContent(),'−0.750');
  assert.match(await page.locator('#portfolio-betas').textContent(),/90\/90 paired daily returns/);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('Beta browser checks passed: native-only daily requests, known positive/negative slopes, incomplete-day exclusion, 1M fallback, automatic 3M availability, retention, and mobile layout. Synthetic data only.');
} finally {await browser.close();}
