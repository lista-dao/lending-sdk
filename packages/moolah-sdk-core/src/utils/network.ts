import type { NetworkName } from "../contracts/types";

/**
 * Get native currency symbol for a network
 */
export function getNativeCurrencySymbol(network: NetworkName): string {
  const symbols: Record<NetworkName, string> = {
    bsc: "BNB",
    ethereum: "ETH",
    // bscTestnet: 'BNB',
    // sepolia: 'ETH',
  };
  return symbols[network] || "BNB";
}
