import { Decimal } from "../utils/decimal";
import { MathLib } from "@morpho-org/blue-sdk";

import type {
  DynamicLoanPosition,
  DynamicLoanRepaymentResult,
  FixedLoanPosition,
  FixedLoanRepaymentResult,
} from "../types/loan";

/**
 * Constants for loan calculations
 */
const ONE_YEAR_SECONDS = 365 * 24 * 3600;
const TEN_MINUTES_SECONDS = 600;
const RATE_SCALE_27 = 10n ** 27n;

/**
 * Normalize APR rate from 27 decimals to a decimal representation
 * APR is stored as (1 + rate) in 27 decimals, where 1e27 = 100%
 * @param apr - APR in 27 decimals (e.g., 1.05e27 = 5% APR)
 * @returns The rate minus 1 (e.g., 0.05e27 for 5% APR)
 */
export function normalizeAprRate(apr: bigint): bigint {
  return apr > RATE_SCALE_27 ? apr - RATE_SCALE_27 : 0n;
}

/**
 * Get current timestamp rounded to 10-minute blocks with buffer
 * This is used for consistent time calculations across the application
 * @param bufferMinutes - Additional buffer in minutes (default: 10)
 * @returns Current timestamp rounded down to nearest 10-minute block plus buffer
 */
export function getCurrentRoundedTimestamp(bufferMinutes = 10): bigint {
  const currentSeconds = BigInt(Math.round(Date.now() / 1000));
  const roundedDown =
    (currentSeconds / BigInt(TEN_MINUTES_SECONDS)) *
    BigInt(TEN_MINUTES_SECONDS);
  const bufferSeconds = BigInt(bufferMinutes * 60);
  return roundedDown + bufferSeconds;
}

/**
 * Calculate the total repayment amount for a dynamic loan position
 * @param position - The dynamic loan position data
 * @param position.principal - Principal amount borrowed
 * @param position.normalizedDebt - Normalized debt amount (optional, defaults to principal)
 * @param position.rate - Current interest rate per second
 * @param loanDecimals - The decimals of the loan token (default: 18)
 * @returns Object containing total repay amount and breakdown of principal and interest
 */
export function calculateDynamicLoanRepayment(
  position: DynamicLoanPosition,
  loanDecimals = 18,
): DynamicLoanRepaymentResult {
  const normalizedDebt = new Decimal(
    position.normalizedDebt ?? position.principal,
    loanDecimals,
  );

  // position.rate is already a per-second rate in 18 decimals
  const rawRate = MathLib.wTaylorCompounded(position.rate, ONE_YEAR_SECONDS);
  const rateDecimal = new Decimal(rawRate, 18);

  // Total outstanding = normalized debt × (1 + rate)
  const currentTotalRepay = normalizedDebt.mul(rateDecimal.add(Decimal.ONE));

  const principal = normalizedDebt;
  const tenMinutesRawRate = MathLib.wTaylorCompounded(
    position.rate,
    TEN_MINUTES_SECONDS,
  );
  const tenMinutesRateDecimal = new Decimal(tenMinutesRawRate, 18);

  const tenMinutesInterest = principal.mul(tenMinutesRateDecimal.toString(18));

  // add additional 10 minutes interest to the current total repay
  const totalRepay = currentTotalRepay.add(tenMinutesInterest);

  const interest = totalRepay.sub(normalizedDebt);

  return {
    totalRepay,
    principal: normalizedDebt,
    interest,
    rate: rateDecimal,
  };
}

/**
 * Calculate the total repayment amount for a fixed loan position including interest and penalty
 * @param position - The fixed loan position data
 * @param position.principal - Total principal amount borrowed
 * @param position.principalRepaid - Amount already repaid (must be <= principal)
 * @param position.apr - Annual Percentage Rate in 27 decimals (1e27 = 100%)
 * @param position.start - Loan start timestamp in seconds
 * @param position.end - Loan maturity timestamp in seconds
 * @param currentTime - Current timestamp in seconds (optional, defaults to current 10-minute block + 10 minutes buffer)
 * @returns Object containing total repay amount and breakdown of principal, interest, and penalty
 */
export function calculateFixedLoanRepayment(
  position: FixedLoanPosition,
  currentTime?: bigint,
): FixedLoanRepaymentResult {
  const remainingPrincipal = position.principal - position.principalRepaid;

  const now = currentTime ?? getCurrentRoundedTimestamp();

  const duration = now - position.start;
  const termDuration = position.end - position.start;

  // Calculate APR minus 1 (stored as 1 + rate)
  const rateMinusScale = normalizeAprRate(position.apr);
  const interestPerSecond = rateMinusScale / BigInt(ONE_YEAR_SECONDS);

  // Calculate interest accrued
  const interestAmount =
    (interestPerSecond * remainingPrincipal * duration) / RATE_SCALE_27;

  // Calculate early repayment penalty if before maturity
  let penalty = 0n;
  if (duration < termDuration) {
    const remainingDuration = termDuration - duration;
    const denominator =
      (2n * RATE_SCALE_27) / remainingDuration / interestPerSecond - 1n;
    if (denominator > 0n) {
      penalty = remainingPrincipal / denominator;
    }
  }

  const totalRepayBigInt = remainingPrincipal + interestAmount + penalty;
  const totalRepay = new Decimal(totalRepayBigInt, 18);

  return {
    totalRepay,
    principal: remainingPrincipal,
    interest: interestAmount,
    penalty,
  };
}
