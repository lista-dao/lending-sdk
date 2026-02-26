import type { Address, PublicClient } from "viem";
import { zeroAddress } from "viem";
import type {
  VaultInfo,
  NetworkName,
  VaultAssetInfo,
} from "@lista-dao/moolah-sdk-core";
import { Decimal, getNativeCurrencySymbol } from "@lista-dao/moolah-sdk-core";
import {
  getERC20Info,
  getVaultTotalAssets,
  getVaultTotalSupply,
  getVaultAsset,
  getVaultProvider,
} from "@lista-dao/moolah-sdk-core";

/**
 * Get vault information
 */
export async function getVaultInfo(
  publicClient: PublicClient,
  contracts: {
    nativeProvider: Address;
  },
  network: NetworkName,
  vaultAddress: Address,
): Promise<VaultInfo> {
  const [_totalAssets, _totalSupply, asset, provider] = await Promise.all([
    getVaultTotalAssets(publicClient, vaultAddress),
    getVaultTotalSupply(publicClient, vaultAddress),
    getVaultAsset(publicClient, vaultAddress),
    getVaultProvider(publicClient, vaultAddress),
  ]);

  const isProvider = provider !== zeroAddress;
  const isNative = isProvider && provider === contracts.nativeProvider;

  let assetInfo: VaultAssetInfo;
  if (isNative) {
    const nativeSymbol = getNativeCurrencySymbol(network);
    assetInfo = { symbol: nativeSymbol, decimals: 18, address: asset };
  } else {
    const tokenInfo = await getERC20Info(publicClient, asset);
    assetInfo = {
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      address: tokenInfo.address,
    };
  }

  return {
    assetInfo,
    totalAssets: new Decimal(_totalAssets, assetInfo.decimals),
    totalSupply: new Decimal(_totalSupply, assetInfo.decimals),
    isNative,
    isProvider,
    provider,
  };
}
