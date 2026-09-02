import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("API page documents both qualified USDC rails and Terminal key generation", async () => {
  const html = await read("api/index.html");
  assert.match(html, /Phantom/);
  assert.match(html, /Solana mainnet/);
  assert.match(html, /MetaMask/);
  assert.match(html, /Base mainnet/);
  assert.match(html, /\/wallet/);
  assert.match(html, /Corbanu API/);
  assert.match(html, /Authorization: Bearer/);
  assert.match(html, /\/v1\/models/);
  assert.match(html, /shown only once|revealed once/);
});

test("browser checkout binds sensitive account changes to wallet proofs", async () => {
  const source = await read("assets/src/api-checkout.ts");
  for (const operation of ["top_up_intent", "account", "create_key"]) {
    assert.match(source, new RegExp(`kind: "${operation}"`));
  }
  assert.match(source, /\/v1\/wallet\/challenge/);
  assert.match(source, /\/v1\/wallet\/execute/);
  assert.match(source, /signOwnership/);
  assert.match(source, /registerExactSvmScheme/);
  assert.match(source, /registerExactEvmScheme/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.doesNotMatch(source, /privateKey|seedPhrase|mnemonic/i);
});

test("compiled checkout and site navigation are publishable static assets", async () => {
  const [bundle, homepage, css] = await Promise.all([
    read("assets/js/api-checkout.js"),
    read("index.html"),
    read("assets/css/corbanu-api.css"),
  ]);
  assert.ok(bundle.length > 10_000);
  assert.match(bundle, /pfterminal-plan-gateway\.fly\.dev/);
  assert.match(homepage, /href="\/api\/"/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
});
