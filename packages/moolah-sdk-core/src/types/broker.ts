import type { Address } from "viem";
import type { Decimal } from "../utils/decimal.js";

export type { FixedLoanPosition, DynamicLoanPosition } from "./loan.js";
import type { FixedLoanPosition, DynamicLoanPosition } from "./loan.js";

/**
 * Fixed term rate option
 */
export interface FixedTermAndRate {
  termId: bigint;
  /**
   * Term length in seconds, as the contract stores it.
   *
   * This used to be whole days, computed by integer-dividing the contract's
   * seconds by 86400 — which reported every sub-day term as 0 and truncated a
   * 36-hour term to 1 day. Seconds are what the contract has and what
   * `convertDynamicToFixed` reasons about.
   */
  durationSeconds: bigint;
  /** Convenience view of {@link durationSeconds}, fractional for short terms. */
  durationDays: number;
  apr: Decimal;
}

/**
 * Raw fixed term from contract
 */
export interface RawFixedTerm {
  termId: bigint;
  duration: bigint;
  apr: bigint;
}

/**
 * Broker user positions data
 */
export interface BrokerUserPositionsData {
  fixedPositions: readonly FixedLoanPosition[];
  dynamicPosition: DynamicLoanPosition;
  dynamicRate: bigint;
  terms: readonly RawFixedTerm[];
  // Computed values
  dynamicRatePercent: Decimal | null;
  dynamicOutstanding: Decimal | null;
  fixedOutstanding: Decimal;
  totalPenalty: Decimal;
  totalOutstanding: Decimal;
  weightedBorrowRate: Decimal;
  termRateByDuration: Map<string, Decimal>;
}

/**
 * Broker info
 */
export interface BrokerInfo {
  address: Address;
  marketId: Address;
  loanToken: Address;
  collateralToken: Address;
  rateCalculator: Address;
  fixedTerms: FixedTermAndRate[];
}
