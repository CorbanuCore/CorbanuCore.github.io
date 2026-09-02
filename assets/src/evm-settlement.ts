export const PENDING_EVM_PAYMENTS_STORAGE_KEY = "corbanu.pending-evm-payments.v1";

export type EvmSettlementResponseState = "pending" | "settled" | "retry" | "error";

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
}

interface SettlementPayload {
  state?: unknown;
}

function isPendingEvmPayment(value: unknown): value is PendingEvmPayment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingEvmPayment>;
  const validNetwork = candidate.network === "eip155:1" || candidate.network === "eip155:8453";
  const expectedName = candidate.network === "eip155:1" ? "Ethereum" : "Base";
  return (
    typeof candidate.walletAddress === "string"
    && typeof candidate.intentId === "string"
    && typeof candidate.transaction === "string"
    && validNetwork
    && candidate.networkName === expectedName
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

export function pendingEvmPaymentForWallet(
  storage: Storage,
  walletAddress: string,
): PendingEvmPayment | undefined {
  const normalizedWallet = walletAddress.toLowerCase();
  return readPendingPayments(storage)
    .find(payment => payment.walletAddress.toLowerCase() === normalizedWallet);
}

export function savePendingEvmPayment(storage: Storage, payment: PendingEvmPayment): void {
  const normalizedWallet = payment.walletAddress.toLowerCase();
  const retained = readPendingPayments(storage)
    .filter(candidate => candidate.walletAddress.toLowerCase() !== normalizedWallet);
  try {
    storage.setItem(PENDING_EVM_PAYMENTS_STORAGE_KEY, JSON.stringify([...retained, payment]));
  } catch {
    // Verification still continues in the current page when storage is unavailable.
  }
}

export function clearPendingEvmPayment(storage: Storage, walletAddress: string): void {
  const normalizedWallet = walletAddress.toLowerCase();
  const retained = readPendingPayments(storage)
    .filter(payment => payment.walletAddress.toLowerCase() !== normalizedWallet);
  try {
    if (retained.length === 0) storage.removeItem(PENDING_EVM_PAYMENTS_STORAGE_KEY);
    else storage.setItem(PENDING_EVM_PAYMENTS_STORAGE_KEY, JSON.stringify(retained));
  } catch {
    // A stale public transaction reference is harmless when storage is unavailable.
  }
}
