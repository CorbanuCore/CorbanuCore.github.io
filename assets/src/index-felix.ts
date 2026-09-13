import {WalletStamper, WalletType} from '@turnkey/wallet-stamper';
import {createPublicClient, createWalletClient, custom, decodeFunctionData, encodeFunctionData, erc20Abi, formatUnits} from 'viem';
import {mainnet} from 'viem/chains';
import {FELIX_RETAILER_ABI} from './felix-retailer-abi';
const RETAILER='0x43cCcF67E57d4B7C31ed679b5d3dB6DD3966594f' as const;
const IMPLEMENTATION='0x11B49609EAaC8C9248F3128a6B76B89729bC0b7D';
const USDC='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;
const app=window as any;
let token:string|null=null,tokenWallet:string|null=null,expiry=0;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const hex=(b:Uint8Array)=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
async function login(){
  const account=app.CorbanuWallet.account||await app.CorbanuWallet.connect();
  if(token&&tokenWallet&&same(account,tokenWallet)&&expiry>Date.now()+30000)return account;
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const publicBytes=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
  const publicKey=(publicBytes[64]!%2?'03':'02')+hex(publicBytes.slice(1,33));
  const body=JSON.stringify({type:'ACTIVITY_TYPE_STAMP_LOGIN',organizationId:'b052e625-0ea1-4e6a-b3a4-dd3d8e06f636',timestampMs:String(Date.now()),parameters:{publicKey,expirationSeconds:'900'}});
  const stamper=new WalletStamper({type:WalletType.Ethereum,signMessage:message=>app.CorbanuWallet.signMessage(message,account),getPublicKey:async()=>{throw Error('Unexpected public-key request');}});
  const stamp=await stamper.stamp(body);
  const response=await fetch('https://api.turnkey.com/public/v1/submit/stamp_login',{method:'POST',headers:{'Content-Type':'application/json',[stamp.stampHeaderName]:stamp.stampHeaderValue},body,signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.message||`Felix wallet sign-in failed (${response.status}).`);
  const session=data.session||data.activity?.result?.stampLoginResult?.session;
  if(typeof session!=='string')throw new Error('Felix did not return a wallet session. Open Felix to finish account setup.');
  const encoded=session.split('.')[1]||'';
  const claims=JSON.parse(atob(encoded.replaceAll('-','+').replaceAll('_','/')));
  if(claims.public_key!==publicKey||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now()||!same(app.CorbanuWallet.account||'',account))throw new Error('Wallet changed or Felix returned an invalid session. Sign in again.');
  token=session;tokenWallet=account;expiry=claims.exp*1000;return account;
}
async function api(path:string,body:any,key?:string){
  if(!token||!tokenWallet||!same(tokenWallet,app.CorbanuWallet.account||'')||expiry<=Date.now())throw Error('Sign in to Felix again.');
  const headers:Record<string,string>={'Content-Type':'application/json','X-Felix-Session':token};
  if(key)headers.Authorization=`Bearer ${key}`;
  const response=await fetch('https://api.corbanu.com'+path,{method:'POST',credentials:'include',cache:'no-store',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||`Request failed (${response.status})`);return value;
}
async function clients(wallet:string){
  await app.CorbanuWallet.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1'}]},wallet);
  const transport=custom({request:args=>app.CorbanuWallet.request(args,wallet)});
  const publicClient=createPublicClient({chain:mainnet,transport});
  const walletClient=createWalletClient({account:wallet as `0x${string}`,chain:mainnet,transport});
  const implementation=await publicClient.getStorageAt({address:RETAILER,slot:SLOT});
  if(!implementation||!same('0x'+implementation.slice(-40),IMPLEMENTATION))throw Error('Felix upgraded its trading contract. Transaction validation must be updated before trading.');
  return {publicClient,walletClient};
}
function validate(q:any,indexId:string,hash:string,wallet:string,budget:bigint){
  if(q.index_id!==indexId||q.index_sha256!==hash||!same(q.wallet,wallet)||!same(q.trade.to,RETAILER)||q.trade.chainId!==1||BigInt(q.trade.value)!==0n||BigInt(q.deposit_usdc_atomic)!==budget)throw Error('Quote does not match this basket, wallet or amount.');
  const call=decodeFunctionData({abi:FELIX_RETAILER_ABI,data:q.trade.data});
  if(call.functionName!=='mintWithAttestation')throw Error('Unsupported trade.');
  const [attestation,,deposit,amount]=call.args;
  if(attestation.chainId!==1n||attestation.side!==0||!same(attestation.asset,q.representation.contract_address)||!same(deposit,USDC)||amount!==budget||attestation.quantity!==BigInt(q.token_amount_atomic))throw Error('Contract call does not match the stock purchase.');
  if(attestation.expiration*1000n<=BigInt(Date.now()+15000)||Date.parse(q.expires_at)<=Date.now()+15000)throw Error('Quote expired. Refresh this order.');
}
async function inspect(q:any,indexId:string,hash:string,wallet:string,budget:bigint){
  validate(q,indexId,hash,wallet,budget);
  const {publicClient}=await clients(wallet);
  const [balance,allowance,feeBps,gasPrice,eth]=await Promise.all([
    publicClient.readContract({address:USDC,abi:erc20Abi,functionName:'balanceOf',args:[wallet as `0x${string}`]}),
    publicClient.readContract({address:USDC,abi:erc20Abi,functionName:'allowance',args:[wallet as `0x${string}`,RETAILER]}),
    publicClient.readContract({address:RETAILER,abi:FELIX_RETAILER_ABI,functionName:'getBrokerageFee'}),publicClient.getGasPrice(),publicClient.getBalance({address:wallet as `0x${string}`})]);
  if(balance<budget)throw Error('Insufficient Ethereum USDC in the connected MetaMask wallet.');
  if(eth===0n)throw Error('Add ETH to the connected wallet for Ethereum gas.');
  let gas:bigint|null=null;
  if(allowance>=budget)gas=await publicClient.estimateGas({account:wallet as `0x${string}`,to:RETAILER,data:q.trade.data,value:0n});
  return {approval_required:allowance<budget,fee_usdc_atomic:budget*feeBps/10000n,gas_estimate_wei:gas===null?null:gas*gasPrice,token_amount:formatUnits(BigInt(q.token_amount_atomic),q.representation.decimals)};
}
async function approve(q:any,indexId:string,hash:string,wallet:string,budget:bigint,onHash:(hash:string)=>void){
  validate(q,indexId,hash,wallet,budget);const {publicClient,walletClient}=await clients(wallet);
  const data=encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[RETAILER,budget]});
  const gas=await publicClient.estimateGas({account:wallet as `0x${string}`,to:USDC,data,value:0n});
  const tx=await walletClient.sendTransaction({to:USDC,data,value:0n,gas:gas*120n/100n});onHash(tx);
  const receipt=await publicClient.waitForTransactionReceipt({hash:tx,timeout:180000});
  if(receipt.status!=='success')throw Error('USDC approval reverted. No purchase was submitted.');
  return tx;
}
async function receipt(hash:`0x${string}`,wallet:string){
  const {publicClient}=await clients(wallet);return publicClient.getTransactionReceipt({hash});
}
async function execute(q:any,indexId:string,hash:string,wallet:string,budget:bigint,onHash:(hash:string)=>void){
  validate(q,indexId,hash,wallet,budget);const {publicClient,walletClient}=await clients(wallet);
  const gas=await publicClient.estimateGas({account:wallet as `0x${string}`,to:RETAILER,data:q.trade.data,value:0n});
  // Check freshness again after RPC/simulation and before opening MetaMask.
  validate(q,indexId,hash,wallet,budget);
  const tx=await walletClient.sendTransaction({to:RETAILER,data:q.trade.data,value:0n,gas:gas*120n/100n});onHash(tx);
  const receipt=await publicClient.waitForTransactionReceipt({hash:tx,timeout:180000});
  if(receipt.status!=='success')throw Error('Purchase reverted on Ethereum.');return tx;
}
window.addEventListener('corbanu:wallet-changed',()=>{if(tokenWallet&&!same(tokenWallet,app.CorbanuWallet.account||'')){token=null;tokenWallet=null;expiry=0;}});
app.CorbanuFelix={login,api,inspect,approve,execute,validate,receipt};
