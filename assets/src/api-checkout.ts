import { x402Client } from "@x402/core/client";
import type { Network } from "@x402/core/types";
import { wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import {
  address,
  getTransactionEncoder,
  type SignatureBytes,
  type SignatureDictionary,
  type Transaction,
  type TransactionWithinSizeLimit,
  type TransactionWithLifetime,
} from "@solana/kit";
import { VersionedTransaction } from "@solana/web3.js";
import { base58 } from "@scure/base";
import {
  classifyEvmSettlementResponse,
  clearPendingEvmPayment,
  pendingEvmPaymentForWallet,
  savePendingEvmPayment,
  shouldCreateApiKeyWithoutPayment,
  type PendingEvmPayment,
} from "./evm-settlement";
const API_ORIGIN = "https://pfterminal-plan-gateway.fly.dev";
const BASE_NETWORK = "eip155:8453";
const ETHEREUM_NETWORK = "eip155:1";
const ERC20_TRANSFER_SELECTOR = "a9059cbb";
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

type Rail = "solana" | "base" | "ethereum";
type EvmRail = Exclude<Rail, "solana">;

const EVM_NETWORKS: Record<EvmRail, {
  chainId: string;
  signingChainId: "1" | "8453";
  network: typeof BASE_NETWORK | typeof ETHEREUM_NETWORK;
  name: "Base" | "Ethereum";
  rpcUrl: string;
  explorerUrl: string;
  usdc: string;
}> = {
  base: {
    chainId: "0x2105",
    signingChainId: "8453",
    network: BASE_NETWORK,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  ethereum: {
    chainId: "0x1",
    signingChainId: "1",
    network: ETHEREUM_NETWORK,
    name: "Ethereum",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    explorerUrl: "https://etherscan.io",
    usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
};
type WalletOperation =
  | { kind: "account" }
  | { kind: "top_up_intent"; amountUsd: string }
  | { kind: "create_key" };

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display?: "utf8"): Promise<{ signature: Uint8Array }>;
  signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction>;
}

interface EthereumProvider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

interface ConnectedWallet {
  rail: Rail;
  address: string;
  signingChainId: "1" | "8453" | "solana:mainnet";
  signOwnership(message: string): Promise<string>;
  paidFetch?: (url: string, init: RequestInit) => Promise<Response>;
  ethereumProvider?: EthereumProvider;
}

interface TopUpIntentResponse {
  intent: { id: string; amountUsd: string; expiresAt: string };
  payment: { url: string; network: string; rpcUrl?: string };
  evmPayment?: { network: string; asset: string; payTo: string };
  evmPayments?: Array<{ network: string; asset: string; payTo: string }>;
}

interface WalletAccountResponse {
  balance: { availableMicrousd: string };
  keys: Array<{ id: string }>;
}

interface CreatedApiKey {
  id: string;
  key: string;
  displayPrefix: string;
  createdAt: string;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
    solana?: PhantomProvider;
    ethereum?: EthereumProvider;
  }
}

const form = document.querySelector<HTMLFormElement>("[data-checkout-form]");
const amountInput = document.querySelector<HTMLInputElement>("[data-amount]");
const statusBox = document.querySelector<HTMLElement>("[data-checkout-status]");
const walletLabel = document.querySelector<HTMLElement>("[data-wallet-label]");
const payButton = document.querySelector<HTMLButtonElement>("[data-pay-button]");
const connectButtons = document.querySelectorAll<HTMLButtonElement>("[data-connect-wallet]");
const secretDialog = document.querySelector<HTMLDialogElement>("[data-key-dialog]");
const secretValue = document.querySelector<HTMLElement>("[data-key-value]");
const copyKeyButton = document.querySelector<HTMLButtonElement>("[data-copy-key]");
const downloadKeyButton = document.querySelector<HTMLButtonElement>("[data-download-key]");
const closeKeyButton = document.querySelector<HTMLButtonElement>("[data-close-key]");
const copyButtons = document.querySelectorAll<HTMLButtonElement>("[data-copy-target]");

let connectedWallet: ConnectedWallet | undefined;
let revealedKey = "";

function status(message: string, state: "idle" | "busy" | "success" | "error" = "idle"): void {
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.dataset.state = state;
}

function setBusy(busy: boolean): void {
  if (payButton) payButton.disabled = busy || !connectedWallet;
  connectButtons.forEach(button => {
    button.disabled = busy;
  });
  amountInput?.toggleAttribute("readonly", busy);
}

function shortAddress(walletAddress: string): string {
  return walletAddress.length > 16
    ? `${walletAddress.slice(0, 7)}…${walletAddress.slice(-5)}`
    : walletAddress;
}

function requireCanonicalAmount(value: string): string {
  if (!value || value.trim() !== value) {
    throw new Error("Enter a positive USDC amount.");
  }
  const pieces = value.split(".");
  if (pieces.length > 2 || !pieces[0] || pieces[1]?.length > 6) {
    throw new Error("Use a decimal amount with no more than 6 decimal places.");
  }
  const digitsOnly = (part: string, emptyAllowed = false) => {
    if (!part) return emptyAllowed;
    for (const character of part) {
      if (character < "0" || character > "9") return false;
    }
    return true;
  };
  if (!digitsOnly(pieces[0]) || !digitsOnly(pieces[1] ?? "", true)) {
    throw new Error("Use a decimal amount with no more than 6 decimal places.");
  }
  const micros = BigInt(pieces[0]) * 1_000_000n + BigInt((pieces[1] ?? "").padEnd(6, "0") || "0");
  if (micros < 1n || micros > 9_223_372_036_854_775_807n) {
    throw new Error("Enter a supported positive USDC amount.");
  }
  return value;
}

async function jsonRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<T>;
}

function checkoutError(error: unknown, pendingPayment?: PendingEvmPayment): string {
  const providerError = error as { code?: number | string; message?: string };
  const message = error instanceof Error ? error.message : providerError?.message ?? "Checkout failed.";
  const lower = message.toLowerCase();

  if (pendingPayment) {
    const connectionDetail = error instanceof TypeError && lower.includes("failed to fetch")
      ? "The browser could not reach the Corbanu payment service."
      : message;
    return (
      `Your USDC transfer was submitted as ${pendingPayment.transaction}. `
      + `${connectionDetail} Do not pay again. Reconnect this wallet and choose `
      + "“Approve payment & create key” to resume verification."
    );
  }
  if (providerError?.code === 4001 || providerError?.code === "ACTION_REJECTED") {
    return "Wallet request cancelled. No funds were sent.";
  }
  if (lower.includes("deceptive request")) {
    return "MetaMask blocked this request with a security warning. No funds were sent. Reload this page to use the standard USDC checkout.";
  }
  if (lower.includes("insufficient funds") || lower.includes("intrinsic transaction cost")) {
    return "This wallet needs ETH on the selected network to pay the transaction fee. No USDC was sent.";
  }
  if (error instanceof TypeError && lower.includes("failed to fetch")) {
    return "The browser could not reach the Corbanu payment service. No payment was requested; reload and try again.";
  }
  return message;
}

async function responseError(response: Response): Promise<Error> {
  let detail = `Request failed (HTTP ${response.status}).`;
  try {
    const payload = await response.json() as {
      error?: string | { message?: string; detail?: string; reason?: string };
    };
    if (typeof payload.error === "string") detail = payload.error;
    else if (payload.error) {
      detail = payload.error.detail ?? payload.error.message ?? payload.error.reason ?? detail;
    }
  } catch {
    // The status code remains a useful fallback for non-JSON errors.
  }
  return new Error(detail);
}

async function signedOperation<T>(wallet: ConnectedWallet, operation: WalletOperation): Promise<T> {
  const challenge = await jsonRequest<{ challenge: string; message?: string }>("/v1/wallet/challenge", {
    method: "POST",
    body: JSON.stringify({
      walletAddress: wallet.address,
      operation,
      messageFormat: "siwx",
      signingChainId: wallet.signingChainId,
    }),
  });
  if (!challenge.message) {
    throw new Error("The gateway did not return a human-readable wallet challenge.");
  }
  const signature = await wallet.signOwnership(challenge.message);
  return jsonRequest<T>("/v1/wallet/execute", {
    method: "POST",
    body: JSON.stringify({
      walletAddress: wallet.address,
      operation,
      challenge: challenge.challenge,
      signature,
    }),
  });
}

function phantomProvider(): PhantomProvider {
  const provider = window.phantom?.solana ?? window.solana;
  if (!provider?.isPhantom) {
    throw new Error("Phantom was not found. Install Phantom, then reload this page.");
  }
  return provider;
}

async function connectPhantom(): Promise<ConnectedWallet> {
  const provider = phantomProvider();
  const connection = await provider.connect();
  const walletAddress = connection.publicKey.toString();
  const signer = {
    address: address(walletAddress),
    async signTransactions(
      transactions: readonly (Transaction & TransactionWithinSizeLimit & TransactionWithLifetime)[],
    ): Promise<readonly SignatureDictionary[]> {
      const transactionEncoder = getTransactionEncoder();
      return Promise.all(transactions.map(async transaction => {
        const wireTransaction = new Uint8Array(transactionEncoder.encode(transaction));
        const unsigned = VersionedTransaction.deserialize(wireTransaction);
        const signed = await provider.signTransaction(unsigned);
        const signerIndex = signed.message.staticAccountKeys.findIndex(key => key.toBase58() === walletAddress);
        if (signerIndex < 0 || signerIndex >= signed.signatures.length) {
          throw new Error("Phantom did not find this wallet in the payment transaction.");
        }
        return {
          [walletAddress]: signed.signatures[signerIndex] as SignatureBytes,
        } as SignatureDictionary;
      }));
    },
  };
  const client = new x402Client();
  registerExactSvmScheme(client, {
    signer,
    networks: [SOLANA_MAINNET as Network],
  });
  return {
    rail: "solana",
    address: walletAddress,
    signingChainId: "solana:mainnet",
    async signOwnership(message) {
      const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
      return base58.encode(signed.signature);
    },
    paidFetch: wrapFetchWithPayment(fetch, client),
  };
}

async function ensureEvmNetwork(provider: EthereumProvider, rail: EvmRail): Promise<void> {
  const selected = EVM_NETWORKS[rail];
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: selected.chainId }],
    });
  } catch (error) {
    const providerError = error as { code?: number };
    if (providerError.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: selected.chainId,
        chainName: selected.name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [selected.rpcUrl],
        blockExplorerUrls: [selected.explorerUrl],
      }],
    });
  }
}

function isHex(value: string): boolean {
  for (const character of value.toLowerCase()) {
    if (!"0123456789abcdef".includes(character)) return false;
  }
  return true;
}

function assertEvmAddress(value: string, label: string): void {
  if (value.length !== 42 || !value.startsWith("0x") || !isHex(value.slice(2))) {
    throw new Error(`${label} is not a valid EVM address.`);
  }
}

function amountAtomic(amountUsd: string): bigint {
  const [whole, fraction = ""] = amountUsd.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
}

function encodeUsdcTransfer(payTo: string, amount: bigint): string {
  assertEvmAddress(payTo, "Payment receiver");
  const receiverWord = payTo.slice(2).toLowerCase().padStart(64, "0");
  const amountWord = amount.toString(16).padStart(64, "0");
  return `0x${ERC20_TRANSFER_SELECTOR}${receiverWord}${amountWord}`;
}

function assertTransactionHash(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length !== 66 ||
    !value.startsWith("0x") ||
    !isHex(value.slice(2))
  ) {
    throw new Error("MetaMask did not return a valid transaction hash.");
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

async function settleEvmPayment(
  intentId: string,
  transaction: string,
  network: string,
  networkName: string,
): Promise<void> {
  let lastConnectionError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${API_ORIGIN}/v1/topups/settle-evm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId, transaction, network }),
      });
      const responseState = await classifyEvmSettlementResponse(response);
      if (responseState === "settled") return;
      if (responseState === "error") throw await responseError(response);
      lastConnectionError = undefined;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      lastConnectionError = error;
    }
    await wait(1_500);
  }
  const suffix = lastConnectionError
    ? "The payment service could not be reached."
    : `${networkName} confirmations are taking longer than expected.`;
  throw new Error(`${suffix} Verification can be resumed safely.`);
}

async function payWithMetaMask(
  wallet: ConnectedWallet,
  topUp: TopUpIntentResponse,
  amountUsd: string,
): Promise<void> {
  if (wallet.rail !== "base" && wallet.rail !== "ethereum") {
    throw new Error("MetaMask payment requires an EVM network.");
  }
  const provider = wallet.ethereumProvider;
  const selected = EVM_NETWORKS[wallet.rail];
  const offers = topUp.evmPayments
    ?? (topUp.evmPayment ? [topUp.evmPayment] : []);
  const offer = offers.find(candidate => candidate.network === selected.network);
  if (!provider || !offer) {
    throw new Error(`The gateway did not offer ${selected.name} USDC payment.`);
  }
  assertEvmAddress(offer.asset, "Payment asset");
  if (offer.asset.toLowerCase() !== selected.usdc) {
    throw new Error(`The gateway did not offer canonical ${selected.name} USDC.`);
  }
  assertEvmAddress(offer.payTo, "Payment receiver");
  await ensureEvmNetwork(provider, wallet.rail);
  status(
    `Approve a standard ${amountUsd} USDC transfer on ${selected.name}. MetaMask will also show the ETH network fee.`,
    "busy",
  );
  const transaction = await provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: wallet.address,
      to: offer.asset,
      data: encodeUsdcTransfer(offer.payTo, amountAtomic(amountUsd)),
      value: "0x0",
    }],
  });
  assertTransactionHash(transaction);
  const pendingPayment: PendingEvmPayment = {
    walletAddress: wallet.address,
    intentId: topUp.intent.id,
    transaction,
    network: selected.network,
    networkName: selected.name,
  };
  savePendingEvmPayment(window.localStorage, pendingPayment);
  status(`USDC transfer submitted. Waiting for ${selected.name} confirmations…`, "busy");
  await settleEvmPayment(
    pendingPayment.intentId,
    pendingPayment.transaction,
    pendingPayment.network,
    pendingPayment.networkName,
  );
}

async function connectMetaMask(rail: EvmRail): Promise<ConnectedWallet> {
  const provider = window.ethereum;
  if (!provider) throw new Error("MetaMask was not found. Install MetaMask, then reload this page.");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("MetaMask did not return an account.");
  }
  const walletAddress = accounts[0];
  assertEvmAddress(walletAddress, "MetaMask account");
  await ensureEvmNetwork(provider, rail);
  return {
    rail,
    address: walletAddress,
    signingChainId: EVM_NETWORKS[rail].signingChainId,
    ethereumProvider: provider,
    async signOwnership(message) {
      const signature = await provider.request({
        method: "personal_sign",
        params: [`0x${Array.from(new TextEncoder().encode(message), byte => byte.toString(16).padStart(2, "0")).join("")}`, walletAddress],
      });
      if (typeof signature !== "string") throw new Error("MetaMask returned an invalid signature.");
      return signature;
    },
  };
}

async function connect(rail: Rail): Promise<void> {
  setBusy(true);
  const walletName = rail === "solana" ? "Phantom" : "MetaMask";
  const networkName = rail === "solana" ? "Solana" : EVM_NETWORKS[rail].name;
  status(`Connecting ${walletName} on ${networkName}…`, "busy");
  try {
    connectedWallet = rail === "solana" ? await connectPhantom() : await connectMetaMask(rail);
    if (walletLabel) {
      walletLabel.textContent = `${walletName} · ${networkName} · ${shortAddress(connectedWallet.address)}`;
    }
    connectButtons.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.connectWallet === rail));
    });
    const pendingPayment = connectedWallet.rail === "base" || connectedWallet.rail === "ethereum"
      ? pendingEvmPaymentForWallet(window.localStorage, connectedWallet.address)
      : undefined;
    if (pendingPayment) {
      status(
        `Transfer ${pendingPayment.transaction} is awaiting verification. Do not pay again; choose “Approve payment & create key” to resume.`,
        "busy",
      );
    } else {
      status("Wallet connected. Set the exact amount to add to your Corbanu API balance.", "success");
    }
  } catch (error) {
    connectedWallet = undefined;
    status(checkoutError(error), "error");
  } finally {
    setBusy(false);
  }
}

async function waitForFundedAccount(wallet: ConnectedWallet): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const account = await signedOperation<{ balance: { availableMicrousd: string } }>(wallet, { kind: "account" });
    if (BigInt(account.balance.availableMicrousd) > 0n) return;
    await new Promise(resolve => window.setTimeout(resolve, 600 + attempt * 300));
  }
  throw new Error("Payment settled, but the balance is still updating. Reconnect this wallet in Terminal to create the key.");
}

function revealApiKey(created: CreatedApiKey): void {
  revealedKey = created.key;
  if (secretValue) secretValue.textContent = created.key;
  secretDialog?.showModal();
}

async function purchase(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!connectedWallet || !amountInput) {
    status("Connect Phantom or MetaMask first.", "error");
    return;
  }
  const wallet = connectedWallet;
  const isEvmWallet = wallet.rail === "base" || wallet.rail === "ethereum";
  const savedPayment = isEvmWallet
    ? pendingEvmPaymentForWallet(window.localStorage, wallet.address)
    : undefined;
  setBusy(true);
  try {
    if (!savedPayment) {
      status("Checking this wallet for an existing funded account…", "busy");
      const account = await signedOperation<WalletAccountResponse>(wallet, { kind: "account" });
      if (shouldCreateApiKeyWithoutPayment(account.balance.availableMicrousd, account.keys.length)) {
        status("Funded balance found. Creating your API key without another payment…", "busy");
        const created = await signedOperation<CreatedApiKey>(wallet, { kind: "create_key" });
        revealApiKey(created);
        status("API key created. No additional payment was requested.", "success");
        return;
      }
    }
    if (savedPayment) {
      status(
        `Resuming verification for ${savedPayment.transaction} on ${savedPayment.networkName}. Do not pay again…`,
        "busy",
      );
      await settleEvmPayment(
        savedPayment.intentId,
        savedPayment.transaction,
        savedPayment.network,
        savedPayment.networkName,
      );
    } else {
      const amountUsd = requireCanonicalAmount(amountInput.value);
      status("Requesting a wallet-bound top-up intent…", "busy");
      const topUp = await signedOperation<TopUpIntentResponse>(wallet, {
        kind: "top_up_intent",
        amountUsd,
      });
      if (isEvmWallet) {
        await payWithMetaMask(wallet, topUp, amountUsd);
      } else {
        if (topUp.payment.network !== SOLANA_MAINNET || !wallet.paidFetch) {
          throw new Error("The gateway did not offer Solana mainnet x402 payment.");
        }
        status(`Approve the ${amountUsd} USDC payment in Phantom…`, "busy");
        const paid = await wallet.paidFetch(topUp.payment.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!paid.ok) throw await responseError(paid);
        await paid.json().catch(() => undefined);
      }
    }
    status("Payment accepted. Confirming your funded balance…", "busy");
    await waitForFundedAccount(wallet);
    status("Creating a new API key…", "busy");
    const created = await signedOperation<CreatedApiKey>(wallet, { kind: "create_key" });
    if (isEvmWallet) clearPendingEvmPayment(window.localStorage, wallet.address);
    revealApiKey(created);
    status("API key created. Copy it now—the full key is shown only once.", "success");
  } catch (error) {
    const pendingPayment = isEvmWallet
      ? pendingEvmPaymentForWallet(window.localStorage, wallet.address)
      : undefined;
    status(checkoutError(error, pendingPayment), "error");
  } finally {
    setBusy(false);
  }
}

async function copyText(value: string, button?: HTMLButtonElement): Promise<void> {
  await navigator.clipboard.writeText(value);
  if (!button) return;
  const original = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

connectButtons.forEach(button => {
  button.addEventListener("click", () => {
    const rail = button.dataset.connectWallet;
    if (rail === "solana" || rail === "base" || rail === "ethereum") void connect(rail);
  });
});
form?.addEventListener("submit", event => void purchase(event));
copyKeyButton?.addEventListener("click", () => void copyText(revealedKey, copyKeyButton));
downloadKeyButton?.addEventListener("click", () => {
  if (!revealedKey) return;
  const blob = new Blob([`CORBANU_API_KEY=${revealedKey}\n`], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "corbanu-api-key.txt";
  link.click();
  URL.revokeObjectURL(link.href);
});
closeKeyButton?.addEventListener("click", () => {
  revealedKey = "";
  if (secretValue) secretValue.textContent = "";
  secretDialog?.close();
});
secretDialog?.addEventListener("cancel", () => {
  revealedKey = "";
  if (secretValue) secretValue.textContent = "";
});
copyButtons.forEach(button => {
  button.addEventListener("click", () => {
    const target = button.dataset.copyTarget;
    const value = target ? document.querySelector<HTMLElement>(target)?.innerText : "";
    if (value) void copyText(value, button);
  });
});
setBusy(false);
