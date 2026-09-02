import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function importTypeScript(path) {
  const source = await read(path);
  const transformed = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "node20",
  });
  const encoded = Buffer.from(transformed.code).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("API page documents supported wallet/network combinations and Terminal key generation", async () => {
  const html = await read("api/index.html");
  assert.match(html, /Phantom/);
  assert.match(html, /Solana mainnet/);
  assert.match(html, /MetaMask/);
  assert.match(html, /Base/);
  assert.match(html, /Ethereum/);
  assert.match(html, /native USDC/);
  assert.match(html, /Top up an existing key/);
  assert.match(html, /type="password"/);
  assert.match(html, /never saved in browser storage/);
  for (const network of ["solana", "base", "ethereum"]) {
    assert.match(
      html,
      new RegExp(`data-connect-wallet="phantom" data-connect-network="${network}"`),
    );
  }
  for (const network of ["base", "ethereum"]) {
    assert.match(
      html,
      new RegExp(`data-connect-wallet="metamask" data-connect-network="${network}"`),
    );
  }
  assert.match(html, /\/wallet/);
  assert.match(html, /Corbanu API/);
  assert.match(html, /Authorization: Bearer/);
  assert.match(html, /\/v1\/models/);
  assert.match(html, /shown only once|revealed once/);
  assert.match(html, /api-checkout\.js\?v=20260902-7/);
});

test("API reference covers inference and the complete Deep Research lifecycle with brand typography", async () => {
  const [html, css] = await Promise.all([
    read("api/index.html"),
    read("assets/css/corbanu-api.css"),
  ]);

  assert.match(html, /family=IBM\+Plex\+Mono/);
  assert.match(html, /family=Inter\+Tight/);
  assert.match(html, /corbanu-api\.css\?v=20260902-2/);
  assert.doesNotMatch(html, /<\/?em(?:\s|>)/i);
  assert.doesNotMatch(css, /Georgia|Times New Roman|Helvetica|font-style:\s*italic/i);
  assert.match(css, /--sans: "Inter Tight"/);
  assert.match(css, /--mono: "IBM Plex Mono"/);
  assert.match(html, /https:\/\/api\.corbanu\.com/);
  assert.doesNotMatch(html, /pfterminal-plan-gateway\.fly\.dev/);

  for (const contract of [
    "/v1/models",
    "/v1/account",
    "/v1/chat/completions",
    "/v1/messages",
    "/v1/deep-research",
    "/v1/deep-research/:id",
    "/v1/deep-research/:id/result",
    "X-Corbanu-Request-Id",
    "X-Corbanu-Price-Version",
    "X-Corbanu-Reserved-Microusd",
    "token_budget",
    "supportsStreaming",
    "result.markdown",
    "source manifest",
    "total provider cost",
    "deep_research_requires_plan",
    "X-Corbanu-Privacy: non-private",
  ]) {
    assert.match(html, new RegExp(contract.replaceAll("/", "\\/")));
  }
  for (const status of ["400", "401", "402", "403", "409", "429", "503"]) {
    assert.match(html, new RegExp(`<code>${status}<\\/code>`));
  }

  const copyTargets = [...html.matchAll(/data-copy-target="#([^"]+)"/g)].map(match => match[1]);
  assert.ok(copyTargets.length >= 10);
  assert.equal(new Set(copyTargets).size, copyTargets.length);
  for (const target of copyTargets) assert.match(html, new RegExp(`id="${target}"`));
});

test("wallet router supports Phantom across all rails and rejects unsupported combinations", async () => {
  const {
    parseWalletSelection,
    selectMetaMaskEvmProvider,
    selectPhantomEvmProvider,
  } = await importTypeScript("assets/src/wallet-routing.ts");

  assert.deepEqual(parseWalletSelection("phantom", "solana"), {
    wallet: "phantom",
    rail: "solana",
  });
  assert.deepEqual(parseWalletSelection("phantom", "base"), {
    wallet: "phantom",
    rail: "base",
  });
  assert.deepEqual(parseWalletSelection("phantom", "ethereum"), {
    wallet: "phantom",
    rail: "ethereum",
  });
  assert.deepEqual(parseWalletSelection("metamask", "base"), {
    wallet: "metamask",
    rail: "base",
  });
  assert.deepEqual(parseWalletSelection("metamask", "ethereum"), {
    wallet: "metamask",
    rail: "ethereum",
  });
  assert.equal(parseWalletSelection("metamask", "solana"), undefined);
  assert.equal(parseWalletSelection("phantom", "polygon"), undefined);
  assert.equal(parseWalletSelection(undefined, "base"), undefined);

  const phantom = { isPhantom: true };
  const metamask = { isMetaMask: true };
  const collision = { isPhantom: true, providers: [phantom, metamask] };
  assert.equal(selectPhantomEvmProvider(phantom), phantom);
  assert.equal(selectPhantomEvmProvider(metamask), undefined);
  assert.equal(selectMetaMaskEvmProvider(collision), metamask);
  assert.equal(selectMetaMaskEvmProvider(phantom), undefined);
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
  assert.match(source, /window\.phantom\?\.ethereum/);
  assert.match(source, /selectMetaMaskEvmProvider\(window\.ethereum\)/);
  assert.match(source, /payWithEvmWallet/);
  assert.match(source, /\/v1\/topups\/intents\/key/);
  assert.match(source, /Existing key topped up/);
  assert.match(source, /headers\.set\("Authorization"/);
  assert.doesNotMatch(source, /localStorage\.setItem|sessionStorage/);
  assert.doesNotMatch(source, /registerExactEvmScheme|signTypedData/);
  assert.match(source, /savePendingEvmPayment\(window\.localStorage/);
  assert.doesNotMatch(source, /privateKey|seedPhrase|mnemonic/i);
});

test("EVM settlement polling distinguishes pending, settled, retry, and invalid responses", async () => {
  const { classifyEvmSettlementResponse } = await importTypeScript("assets/src/evm-settlement.ts");
  const response = (status, state) => ({
    status,
    async json() {
      return { state };
    },
  });

  assert.equal(await classifyEvmSettlementResponse(response(202, "pending")), "pending");
  assert.equal(await classifyEvmSettlementResponse(response(200, "settled")), "settled");
  assert.equal(await classifyEvmSettlementResponse(response(503)), "retry");
  assert.equal(await classifyEvmSettlementResponse(response(400)), "error");
  await assert.rejects(
    classifyEvmSettlementResponse(response(202, "settled")),
    /inconsistent settlement data \(HTTP 202\)/,
  );
  await assert.rejects(
    classifyEvmSettlementResponse(response(200, "pending")),
    /inconsistent settlement data \(HTTP 200\)/,
  );
});

test("submitted EVM payment recovery survives reloads without storing API credentials", async () => {
  const recoverySource = await read("assets/src/evm-settlement.ts");
  const {
    PENDING_EVM_PAYMENTS_STORAGE_KEY,
    clearPendingEvmPayment,
    pendingEvmPaymentForWallet,
    pendingPaymentCheckoutMode,
    savePendingEvmPayment,
    shouldCreateApiKeyWithoutPayment,
  } = await importTypeScript("assets/src/evm-settlement.ts");
  const storage = memoryStorage();
  const payment = {
    walletAddress: "0x1111111111111111111111111111111111111111",
    intentId: "9f86df99-b6fb-4ab4-a109-7f46ec4ed7f6",
    transaction: `0x${"2".repeat(64)}`,
    network: "eip155:1",
    networkName: "Ethereum",
  };

  savePendingEvmPayment(storage, payment);
  assert.deepEqual(pendingEvmPaymentForWallet(storage, payment.walletAddress.toUpperCase()), payment);
  assert.equal(pendingPaymentCheckoutMode(payment), "new_key");
  const existingKeyPayment = { ...payment, checkoutMode: "existing_key" };
  savePendingEvmPayment(storage, existingKeyPayment);
  assert.equal(
    pendingPaymentCheckoutMode(pendingEvmPaymentForWallet(storage, payment.walletAddress)),
    "existing_key",
  );
  assert.match(storage.getItem(PENDING_EVM_PAYMENTS_STORAGE_KEY), /existing_key/);
  clearPendingEvmPayment(storage, payment.walletAddress);
  assert.equal(pendingEvmPaymentForWallet(storage, payment.walletAddress), undefined);
  assert.equal(shouldCreateApiKeyWithoutPayment("10000000", 0), true);
  assert.equal(shouldCreateApiKeyWithoutPayment("10000000", 1), false);
  assert.equal(shouldCreateApiKeyWithoutPayment("0", 0), false);
  assert.equal(shouldCreateApiKeyWithoutPayment("not-a-balance", 0), false);
  assert.doesNotMatch(recoverySource, /CreatedApiKey|revealedKey|privateKey|seedPhrase|mnemonic/i);
});

test("compiled checkout and site navigation are publishable static assets", async () => {
  const [bundle, homepage, css, packageJson] = await Promise.all([
    read("assets/js/api-checkout.js"),
    read("index.html"),
    read("assets/css/corbanu-api.css"),
    read("package.json"),
  ]);
  assert.ok(bundle.length > 10_000);
  assert.match(bundle, /https:\/\/api\.corbanu\.com/);
  assert.doesNotMatch(bundle, /pfterminal-plan-gateway\.fly\.dev/);
  assert.match(homepage, /href="\/api\/"/);
  assert.doesNotMatch(packageJson, /@x402\/evm|viem/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
});
