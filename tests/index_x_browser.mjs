import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.CORBANU_PLAYWRIGHT_MODULE||'playwright');
const root=resolve(new URL('..',import.meta.url).pathname),browser=await chromium.launch(),page=await browser.newPage();let starts=0;const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('https://corbanu.com/**',async r=>{const p=new URL(r.request().url()).pathname;try{await r.fulfill({body:await readFile(resolve(root,'.'+p+(p.endsWith('/')?'index.html':''))),contentType:({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[extname(p)]||'text/html'});}catch{await r.fulfill({status:404});}});
await page.route('https://api.corbanu.com/**',async r=>{const p=new URL(r.request().url()).pathname;
if(p.endsWith('/session'))return r.fulfill({json:{authenticated:true}});
if(p.endsWith('/claim-x')){starts++;return r.fulfill({json:{redirect_url:'https://x.com/i/oauth2/authorize?state=synthetic'}});}
return r.fulfill({json:{id:'fixture',state:'published',public:true,index_sha256:'a'.repeat(64),artifact:{payload:{definition:{mandate:{title:'X claim test',phrase:'A user theme'},workflow:{external_funds:false,disclosure:{}}},validity:{independent_inference_replay:false},construction:{weights:[]},disclosure:{}}}}});});
await page.route('https://x.com/**',r=>r.fulfill({body:'X authorization fixture',contentType:'text/html'}));
try{await page.goto('https://corbanu.com/indexes/?index=fixture');await page.getByRole('heading',{name:'X claim test',exact:true}).waitFor();await page.locator('#creator-tools > summary').click();assert.equal(await page.locator('#claim-index-x').isEnabled(),true);assert.equal(await page.locator('#claim-index').isDisabled(),true);await page.locator('#claim-index-x').click();await page.waitForURL('https://x.com/**');assert.equal(starts,1);await page.goto('https://corbanu.com/indexes/?index=fixture&x_claim=failed');await page.getByText('X claiming could not be completed. Try Claim with X again under Creator ownership & publication.',{exact:true}).waitFor();assert.equal(await page.locator('#creator-tools').getAttribute('open'),'');assert.equal(await page.locator('#claim-index-x').isEnabled(),true);assert.deepEqual(errors,[]);console.log('X claim starts without a MetaMask wallet and navigates to authorization.');}finally{await browser.close();}
