import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.CORBANU_PLAYWRIGHT_MODULE||'playwright');
const root=resolve(new URL('..',import.meta.url).pathname),browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();
const hash='a'.repeat(64),newHash='b'.repeat(64),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
const scores=[{security_id:'low',ticker:'LOW',score:25,confidence:88,reasoning_block:['Incidental exposure.']},{security_id:'high',ticker:'HIGH',score:80,confidence:70,reasoning_block:['Direct thematic exposure.']}];
const payload=cutoff=>({request:{mandate:{title:'Saved thematic basket',phrase:'Use the saved company scores'},relevance_cutoff:cutoff,weighting:'market_cap'},validity:{independent_inference_replay:false},scores,construction:{weights:scores.filter(s=>s.score>=cutoff).map(s=>({...s,company_name:s.ticker,weight_units:cutoff===70?1e12:s.score===25?86e10:14e10})),excluded:[]},...(cutoff===70?{derivation:{source_preview_id:'source'}}:{})});
const catalog={schema:'corbanu.index-workflow.v1',models:['corbanu/deepseek-v4.1-flash'],deterministic_default_model:'corbanu/deepseek-v4.1-flash',deterministic_available:false,reasoning_efforts:['high'],prompts:[{id:'thematic_v1',label:'Thematic'}],disclosure:{version:'fixture',market_opinion:'Opinion',indemnity:'Indemnity',token_exposure:'Token',publication:'Public'},disclosure_sha256:hash};
await context.route('https://corbanu.com/**',async route=>{const path=new URL(route.request().url()).pathname,file=resolve(root,'.'+path+(path.endsWith('/')?'index.html':''));try{await route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'image/png',body:await readFile(file)});}catch{await route.fulfill({status:404});}});
await context.route('https://api.corbanu.com/**',async route=>{
 const r=route.request(),path=new URL(r.url()).pathname,send=json=>route.fulfill({json});
 if(path.endsWith('/session'))return send({authenticated:true});
 if(path.endsWith('/catalog'))return send(catalog);
 if(path==='/v2/indexes/previews/source'||path==='/v2/indexes/previews/revised'){
  const revised=path.endsWith('/revised');return send({id:revised?'revised':'source',status:'completed',progress:{scored:2,total:2},preview_sha256:revised?newHash:hash,preview:{payload:payload(revised?70:20)}});
 }
 throw Error('Unexpected endpoint '+path);
});
try {
 await page.goto('https://corbanu.com/indexes/?preview=source');await page.locator('#index-result').waitFor({state:'visible'});
 assert.match(await page.locator('#result-construction').innerText(),/Minimum relevance: 20\/100/);assert.equal(await page.locator('.holding-detail').count(),2);
 assert.equal(await page.locator('#relevance-cutoff, #reweight-cutoff, #adjust-cutoff').count(),0);
 await page.goto('https://corbanu.com/indexes/?preview=revised');await page.locator('#index-result').waitFor({state:'visible'});
 assert.match(await page.locator('#result-construction').innerText(),/Minimum relevance: 70\/100/);
 assert.equal(await page.locator('.holding-detail').count(),1);assert.match(await page.locator('.holding-detail summary').innerText(),/HIGH/);assert.match(await page.locator('.holding-detail summary').innerText(),/100.00%/);
 assert.equal(await page.locator('#lock-index').isEnabled(),true);
 await page.reload();await page.locator('#index-result').waitFor({state:'visible'});assert.match(await page.locator('#result-construction').innerText(),/70\/100/);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);
 console.log('Passed: no website cutoff controls; historical API cutoffs remain accurate; 25-score/88-confidence holding excluded at 70; saved previews reload and fit mobile.');
}finally{await browser.close();}
