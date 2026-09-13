import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.CORBANU_PLAYWRIGHT_MODULE||'playwright');
const root=resolve(new URL('..',import.meta.url).pathname),browser=await chromium.launch(),context=await browser.newContext(),page=await context.newPage();
let handoffs=0,delayHandoff=false,releaseHandoff,delayIndex=false,releaseIndex;const errors=[];page.on('pageerror',e=>errors.push(e.message));
const hash='a'.repeat(64),artifact={payload:{definition:{mandate:{title:'Wallet state test',phrase:'Synthetic state boundary test'},relevance_cutoff:70,weighting:'market_cap_rank',workflow:{external_funds:false,disclosure:{conflicts:'None'}}},construction:{weights:[]},validity:{independent_inference_replay:false},disclosure:{token_exposure:'Synthetic'}}};
await context.route('https://corbanu.com/**',async route=>{const path=new URL(route.request().url()).pathname,file=resolve(root,'.'+path+(path.endsWith('/')?'index.html':''));try{await route.fulfill({body:await readFile(file),contentType:({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[extname(file)]||'image/png'});}catch{await route.fulfill({status:404});}});
await context.route('https://api.corbanu.com/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path.endsWith('/session'))return route.fulfill({json:{authenticated:true}});
 if(path==='/v2/indexes/fixture'){if(delayIndex)await new Promise(r=>releaseIndex=r);return route.fulfill({json:{id:'fixture',state:'locked',public:false,index_sha256:hash,artifact}});}
 if(path.endsWith('/felix-handoff')){handoffs++;if(delayHandoff)await new Promise(r=>releaseHandoff=r);return route.fulfill({json:{index_id:'fixture',index_sha256:hash,kind:'external_manual',amount_usdc_atomic:'100000000',instructions:'Synthetic',legs:[]}});}
 throw Error('Unexpected API '+path);
});
const changeKey=async()=>page.evaluate(()=>{const k=document.querySelector('#basket-api-key');k.value='changed-fixture-key';k.dispatchEvent(new Event('input',{bubbles:true}));});
try {
 await page.goto('https://corbanu.com/indexes/?index=fixture');await page.getByRole('heading',{name:'Wallet state test',exact:true}).waitFor();
 await page.locator('#basket-amount').fill('100');await page.locator('#basket-slippage').fill('100');
 await page.evaluate(()=>{window.fixtureLogins=0;window.CorbanuFelix.login=async()=>{window.fixtureLogins++;return '0x'+'1'.repeat(40);};});
 await changeKey();
 assert.equal(await page.locator('#buy-index-wallet').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Estimate basket',exact:true}).isDisabled(),true);
 // Even a synthetic click cannot reach login or dereference an absent index.
 await page.locator('#buy-index-wallet').dispatchEvent('click');assert.equal(await page.evaluate(()=>window.fixtureLogins),0);
 assert.equal(await page.locator('#buy-index-wallet').isDisabled(),true);assert.ok(!(await page.locator('[role=status]').innerText()).includes('Cannot read'));
 await page.getByRole('button',{name:'Open index',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#buy-index-wallet').disabled);
 // Changing auth during a pending handoff must ignore the stale response.
 delayHandoff=true;await page.locator('#prepare-felix-trades').click();
 while(!releaseHandoff)await new Promise(r=>setTimeout(r,10));
 await changeKey();releaseHandoff();
 await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('prepare the basket again'));
 assert.equal(await page.locator('#felix-trades').innerText(),'');assert.equal(await page.locator('#buy-index-wallet').isDisabled(),true);
 // Account changes during Felix login must stop before any handoff/quote.
 delayHandoff=false;await page.getByRole('button',{name:'Open index',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#buy-index-wallet').disabled);
 await page.evaluate(()=>{window.CorbanuFelix.login=async()=>{window.fixtureLogins++;return new Promise(r=>window.releaseLogin=()=>r('0x'+'1'.repeat(40)));};});
 const prior=handoffs;await page.locator('#buy-index-wallet').click();await page.waitForFunction(()=>!!window.releaseLogin);
 await changeKey();await page.evaluate(()=>window.releaseLogin());
 await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('prepare the basket again'));
 assert.equal(handoffs,prior);assert.equal(await page.locator('#wallet-execution').innerText(),'');assert.equal(await page.locator('#buy-index-wallet').isDisabled(),true);
 // A delayed owner lookup from an earlier key cannot restore a stale basket.
 delayIndex=true;await page.getByRole('button',{name:'Open index',exact:true}).click();while(!releaseIndex)await new Promise(r=>setTimeout(r,10));
 await changeKey();releaseIndex();await page.waitForTimeout(100);
 assert.equal(await page.locator('#buy-index-wallet').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Estimate basket',exact:true}).isDisabled(),true);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);
 console.log('Passed: key invalidation disables trading; stale handoff, Felix login and index loads cannot restore or execute an obsolete basket; no null access or transactions.');
} finally {await browser.close();}
