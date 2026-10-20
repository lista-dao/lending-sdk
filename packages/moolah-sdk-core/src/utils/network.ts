import type { NetworkName } from "../contracts/types.js";

/**
 * Get native currency symbol for a network
 */
export function getNativeCurrencySymbol(network: NetworkName): string {
  const symbols: Record<NetworkName, string> = {
    bsc: "BNB",
    ethereum: "ETH",
  };
  return symbols[network] || "BNB";
}
