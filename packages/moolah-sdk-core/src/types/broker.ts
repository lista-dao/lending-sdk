import type { Address } from "viem";
import type { Decimal } from "../utils/decimal";

export type { FixedLoanPosition, DynamicLoanPosition } from "./loan";
import type { FixedLoanPosition, DynamicLoanPosition } from "./loan";

/**
 * Fixed term rate option
 */
export interface FixedTermAndRate {
  termId: bigint;
  duration: number; // in days
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
