import type { Address, PublicClient } from "viem";
import { MOOLAH_VAULT_ABI } from "../../contracts/abis/index.js";

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
/**
 * Whether a vault gates deposits to an allowlist, and whether this user is on
 * it. A revert here (the function does not exist on this vault) or a genuine
 * failure is the caller's to interpret — this reads the chain and reports
 * what it found, nothing more.
 *
 * The try/catch this used to have never ran: `readContract` returns a
 * promise, so `return readContract(...)` inside a `try` block returns that
 * promise unresolved — the `catch` here only ever sees a *synchronous*
 * throw, which this call cannot produce. A rejection surfaced at the caller
 * regardless of the catch, silently defeating the "assume true" the comment
 * promised. Removed rather than fixed with an `await`: whether a failure
 * here should read as "not gated" or should propagate is a decision this
 * package has no context to make — see `getVaultUserData` in
 * `moolah-lending-sdk`, which does.
 */
export async function isVaultWhiteList(
  publicClient: PublicClient,
  vaultAddress: Address,
  userAddress: Address,
): Promise<boolean> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: MOOLAH_VAULT_ABI,
    functionName: "isWhiteList",
    args: [userAddress],
  }) as Promise<boolean>;
}
