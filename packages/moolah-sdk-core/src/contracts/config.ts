import type { Address } from "viem";
import type { NetworkName, NetworkContracts } from "./types.js";

/**
 * USDT addresses that require special approve handling (reset to 0 first).
 * Only Ethereum mainnet USDT uses the non-standard approve behavior.
 */
export const USDT_ADDRESSES: Record<string, Address> = {
  ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
};

/**
 * Check if a token requires USDT-style approve (reset to 0 first).
 * Only Ethereum mainnet USDT needs this; BSC USDT does not.
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
    oracleAdaptor: "0x35C673A0A56edB743a8Cf67bCd96d0Eab8aF4BbE",
    moolahVaultFactory: "0x2a0Cb6401FD3c6196750dc6b46702040761D9671",
    moolahPublicLiquidation: "0x882475d622c687b079f149B69a15683FCbeCC6D9",
    lendingBroker: "0x0000000000000000000000000000000000000000",
    brokerRateCalculator: "0xF81A3067ACF683B7f2f40a22bCF17c8310be2330",
    positionManager: "0x8eBFa9e687aF71EC2e87A0380F73b9f57FDf3ec0",
    nativeProvider: "0x367384C54756a25340c63057D87eA22d47Fd5701",
    wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  },
  ethereum: {
    moolah: "0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70",
    moolahVault: "0x0000000000000000000000000000000000000000",
    interestRateModel: "0x8b7d334d243b74D63C4b963893267A0F5240F990",
    fixedRateIrm: "0x9A7cA2CfB886132B6024789163e770979E4222e1",
    // Not deployed on Ethereum. The reference frontend leaves this unset too,
    // so there is no ground truth to copy and we do not invent one.
    oracleAdaptor: "0x0000000000000000000000000000000000000000",
    moolahVaultFactory: "0xa91D9E7343d7EEe8Ed2C8f55e9162827850A7F17",
    moolahPublicLiquidation: "0x796302e041d1715a8b1f16Fd7d7CBA38bb031DE5",
    lendingBroker: "0x0000000000000000000000000000000000000000",
    brokerRateCalculator: "0xeA00cE2992656A0F1DeDf3bBF082A3c725477796",
    positionManager: "0x6d9eD2A68c2759DA53A74D6a85Cd486737257A82",
    nativeProvider: "0xFe34BF713F3C2499026cdFA5af43eb22AA2d1aDb",
    // No WETH concept in the protocol's Ethereum deployment.
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
