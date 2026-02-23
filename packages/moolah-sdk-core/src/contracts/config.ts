import type { Address } from "viem";
import type { NetworkName, NetworkContracts } from "./types";

/**
 * USDT addresses that require special approve handling (reset to 0 first)
 */
export const USDT_ADDRESSES: Record<string, Address> = {
  ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  bsc: "0x55d398326f99059fF775485246999027B3197955",
};

/**
 * Check if a token requires USDT-style approve (reset to 0 first)
 * @param network - Network name
 * @param tokenAddress - Token address to check
 * @returns true if token requires reset-then-approve pattern
 */
export function isUsdtLikeToken(
  network: NetworkName,
  tokenAddress: Address,
): boolean {
  const usdtAddr = USDT_ADDRESSES[network];
  if (!usdtAddr) return false;
  return tokenAddress.toLowerCase() === usdtAddr.toLowerCase();
}

/**
 * Contract addresses for each network
 */
export const CONTRACT_ADDRESSES: Record<NetworkName, NetworkContracts> = {
  bsc: {
    moolah: "0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C",
    moolahVault: "0x0000000000000000000000000000000000000000",
    interestRateModel: "0xFe7dAe87Ebb11a7BEB9F534BB23267992d9cDe7c",
    fixedRateIrm: "0x5F9f9173B405C6CEAfa7f98d09e4B8447e9797E6",
    oracleAdaptor: "0x35c673a0a56edb743a8cf67bcd96d0eab8af4bbe",
    moolahVaultFactory: "0x2a0Cb6401FD3c6196750dc6b46702040761D9671",
    moolahPublicLiquidation: "0x882475d622c687b079f149B69a15683FCbeCC6D9",
    lendingBroker: "0x0000000000000000000000000000000000000000",
    brokerRateCalculator: "0xF81A3067ACF683B7f2f40a22bCF17c8310be2330",
    nativeProvider: "0x367384C54756a25340c63057D87eA22d47Fd5701",
    wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  },
  ethereum: {
    moolah: "0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70",
    moolahVault: "0x0000000000000000000000000000000000000000",
    interestRateModel: "0x8b7d334d243b74D63C4b963893267A0F5240F990",
    fixedRateIrm: "0x9A7cA2CfB886132B6024789163e770979E4222e1",
    oracleAdaptor: "0x0000000000000000000000000000000000000000",
    moolahVaultFactory: "0x0000000000000000000000000000000000000000",
    moolahPublicLiquidation: "0x0000000000000000000000000000000000000000",
    lendingBroker: "0x0000000000000000000000000000000000000000",
    brokerRateCalculator: "0x0000000000000000000000000000000000000000",
    nativeProvider: "0xFe34BF713F3C2499026cdFA5af43eb22AA2d1aDb",
    wbnb: "0x0000000000000000000000000000000000000000",
  },
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export function getContractAddress(
  network: NetworkName,
  contract: keyof NetworkContracts,
): Address {
  const address = CONTRACT_ADDRESSES[network]?.[contract];
  if (!address || address === ZERO_ADDRESS) {
    throw new Error(
      `Contract ${contract} not found or not configured for network ${network}`,
    );
  }
  return address as Address;
}

export function getContractAddressOptional(
  network: NetworkName,
  contract: keyof NetworkContracts,
): Address {
  const address = CONTRACT_ADDRESSES[network]?.[contract];
  return (address ?? ZERO_ADDRESS) as Address;
}
