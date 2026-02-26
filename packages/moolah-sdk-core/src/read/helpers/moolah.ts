import type { Address, PublicClient } from "viem";
import type { MarketParams, MarketState } from "../../types/market";
import { MOOLAH_ABI } from "../../contracts/abis";

/**
 * Get market parameters
 */
export async function getMarketParams(
  publicClient: PublicClient,
  moolahAddress: Address,
  marketId: Address,
): Promise<MarketParams> {
  const result = (await publicClient.readContract({
    address: moolahAddress,
    abi: MOOLAH_ABI,
    functionName: "idToMarketParams",
    args: [marketId],
  })) as readonly [Address, Address, Address, Address, bigint];

  return {
    loanToken: result[0],
    collateralToken: result[1],
    oracle: result[2],
    irm: result[3],
    lltv: result[4],
  };
}

/**
 * Get market state
 */
export async function getMarketState(
  publicClient: PublicClient,
  moolahAddress: Address,
  marketId: Address,
): Promise<MarketState> {
  const result = (await publicClient.readContract({
    address: moolahAddress,
    abi: MOOLAH_ABI,
    functionName: "market",
    args: [marketId],
  })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];

  return {
    totalSupplyAssets: result[0],
    totalSupplyShares: result[1],
    totalBorrowAssets: result[2],
    totalBorrowShares: result[3],
    lastUpdate: result[4],
    fee: result[5],
  };
}

/**
 * Get user position
 */
export async function getUserPosition(
  publicClient: PublicClient,
  moolahAddress: Address,
  marketId: Address,
  userAddress: Address,
): Promise<{
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
}> {
  const result = (await publicClient.readContract({
    address: moolahAddress,
    abi: MOOLAH_ABI,
    functionName: "position",
    args: [marketId, userAddress],
  })) as readonly [bigint, bigint, bigint];

  return {
    supplyShares: result[0],
    borrowShares: result[1],
    collateral: result[2],
  };
}

/**
 * Get price
 */
export async function getPrice(
  publicClient: PublicClient,
  moolahAddress: Address,
  marketParams: MarketParams,
): Promise<bigint> {
  return publicClient.readContract({
    address: moolahAddress,
    abi: MOOLAH_ABI,
    functionName: "getPrice",
    args: [marketParams],
  }) as Promise<bigint>;
}

/**
 * Get min loan
 */
export async function getMinLoan(
  publicClient: PublicClient,
  moolahAddress: Address,
  marketParams: MarketParams,
): Promise<bigint> {
  return publicClient.readContract({
    address: moolahAddress,
    abi: MOOLAH_ABI,
    functionName: "minLoan",
    args: [marketParams],
  }) as Promise<bigint>;
}

/**
 * Get provider address
 */
export async function getProvider(
  publicClient: PublicClient,
  moolahAddress: Address,
  marketId: Address,
  tokenAddress: Address,
): Promise<Address> {
  return publicClient.readContract({
    address: moolahAddress,
    abi: MOOLAH_ABI,
    functionName: "providers",
    args: [marketId, tokenAddress],
  }) as Promise<Address>;
}

/**
 * Check if user is whitelisted
 */
export async function isWhiteList(
  publicClient: PublicClient,
  moolahAddress: Address,
  marketId: Address,
  userAddress: Address,
): Promise<boolean> {
  return publicClient.readContract({
    address: moolahAddress,
    abi: MOOLAH_ABI,
    functionName: "isWhiteList",
    args: [marketId, userAddress],
  }) as Promise<boolean>;
}
