import type { Address, PublicClient } from "viem";
import type { MarketParams, MarketState } from "../../types/market";
import { INTEREST_RATE_MODEL_ABI } from "../../contracts/abis";

/**
 * Get borrow rate view
 */
export async function getBorrowRateView(
  publicClient: PublicClient,
  irmAddress: Address,
  marketParams: MarketParams,
  marketState: MarketState,
): Promise<bigint> {
  return publicClient.readContract({
    address: irmAddress,
    abi: INTEREST_RATE_MODEL_ABI,
    functionName: "borrowRateView",
    args: [marketParams, marketState],
  }) as Promise<bigint>;
}

/**
 * Get rate cap
 */
export async function getRateCap(
  publicClient: PublicClient,
  irmAddress: Address,
  marketId: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: irmAddress,
    abi: INTEREST_RATE_MODEL_ABI,
    functionName: "rateCap",
    args: [marketId],
  }) as Promise<bigint>;
}

/**
 * Get rate floor
 */
export async function getRateFloor(
  publicClient: PublicClient,
  irmAddress: Address,
  marketId: Address,
): Promise<bigint | null> {
  try {
    return (await publicClient.readContract({
      address: irmAddress,
      abi: INTEREST_RATE_MODEL_ABI,
      functionName: "rateFloor",
      args: [marketId],
    })) as bigint;
  } catch {
    return null;
  }
}

/**
 * Get rate at target
 */
export async function getRateAtTarget(
  publicClient: PublicClient,
  irmAddress: Address,
  marketId: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: irmAddress,
    abi: INTEREST_RATE_MODEL_ABI,
    functionName: "rateAtTarget",
    args: [marketId],
  }) as Promise<bigint>;
}
