import type { NetworkName } from "../contracts/types.js";

export type ApiChain = "bsc" | "ethereum";

/**
 * Built-in Lista production API URL.
 */
export const LISTA_API_URL = "https://api.lista.org";

/** Default API host. */
export function getApiUrlForNetwork(network: NetworkName): string {
  void network;
  return LISTA_API_URL;
}

const NETWORK_TO_API_CHAIN: Record<NetworkName, ApiChain> = {
  bsc: "bsc",
  ethereum: "ethereum",
};

export function getApiChain(network: NetworkName): ApiChain {
  return NETWORK_TO_API_CHAIN[network];
}
