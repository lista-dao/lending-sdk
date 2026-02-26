import type { Address, PublicClient } from "viem";
import { MOOLAH_VAULT_ABI } from "../../contracts/abis";

/**
 * Get vault total assets
 */
export async function getVaultTotalAssets(
  publicClient: PublicClient,
  vaultAddress: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: MOOLAH_VAULT_ABI,
    functionName: "totalAssets",
  }) as Promise<bigint>;
}

/**
 * Get vault total supply
 */
export async function getVaultTotalSupply(
  publicClient: PublicClient,
  vaultAddress: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: MOOLAH_VAULT_ABI,
    functionName: "totalSupply",
  }) as Promise<bigint>;
}

/**
 * Get vault asset address
 */
export async function getVaultAsset(
  publicClient: PublicClient,
  vaultAddress: Address,
): Promise<Address> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: MOOLAH_VAULT_ABI,
    functionName: "asset",
  }) as Promise<Address>;
}

/**
 * Get vault provider address
 */
export async function getVaultProvider(
  publicClient: PublicClient,
  vaultAddress: Address,
): Promise<Address> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: MOOLAH_VAULT_ABI,
    functionName: "provider",
  }) as Promise<Address>;
}

/**
 * Get user's vault balance (shares)
 */
export async function getVaultBalance(
  publicClient: PublicClient,
  vaultAddress: Address,
  userAddress: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: MOOLAH_VAULT_ABI,
    functionName: "balanceOf",
    args: [userAddress],
  }) as Promise<bigint>;
}

/**
 * Check if user is whitelisted in vault
 */
export async function isVaultWhiteList(
  publicClient: PublicClient,
  vaultAddress: Address,
  userAddress: Address,
): Promise<boolean> {
  try {
    return publicClient.readContract({
      address: vaultAddress,
      abi: MOOLAH_VAULT_ABI,
      functionName: "isWhiteList",
      args: [userAddress],
    }) as Promise<boolean>;
  } catch {
    // If isWhiteList doesn't exist or fails, assume true
    return true;
  }
}
