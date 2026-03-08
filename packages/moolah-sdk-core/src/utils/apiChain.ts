import type { NetworkName } from "../contracts/types.js";

export type ApiChain = "bsc" | "ethereum"; // | 'bscTest'

/** API environment - test requires VPN (Lista internal only), prod is public */
export type ApiEnv = "test" | "prod";

/**
 * Built-in Lista API URLs
 * - prod: Public, for third-party and Lista production
 * - test: Requires VPN, for Lista development only
 */
export const LISTA_API_URLS: Record<ApiEnv, string> = {
  prod: "https://api.lista.org",
  test: "https://api.ltqa.io",
};

export function getListaApiUrl(env: ApiEnv): string {
  return LISTA_API_URLS[env];
}

const NETWORK_TO_API_CHAIN: Record<NetworkName, ApiChain> = {
  bsc: "bsc",
  ethereum: "ethereum",
  // bscTestnet: 'bscTest',
  // sepolia: 'ethereum',
};

export function getApiChain(network: NetworkName): ApiChain {
  return NETWORK_TO_API_CHAIN[network];
}
