import { Decimal } from "../utils/decimal.js";

import type {
  DynamicLoanPosition,
  DynamicLoanRepaymentResult,
  FixedLoanPosition,
  FixedLoanRepaymentResult,
} from "../types/loan.js";

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
 * @param position.rate - Cumulative borrow index in RAY format (27 decimals)
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
  const principal = new Decimal(position.principal, loanDecimals);

  // rate is the cumulative borrow index in RAY format (27 decimals)
  // actualDebt = normalizedDebt × (rate / RATE_SCALE_27)
  const rateIndex = new Decimal(position.rate, 27);
  const currentDebt = normalizedDebt.mul(rateIndex);

  // Interest = currentDebt - original principal. A partial repay can leave
  // normalizedDebt x rateIndex below the recorded principal, and a negative
  // "interest" would turn the buffer below into a discount — under-sizing the
  // repayment instead of over-provisioning it. Floor it at zero.
  const rawInterest = currentDebt.sub(principal);
  const currentInterest = rawInterest.gt(Decimal.ZERO)
    ? rawInterest
    : Decimal.ZERO;

  // Add 10% of interest as buffer (excess is refunded)
  const BUFFER_RATE = new Decimal(1n, 1); // 0.1 = 10%
  const buffer = currentInterest.mul(BUFFER_RATE);
  const totalRepay = currentDebt.add(buffer);
  const interest = totalRepay.sub(principal);

  // Accumulated rate = rateIndex - 1
  const accumulatedRate = rateIndex.sub(Decimal.ONE);

  return {
    totalRepay,
    principal,
    interest,
    rate: accumulatedRate,
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
  loanDecimals = 18,
): FixedLoanRepaymentResult {
  const remainingPrincipal = position.principal - position.principalRepaid;

  const now = currentTime ?? getCurrentRoundedTimestamp();

  // Both stamps are read through `?? 0n` for the same reason the start floor
  // below exists: this is a public export of a package that ships JavaScript,
  // so a position assembled by hand — or read through an older shape that had
  // neither field — arrives with them missing. `bigint` arithmetic against
  // `undefined` throws, and a comparison against it is silently false, which
  // would report a position's whole accrued interest as zero.
  const lastRepaidTime = position.lastRepaidTime ?? 0n;
  const interestRepaid = position.interestRepaid ?? 0n;

  // The contract divides up, every time: `_aprPerSecond` ceils, and so does
  // each `Math.mulDiv` built on it. Flooring here is not the harmless dust it
  // looks like. `totalRepay` is what a caller sends to clear the position, and
  // the broker spends it interest first — so a figure short by even one wei
  // leaves that wei on the principal, and `_validateFixedPosition` requires
  // the remainder to be zero or above `minLoan`. A one-wei shortfall reverts
  // `broker/fixed-below-min-loan`. Measured: a matured 1000-token position at
  // 5% quoted 32 wei short of what the contract charges.
  const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
    numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;

  // Calculate APR minus 1 (stored as 1 + rate), per second, the contract's way
  const rateMinusScale = normalizeAprRate(position.apr);
  const interestPerSecond = ceilDiv(rateMinusScale, BigInt(ONE_YEAR_SECONDS));

  // Interest accrues over the window `BrokerMath.getAccruedInterestForFixedPosition`
  // measures, which is neither `now - start` nor open-ended:
  //
  //  - it starts at `lastRepaidTime`, not `start`. The broker advances that
  //    stamp and zeroes `interestRepaid` whenever principal is repaid, so
  //    measuring from `start` re-charges every window already settled.
  //  - it ends at `min(now, end)`. A matured position stops accruing; without
  //    the cap the figure grows without bound for exactly the positions most
  //    likely to be sitting unsettled.
  //  - what is still owed is the accrual minus `interestRepaid`, which the
  //    broker carries for interest paid without touching principal.
  //
  // Both stamps are clamped to `end` the same way the contract clamps them,
  // and the subtraction is floored at zero: the fields are read at a slightly
  // different moment than the chain applies them, and a negative interest
  // would turn into a discount on the repayment below.
  //
  // `lastRepaidTime` is floored at `start` as well. The broker stamps it with
  // `start` when the position is opened so it is never earlier on-chain; the
  // floor only guards the hand-assembled case, where measuring from the epoch
  // would report an interest figure larger than the loan.
  const floor =
    lastRepaidTime > position.start ? lastRepaidTime : position.start;
  const accrualEnd = now < position.end ? now : position.end;
  const accrualStart = floor < position.end ? floor : position.end;
  const accrualWindow =
    accrualEnd > accrualStart ? accrualEnd - accrualStart : 0n;

  const accruedInterest = ceilDiv(
    remainingPrincipal * (interestPerSecond * accrualWindow),
    RATE_SCALE_27,
  );
  const interestAmount =
    accruedInterest > interestRepaid ? accruedInterest - interestRepaid : 0n;

  // Early-repayment penalty, straight from `getPenaltyForFixedPosition`:
  //
  //     ceil(ceil(repayAmt * aprPerSecond / SCALE) * timeLeft / 2)
  //
  // with `repayAmt` the principal being cleared. This used to invert the
  // contract instead — solving for the amount to send on the assumption the
  // penalty is charged on that amount — which would be right if the contract
  // did not cap `repayAmt` at the remaining principal. It does
  // (`previewRepayFixedLoanPosition`), and any amount large enough to clear
  // the position is above that cap, so the cap always binds and the inversion
  // only ever over-quoted: 1.33x the real penalty at 30% APR on a fresh
  // one-year term — 200 tokens quoted against 150 actually charged, on a
  // 1000-token position.
  let penalty = 0n;
  if (now < position.end) {
    const timeLeft = position.end - now;
    penalty = ceilDiv(
      ceilDiv(remainingPrincipal * interestPerSecond, RATE_SCALE_27) * timeLeft,
      2n,
    );
  }

  const totalRepayBigInt = remainingPrincipal + interestAmount + penalty;
  const totalRepay = new Decimal(totalRepayBigInt, loanDecimals);

  return {
    totalRepay,
    principal: remainingPrincipal,
    interest: interestAmount,
    penalty,
  };
}
