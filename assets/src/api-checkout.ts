import { x402Client } from "@x402/core/client";
import type { Network } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
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
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";

const API_ORIGIN = "https://pfterminal-plan-gateway.fly.dev";
const OWNERSHIP_PREFIX = "pfterminal-plan-ownership-v1";
const BASE_CHAIN_ID = "0x2105";
const BASE_NETWORK = "eip155:8453";
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

type Rail = "solana" | "base";
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
  signOwnership(message: string): Promise<string>;
  paidFetch(url: string, init: RequestInit): Promise<Response>;
}

interface TopUpIntentResponse {
  intent: { id: string; amountUsd: string; expiresAt: string };
  payment: { url: string; network: string; rpcUrl?: string };
  evmPayment?: { network: string; asset: string; payTo: string };
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
  const challenge = await jsonRequest<{ challenge: string }>("/v1/wallet/challenge", {
    method: "POST",
    body: JSON.stringify({ walletAddress: wallet.address, operation }),
  });
  const message = `${OWNERSHIP_PREFIX}\n${API_ORIGIN}\n${challenge.challenge}`;
  const signature = await wallet.signOwnership(message);
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
    async signOwnership(message) {
      const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
      return base58.encode(signed.signature);
    },
    paidFetch: wrapFetchWithPayment(fetch, client),
  };
}

async function ensureBaseNetwork(provider: EthereumProvider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID }],
    });
  } catch (error) {
    const providerError = error as { code?: number };
    if (providerError.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: BASE_CHAIN_ID,
        chainName: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://mainnet.base.org"],
        blockExplorerUrls: ["https://basescan.org"],
      }],
    });
  }
}

async function connectMetaMask(): Promise<ConnectedWallet> {
  const provider = window.ethereum;
  if (!provider) throw new Error("MetaMask was not found. Install MetaMask, then reload this page.");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("MetaMask did not return an account.");
  }
  const walletAddress = accounts[0] as `0x${string}`;
  await ensureBaseNetwork(provider);
  const walletClient = createWalletClient({
    account: walletAddress,
    chain: base,
    transport: custom(provider),
  });
  const signer = {
    address: walletAddress,
    signTypedData: async (payload: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => walletClient.signTypedData({
      account: walletAddress,
      domain: payload.domain,
      types: payload.types,
      primaryType: payload.primaryType,
      message: payload.message,
    } as Parameters<typeof walletClient.signTypedData>[0]),
  };
  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer,
    networks: [BASE_NETWORK as Network],
    schemeOptions: { rpcUrl: "https://mainnet.base.org" },
  });
  return {
    rail: "base",
    address: walletAddress,
    async signOwnership(message) {
      const signature = await provider.request({
        method: "personal_sign",
        params: [`0x${Array.from(new TextEncoder().encode(message), byte => byte.toString(16).padStart(2, "0")).join("")}`, walletAddress],
      });
      if (typeof signature !== "string") throw new Error("MetaMask returned an invalid signature.");
      return signature;
    },
    paidFetch: wrapFetchWithPayment(fetch, client),
  };
}

async function connect(rail: Rail): Promise<void> {
  setBusy(true);
  status(`Connecting ${rail === "solana" ? "Phantom" : "MetaMask"}…`, "busy");
  try {
    connectedWallet = rail === "solana" ? await connectPhantom() : await connectMetaMask();
    if (walletLabel) {
      walletLabel.textContent = `${rail === "solana" ? "Phantom · Solana" : "MetaMask · Base"} · ${shortAddress(connectedWallet.address)}`;
    }
    connectButtons.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.connectWallet === rail));
    });
    status("Wallet connected. Set the exact amount to add to your Corbanu API balance.", "success");
  } catch (error) {
    connectedWallet = undefined;
    status(error instanceof Error ? error.message : "Wallet connection failed.", "error");
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
  setBusy(true);
  try {
    const amountUsd = requireCanonicalAmount(amountInput.value);
    status("Requesting a wallet-bound top-up intent…", "busy");
    const topUp = await signedOperation<TopUpIntentResponse>(wallet, {
      kind: "top_up_intent",
      amountUsd,
    });
    const requiredNetwork = wallet.rail === "solana" ? topUp.payment.network : topUp.evmPayment?.network;
    const expectedNetwork = wallet.rail === "solana" ? SOLANA_MAINNET : BASE_NETWORK;
    if (requiredNetwork !== expectedNetwork) {
      throw new Error("The gateway did not offer the selected payment network.");
    }
    if (wallet.rail === "base") await ensureBaseNetwork(window.ethereum!);
    status(`Approve the ${amountUsd} USDC payment in your wallet…`, "busy");
    const paid = await wallet.paidFetch(topUp.payment.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!paid.ok) throw await responseError(paid);
    await paid.json().catch(() => undefined);
    status("Payment accepted. Confirming your funded balance…", "busy");
    await waitForFundedAccount(wallet);
    status("Creating a new API key…", "busy");
    const created = await signedOperation<CreatedApiKey>(wallet, { kind: "create_key" });
    revealApiKey(created);
    status("API key created. Copy it now—the full key is shown only once.", "success");
  } catch (error) {
    status(error instanceof Error ? error.message : "Checkout failed.", "error");
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
    if (rail === "solana" || rail === "base") void connect(rail);
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
