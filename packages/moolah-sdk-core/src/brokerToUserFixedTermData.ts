import { Decimal } from "./utils/decimal.js";
import type { BrokerUserPositionsData } from "./types/broker.js";
import type { UserFixedTermData } from "./types/market.js";

/**
 * Convert broker user positions to UserFixedTermData for use with getMarketUserData.
 * Use this when the market is fixed-term and you have broker positions from getBrokerUserPositions.
 * Pass the result as the 4th argument to getMarketUserData so borrowed/borrowRate come from broker.
 */
export function brokerPositionsToUserFixedTermData(
  data: BrokerUserPositionsData,
): UserFixedTermData {
  return {
    dynamicOutstanding: data.dynamicOutstanding ?? Decimal.ZERO,
    fixedOutstanding: data.fixedOutstanding,
    totalBorrowed: data.totalOutstanding,
    weightedBorrowRate: data.weightedBorrowRate,
  };
}
