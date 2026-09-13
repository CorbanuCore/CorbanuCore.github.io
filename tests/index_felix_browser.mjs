import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';
import {encodeFunctionData,parseAbi} from 'viem';
const {chromium}=await import(process.env.CORBANU_PLAYWRIGHT_MODULE||'playwright');
const root=resolve(new URL('..',import.meta.url).pathname);
const browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const account=privateKeyToAccount('0x'+'18'.repeat(32)); // Explicit synthetic wallet; no live RPC or transactions.
const address=account.address,retailer='0x43cCcF67E57d4B7C31ed679b5d3dB6DD3966594f',implementation='0x11B49609EAaC8C9248F3128a6B76B89729bC0b7D';
const usdc='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',token='0x'+'2'.repeat(40),hash='a'.repeat(64),txHash='0x'+'b'.repeat(64);
const abi=parseAbi(['function mintWithAttestation((uint256 chainId,uint256 attestationId,bytes32 userId,address asset,uint256 price,uint256 quantity,uint256 expiration,uint8 side,bytes32 additionalData) quote,bytes signature,address depositToken,uint256 amount)']);
let quotes=0,reports=0,submitted=[];const expiry=()=>Math.floor(Date.now()/1000)+120;
const representation={venue:'felix',chain_id:'eip155:1',venue_symbol:'TESTon',contract_address:token,decimals:18,underlying:{ticker:'TEST'}};
const artifact={payload:{definition:{mandate:{title:'Test wallet basket',phrase:'Synthetic browser execution test'},workflow:{external_funds:false,disclosure:{conflicts:'None'}}},construction:{weights:[{security_id:'felix:TESTon',ticker:'TEST',score:80,weight_units:1e12,representation}]},validity:{independent_inference_replay:false},disclosure:{token_exposure:'Synthetic'}}};
await context.route('https://corbanu.com/**',async route=>{
 const path=new URL(route.request().url()).pathname,file=resolve(root,'.'+path+(path.endsWith('/')?'index.html':''));
 try{await route.fulfill({contentType:extname(file)==='.js'?'text/javascript':extname(file)==='.css'?'text/css':extname(file)==='.html'?'text/html':'image/png',body:await readFile(file)});}catch{await route.fulfill({status:404,body:''});}
});
await context.route('https://api.turnkey.com/**',async route=>{
 const b=route.request().postDataJSON();assert.equal(b.organizationId,'b052e625-0ea1-4e6a-b3a4-dd3d8e06f636');assert.ok(route.request().headers()['x-stamp']);
 const claims=Buffer.from(JSON.stringify({public_key:b.parameters.publicKey,exp:Math.floor(Date.now()/1000)+900})).toString('base64url');
 await route.fulfill({json:{activity:{result:{stampLoginResult:{session:`e30.${claims}.fixture`}}}}});
});
await context.route('https://api.corbanu.com/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/v2/indexes/fixture')return route.fulfill({json:{id:'fixture',state:'locked',public:false,index_sha256:hash,artifact}});
 if(path.endsWith('/felix-handoff'))return route.fulfill({json:{id:'fixture',index_id:'fixture',index_sha256:hash,amount_usdc_atomic:'100000000',legs:[{security_id:'felix:TESTon',amount_usdc_atomic:'100000000',amount_usdc:'100.000000',representation}]}});
 if(path.endsWith('/felix-quotes')){
  quotes++;assert.ok(route.request().headers()['x-felix-session']);assert.equal(route.request().postDataJSON().wallet,address);
  const expiration=expiry();return route.fulfill({json:{index_id:'fixture',index_sha256:hash,order_id:'order',wallet:address,representation,deposit_usdc_atomic:'100000000',token_amount_atomic:'100000000000000000000',expires_at:new Date(expiration*1000).toISOString(),report_token:{fixture:'sealed'},trade:{to:retailer,chainId:1,value:'0',data:encodeFunctionData({abi,functionName:'mintWithAttestation',args:[{chainId:1n,attestationId:1n,userId:'0x'+'0'.repeat(64),asset:token,price:10n**18n,quantity:100n*10n**18n,expiration:BigInt(expiration),side:0,additionalData:'0x'+'0'.repeat(64)},'0x1234',usdc,100000000n]})}}});
 }
 if(path.endsWith('/felix-orders/report')){reports++;return route.fulfill({status:reports===1?502:200,json:reports===1?{error:'Temporary report failure'}:{order:{status:'CONFIRMED'}}});}
 throw Error('Unexpected API '+path);
});
await page.exposeFunction('fixtureSign',data=>account.signMessage({message:{raw:data}}));
await page.exposeFunction('fixtureSent',tx=>{submitted.push(tx);return txHash;});
await page.addInitScript(({address,retailer,implementation,txHash})=>{
 const numberHex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
 window.fixtureAllowance=0n;window.fixtureDecline=true;window.fixtureCalls=[];
 window.ethereum={isMetaMask:true,on(){},request:async args=>{
  window.fixtureCalls.push(args);
  switch(args.method){
   case 'eth_accounts':case 'eth_requestAccounts':return [address];
   case 'personal_sign':return window.fixtureSign(args.params[0]);
   case 'wallet_switchEthereumChain':return null;
   case 'eth_chainId':return '0x1';
   case 'eth_getStorageAt':return '0x'+'0'.repeat(24)+implementation.slice(2);
   case 'eth_getBalance':return numberHex(10n**18n);
   case 'eth_gasPrice':return '0x3b9aca00';
   case 'eth_estimateGas':return '0x186a0';
   case 'eth_call':{
    const selector=args.params[0].data.slice(0,10);
    if(selector==='0xdd62ed3e')return numberHex(window.fixtureAllowance);
    if(selector==='0x70a08231')return numberHex(1000000000);
    return numberHex(10);
   }
   case 'eth_sendTransaction':{
    const tx=args.params[0];
    if(tx.to.toLowerCase()===retailer.toLowerCase()&&window.fixtureDecline){window.fixtureDecline=false;throw Object.assign(Error('User rejected'),{code:4001});}
    if(tx.data.startsWith('0x095ea7b3'))window.fixtureAllowance=100000000n;
    return window.fixtureSent(tx);
   }
   case 'eth_blockNumber':return '0x10';
   case 'eth_getTransactionReceipt':return {transactionHash:txHash,transactionIndex:'0x0',blockHash:'0x'+'c'.repeat(64),blockNumber:'0x10',from:address,to:retailer,cumulativeGasUsed:'0x186a0',gasUsed:'0x186a0',effectiveGasPrice:'0x3b9aca00',contractAddress:null,logs:[],logsBloom:'0x'+'0'.repeat(512),status:'0x1',type:'0x2'};
   default:throw Error('Unexpected RPC '+args.method);
  }
 }};
},{address,retailer,implementation,txHash});
try{
 await page.goto('https://corbanu.com/indexes/?index=fixture');
 await page.getByRole('heading',{name:'Test wallet basket',exact:true}).waitFor();
 await page.locator('#basket-amount').fill('100');await page.locator('#basket-slippage').fill('100');
 await page.locator('#buy-index-wallet').click();await page.getByRole('button',{name:'Get firm quote',exact:true}).click();
 await page.getByRole('button',{name:'Approve this USDC amount',exact:true}).waitFor({state:'visible'});
 assert.equal(submitted.length,0,'requesting quotes cannot send a transaction');
 await page.getByRole('button',{name:'Approve this USDC amount',exact:true}).click();
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Sign purchase in MetaMask').disabled);
 assert.equal(submitted.length,1);assert.ok(submitted[0].data.startsWith('0x095ea7b3'));assert.equal(BigInt('0x'+submitted[0].data.slice(-64)),100000000n,'approval is exact, never unlimited');
 await page.getByRole('button',{name:'Sign purchase in MetaMask',exact:true}).click();
 await page.getByRole('button',{name:'Get firm quote',exact:true}).click();
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Sign purchase in MetaMask').disabled);
 assert.equal(submitted.length,1,'rejected wallet signature cannot submit an order');
 await page.getByRole('button',{name:'Sign purchase in MetaMask',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#wallet-execution').textContent.includes('reporting needs retry'));
 assert.equal(submitted.length,2);assert.equal(submitted[1].to.toLowerCase(),retailer.toLowerCase());assert.equal(reports,1);
 await page.getByRole('button',{name:'Check transaction & retry Felix reporting',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#wallet-execution').textContent.includes('and reported to Felix'));
 assert.equal(reports,2);assert.equal(submitted.length,2,'report recovery cannot broadcast a second purchase');
 assert.equal(await page.getByRole('button',{name:'Get firm quote',exact:true}).isDisabled(),true);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'/mnt/HC_Volume_101713660/pfrpc/scratch/index-wallet-audit-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Passed real browser bundle: wallet stamp login, ABI-bound quote, exact approval, simulation, rejected signature, confirmed purchase, partial reporting recovery, duplicate prevention and mobile layout. All RPCs and venue responses were synthetic; no live funds moved.');
}finally{await browser.close();}
