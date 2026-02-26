import type { Address, PublicClient } from "viem";
import type { VaultUserData, VaultInfo } from "@lista-dao/moolah-sdk-core";
import { Decimal } from "@lista-dao/moolah-sdk-core";
import {
  getERC20Balance,
  getVaultBalance,
  isVaultWhiteList,
} from "@lista-dao/moolah-sdk-core";

/**
 * Get user's vault data
 */
export async function getVaultUserData(
  publicClient: PublicClient,
  vaultAddress: Address,
  userAddress: Address,
  vaultInfo: VaultInfo,
): Promise<VaultUserData> {
  const [_shares, isWhiteList] = await Promise.all([
    getVaultBalance(publicClient, vaultAddress, userAddress),
    isVaultWhiteList(publicClient, vaultAddress, userAddress).catch(() => true),
  ]);

  const { assetInfo } = vaultInfo;
  const balance = await (vaultInfo.isNative
    ? publicClient.getBalance({ address: userAddress })
    : getERC20Balance(publicClient, assetInfo.address, userAddress));

  const shares = new Decimal(_shares, assetInfo.decimals);
  const locked = vaultInfo.totalSupply.gt(0n)
    ? vaultInfo.totalAssets
        .mul(shares)
        .div(vaultInfo.totalSupply)
        .roundDown(assetInfo.decimals)
    : Decimal.ZERO;

  return {
    locked,
    shares,
    balance: new Decimal(balance, assetInfo.decimals),
    assetInfo,
    isWhiteList,
  };
}
