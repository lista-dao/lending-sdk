import type { Address, PublicClient } from "viem";
import type { VaultUserData, VaultInfo } from "@lista-dao/moolah-sdk-core";
import { Decimal } from "@lista-dao/moolah-sdk-core";
import {
  getERC20Balance,
  getVaultBalance,
  isVaultWhiteList,
} from "@lista-dao/moolah-sdk-core";
import { isContractLevelFailure } from "../../rpcErrors.js";

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
    // A revert (the vault has no allowlist function at all) genuinely means
    // "not gated" — `true`. A timeout or a rate-limited node says nothing
    // about the vault, and reporting it as `true` anyway was the same defect
    // as the Smart-market catch elsewhere in this release: an RPC failure
    // read as a confident, wrong, and here specifically the *permissive*
    // answer — a UI could let a deposit through for an account that was
    // never actually whitelisted.
    isVaultWhiteList(publicClient, vaultAddress, userAddress).catch(
      (error: unknown) => {
        if (!isContractLevelFailure(error)) throw error;
        return true;
      },
    ),
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
