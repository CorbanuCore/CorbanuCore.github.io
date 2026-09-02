export type WalletKind = "phantom" | "metamask";
export type PaymentRail = "solana" | "base" | "ethereum";
export type EvmRail = Exclude<PaymentRail, "solana">;

export interface WalletSelection {
  wallet: WalletKind;
  rail: PaymentRail;
}

interface EvmProviderIdentity<T> {
  isMetaMask?: boolean;
  isPhantom?: boolean;
  providers?: T[];
}

export function selectPhantomEvmProvider<T extends EvmProviderIdentity<T>>(
  provider: T | undefined,
): T | undefined {
  return provider?.isPhantom ? provider : undefined;
}

export function selectMetaMaskEvmProvider<T extends EvmProviderIdentity<T>>(
  injected: T | undefined,
): T | undefined {
  return injected?.providers?.find(candidate => candidate.isMetaMask && !candidate.isPhantom)
    ?? (injected?.isMetaMask && !injected.isPhantom ? injected : undefined);
}

export function parseWalletSelection(
  wallet: string | undefined,
  rail: string | undefined,
): WalletSelection | undefined {
  if (wallet === "phantom" && (rail === "solana" || rail === "base" || rail === "ethereum")) {
    return { wallet, rail };
  }
  if (wallet === "metamask" && (rail === "base" || rail === "ethereum")) {
    return { wallet, rail };
  }
  return undefined;
}

export function isEvmRail(rail: PaymentRail): rail is EvmRail {
  return rail === "base" || rail === "ethereum";
}
