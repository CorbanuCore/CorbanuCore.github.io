import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.CORBANU_PLAYWRIGHT_MODULE||'playwright');
const root=resolve(new URL('..',import.meta.url).pathname),browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));let session=false,published=false,claimed=false,locks=0,creates=0;
const key='fixture-key',hash='a'.repeat(64),wallet='0x'+'1'.repeat(40);
const disclosure={version:'fixture',sha256:hash,accepted:true,conflicts:'None'};
const definition={mandate:{title:'Saved <theme>',phrase:'Frozen test market opinion'},workflow:{external_funds:false,prompt:null,disclosure}};
const payload={request:definition,definition,validity:{independent_inference_replay:false},disclosure:{token_exposure:'Token disclosure'},scores:[{security_id:'felix:TESTon',confidence:'high',reasoning_block:['A saved scoring explanation.']}],construction:{weights:[{security_id:'felix:TESTon',ticker:'TEST',company_name:'Test Company',score:80,weight_units:1e12,representation:{venue:'felix',chain_id:'eip155:1',venue_symbol:'TESTon',contract_address:'0x'+'2'.repeat(40),underlying:{ticker:'TEST'}}}]}};
const catalog={schema:'corbanu.index-workflow.v1',models:['corbanu/deepseek-v4.1-flash'],deterministic_default_model:'corbanu/deepseek-v4.1-flash',deterministic_available:false,reasoning_efforts:['high'],prompts:[{id:'thematic_v1',label:'Thematic'}],disclosure:{...disclosure,market_opinion:'Opinion',indemnity:'Indemnity',token_exposure:'Token',publication:'Public consent'},disclosure_sha256:hash};
await context.route('https://corbanu.com/**',async route=>{const path=new URL(route.request().url()).pathname;const file=resolve(root,'.'+path+(path.endsWith('/')?'index.html':''));try{await route.fulfill({contentType:extname(file)==='.js'?'text/javascript':extname(file)==='.css'?'text/css':extname(file)==='.html'?'text/html':'image/png',body:await readFile(file)});}catch{await route.fulfill({status:404});}});
await context.route('https://api.corbanu.com/**',async route=>{
 const request=route.request(),path=new URL(request.url()).pathname,send=(json,status=200)=>route.fulfill({status,json});
 if(path==='/v2/indexes/session'){if(request.method()==='POST'){assert.equal(request.headers().authorization,`Bearer ${key}`);session=true;}if(request.method()==='DELETE')session=false;return send({authenticated:session},session?200:401);}
 if(path.endsWith('/catalog'))return send(catalog);
 if(path==='/v2/indexes/published')return send({indexes:published?[{id:'fixture',title:definition.mandate.title,mandate:definition.mandate.phrase,constituent_count:1,deterministic:false,external_funds:false}]:[]});
 if(path==='/v2/indexes/published/fixture')return published?send({id:'fixture',state:'published',public:true,public_cid:'public',index_sha256:hash,claim:{wallet},artifact:{payload:{index:{payload}}}}):send({error:'Not published'},404);
 if(!session)return send({error:'Sign in'},401);
 if(path==='/v2/indexes')return send({limit:100,indexes:[{id:'fixture',title:definition.mandate.title,mandate:definition.mandate.phrase,state:published?'published':locks?'locked':'completed',progress:{scored:1,total:1},created_at:new Date().toISOString(),public:published,page_url:`https://corbanu.com/indexes/?${locks?'index':'preview'}=fixture`,result_available:true}]});
 if(path==='/v2/indexes/previews'){creates++;return send({},500);}
 if(path==='/v2/indexes/previews/fixture')return send({id:'fixture',status:'completed',progress:{scored:1,total:1},preview_sha256:hash,preview:{payload}});
 if(path==='/v2/indexes/fixture/lock'){locks++;return send({id:'fixture',state:'locked'});}
 if(path==='/v2/indexes/fixture')return locks?send({id:'fixture',state:published?'published':'locked',public:published,index_sha256:hash,claim:claimed?{wallet}:null,artifact:{payload}}):send({error:'Not locked'},404);
 if(path.endsWith('/claim-challenge'))return send({nonce:'nonce',message:'Synthetic creator claim'});
 if(path.endsWith('/claim')){claimed=true;return send({});}
 if(path.endsWith('/publish')){assert.equal(request.postDataJSON().accepted,true);published=true;return send({});}
 throw Error('Unexpected endpoint '+path);
});
await page.addInitScript(wallet=>{window.ethereum={isMetaMask:true,on(){},request:async({method})=>{if(method==='personal_sign')return 'fixture-signature';return [wallet];}};},wallet);
try{
 await page.goto('https://corbanu.com/indexes/mine/');await page.locator('#my-indexes-key').fill(key);await page.locator('#load-my-indexes').click();
 await page.getByRole('link',{name:'Open preview →',exact:true}).click();
 await page.getByRole('button',{name:'Confirm holdings and lock index',exact:true}).waitFor();
 assert.equal(await page.locator('#builder-api-key').inputValue(),'');assert.equal(creates,0);
 await page.locator('.holding-detail summary').click();await page.getByText('A saved scoring explanation.',{exact:true}).waitFor();
 await page.locator('#lock-index').click();await page.locator('#open-basket').click();
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
 await page.locator('#creator-tools > summary').click();await page.locator('#claim-index').click();
 await page.waitForFunction(()=>document.querySelector('#claim-index').disabled);
 assert.equal(await page.locator('#publish-index').isDisabled(),true);
 await page.locator('#publish-consent').check();await page.locator('#publish-index').click();
 await page.getByRole('link',{name:'View index leaderboard →',exact:true}).click();
 await page.locator('.library-row-toggle').click();await page.locator('.holding-detail summary').click();await page.getByText('A saved scoring explanation.',{exact:true}).waitFor();
 await page.locator('#library-search').fill('absent');assert.equal(await page.locator('.library-row').count(),0);await page.locator('#library-search').fill('');
 // Another browser session can inspect a published artifact without creator privileges.
 session=false;await page.locator('.library-row-toggle').click();await page.getByRole('link',{name:'Open index →',exact:true}).click();await page.getByRole('heading',{name:'Saved <theme>',exact:true}).waitFor();
 assert.equal(await page.locator('#creator-tools').isVisible(),false);assert.equal(await page.locator('#buy-index-wallet').isDisabled(),true,'non-replayed public snapshots cannot attract external funds');
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.equal(creates,0);assert.equal(locks,1);assert.deepEqual(errors,[]);
 console.log('Passed click-through: My indexes → saved preview → expandable reasoning → exact lock → wallet claim → consented publication → searchable public leaderboard → public detail with investor gate. No new inference job.');
}finally{await browser.close();}
