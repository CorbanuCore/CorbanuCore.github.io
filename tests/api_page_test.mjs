import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("API page documents all three qualified USDC rails and Terminal key generation", async () => {
  const html = await read("api/index.html");
  assert.match(html, /Phantom/);
  assert.match(html, /Solana mainnet/);
  assert.match(html, /MetaMask/);
  assert.match(html, /Base/);
  assert.match(html, /Ethereum/);
  assert.match(html, /native USDC/);
  assert.match(html, /\/wallet/);
  assert.match(html, /Corbanu API/);
  assert.match(html, /Authorization: Bearer/);
  assert.match(html, /\/v1\/models/);
  assert.match(html, /shown only once|revealed once/);
  assert.match(html, /api-checkout\.js\?v=20260902-3/);
});

test("browser checkout binds sensitive account changes to wallet proofs", async () => {
  const source = await read("assets/src/api-checkout.ts");
  for (const operation of ["top_up_intent", "account", "create_key"]) {
    assert.match(source, new RegExp(`kind: "${operation}"`));
  }
  assert.match(source, /\/v1\/wallet\/challenge/);
  assert.match(source, /\/v1\/wallet\/execute/);
  assert.match(source, /signOwnership/);
  assert.match(source, /messageFormat: "siwx"/);
  assert.match(source, /signingChainId/);
  assert.match(source, /registerExactSvmScheme/);
  assert.match(source, /eth_sendTransaction/);
  assert.match(source, /\/v1\/topups\/settle-evm/);
  assert.match(source, /ETHEREUM_NETWORK = "eip155:1"/);
  assert.match(source, /a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/);
  assert.match(source, /evmPayments/);
  assert.doesNotMatch(source, /registerExactEvmScheme|signTypedData/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.doesNotMatch(source, /privateKey|seedPhrase|mnemonic/i);
});

test("compiled checkout and site navigation are publishable static assets", async () => {
  const [bundle, homepage, css, packageJson] = await Promise.all([
    read("assets/js/api-checkout.js"),
    read("index.html"),
    read("assets/css/corbanu-api.css"),
    read("package.json"),
  ]);
  assert.ok(bundle.length > 10_000);
  assert.match(bundle, /pfterminal-plan-gateway\.fly\.dev/);
  assert.match(homepage, /href="\/api\/"/);
  assert.doesNotMatch(packageJson, /@x402\/evm|viem/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
});
