export const PENDING_EVM_PAYMENTS_STORAGE_KEY = "corbanu.pending-evm-payments.v1";

export type EvmSettlementResponseState = "pending" | "settled" | "retry" | "error";
export type CheckoutMode = "new_key" | "existing_key";

export function shouldCreateApiKeyWithoutPayment(
  availableMicrousd: string,
  activeKeyCount: number,
): boolean {
  try {
    return BigInt(availableMicrousd) > 0n && activeKeyCount === 0;
  } catch {
    return false;
  }
}

export interface PendingEvmPayment {
  walletAddress: string;
  intentId: string;
  transaction: string;
  network: "eip155:1" | "eip155:8453";
  networkName: "Ethereum" | "Base";
  /** Missing on records written before existing-key checkout was introduced. */
  checkoutMode?: CheckoutMode;
}

export function pendingPaymentCheckoutMode(payment: PendingEvmPayment): CheckoutMode {
  return payment.checkoutMode ?? "new_key";
}

interface SettlementPayload {
  state?: unknown;
}

function isPendingEvmPayment(value: unknown): value is PendingEvmPayment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingEvmPayment>;
  const validNetwork = candidate.network === "eip155:1" || candidate.network === "eip155:8453";
  const expectedName = candidate.network === "eip155:1" ? "Ethereum" : "Base";
  const validMode = candidate.checkoutMode === undefined
    || candidate.checkoutMode === "new_key"
    || candidate.checkoutMode === "existing_key";
  return (
    typeof candidate.walletAddress === "string"
    && typeof candidate.intentId === "string"
    && typeof candidate.transaction === "string"
    && validNetwork
    && candidate.networkName === expectedName
    && validMode
  );
}

export async function classifyEvmSettlementResponse(
  response: Pick<Response, "status" | "json">,
): Promise<EvmSettlementResponseState> {
  if (response.status === 503) return "retry";
  if (response.status !== 200 && response.status !== 202) return "error";

  let payload: SettlementPayload;
  try {
    payload = await response.json() as SettlementPayload;
  } catch {
    throw new Error(`The gateway returned malformed settlement data (HTTP ${response.status}).`);
  }

  const expectedState = response.status === 200 ? "settled" : "pending";
  if (payload.state !== expectedState) {
    throw new Error(`The gateway returned inconsistent settlement data (HTTP ${response.status}).`);
  }
  return expectedState;
}

function readPendingPayments(storage: Storage): PendingEvmPayment[] {
  try {
    const serialized = storage.getItem(PENDING_EVM_PAYMENTS_STORAGE_KEY);
    if (!serialized) return [];
    const parsed: unknown = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.filter(isPendingEvmPayment) : [];
  } catch {
    return [];
  }
}

export type EvmPaymentNetwork = PendingEvmPayment["network"];

function matchesRecord(
  payment: PendingEvmPayment,
  normalizedWallet: string,
  network?: EvmPaymentNetwork,
): boolean {
  return payment.walletAddress.toLowerCase() === normalizedWallet
    && (network === undefined || payment.network === network);
}

/**
 * Saved transfers are scoped to wallet *and* network. A transfer submitted on
 * Base must never block or hijack a payment the user starts on Ethereum.
 */
export function pendingEvmPaymentForWallet(
  storage: Storage,
  walletAddress: string,
  network?: EvmPaymentNetwork,
): PendingEvmPayment | undefined {
  const normalizedWallet = walletAddress.toLowerCase();
  return readPendingPayments(storage)
    .find(payment => matchesRecord(payment, normalizedWallet, network));
}

/** Saved transfers for this wallet on networks other than the selected one. */
export function otherNetworkPendingEvmPayments(
  storage: Storage,
  walletAddress: string,
  network: EvmPaymentNetwork,
): PendingEvmPayment[] {
  const normalizedWallet = walletAddress.toLowerCase();
  return readPendingPayments(storage)
    .filter(payment => payment.walletAddress.toLowerCase() === normalizedWallet && payment.network !== network);
}

export function savePendingEvmPayment(storage: Storage, payment: PendingEvmPayment): void {
  const normalizedWallet = payment.walletAddress.toLowerCase();
  const retained = readPendingPayments(storage)
    .filter(candidate => !matchesRecord(candidate, normalizedWallet, payment.network));
  try {
    storage.setItem(PENDING_EVM_PAYMENTS_STORAGE_KEY, JSON.stringify([...retained, payment]));
  } catch {
    // Verification still continues in the current page when storage is unavailable.
  }
}

export function clearPendingEvmPayment(
  storage: Storage,
  walletAddress: string,
  network?: EvmPaymentNetwork,
): void {
  const normalizedWallet = walletAddress.toLowerCase();
  const retained = readPendingPayments(storage)
    .filter(payment => !matchesRecord(payment, normalizedWallet, network));
  try {
    if (retained.length === 0) storage.removeItem(PENDING_EVM_PAYMENTS_STORAGE_KEY);
    else storage.setItem(PENDING_EVM_PAYMENTS_STORAGE_KEY, JSON.stringify(retained));
  } catch {
    // A stale public transaction reference is harmless when storage is unavailable.
  }
}

/**
 * The gateway definitively refused this transfer (invalid payment or an intent
 * that no longer exists). Unlike a pending or unreachable settlement, retrying
 * cannot succeed, so the saved record must not keep blocking new payments.
 */
export class EvmSettlementRejectedError extends Error {}

export function isDefinitiveSettlementRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 410;
}
