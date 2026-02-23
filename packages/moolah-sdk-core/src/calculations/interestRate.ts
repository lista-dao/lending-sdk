/**
 * Interest Rate Calculations
 *
 * Pure functions for calculating borrow rates, APY, and interest rate curves.
 * Interest rate logic aligned with protocol.
 * For internal: Extracted from lista-mono interestRateUtils.ts for SDK reuse.
 */

import { AdaptiveCurveIrmLib, MathLib } from "@morpho-org/blue-sdk";

/**
 * Constants
 */
const ONE_YEAR_SECONDS = 365 * 24 * 3600;
const SIX_HOURS_SECONDS = 6 * 60 * 60;
const WEI_VALUE = 10n ** 18n;

/**
 * Calculate raw borrow rate based on utilization and rate model parameters.
 *
 * @param utilization - Current utilization rate (18 decimals, 1e18 = 100%)
 * @param rateAtTarget - Rate at target utilization from IRM contract
 * @param lastUpdate - Last update timestamp (seconds)
 * @returns Average borrow rate per second (18 decimals)
 *
 * @example
 * ```typescript
 * const rate = getRawBorrowRate(
 *   500000000000000000n, // 50% utilization
 *   796668712n,          // rateAtTarget from contract
 *   1704067200n          // lastUpdate timestamp
 * );
 * ```
 */
export function getRawBorrowRate(
  utilization: bigint,
  rateAtTarget: bigint,
  lastUpdate: number | bigint,
): bigint {
  const elapsed =
    BigInt(Math.round(Date.now().valueOf() / 1000)) - BigInt(lastUpdate);
  const { avgBorrowRate } = AdaptiveCurveIrmLib.getBorrowRate(
    utilization,
    rateAtTarget,
    elapsed,
  );
  return avgBorrowRate;
}

/**
 * Get comprehensive borrow rate information including latest rate and updated rateAtTarget.
 *
 * @param params - Rate calculation parameters
 * @param params.utilization - Current utilization rate (18 decimals)
 * @param params.rateAtTarget - Rate at target utilization from IRM contract
 * @param params.lastUpdate - Last update timestamp (seconds)
 * @param params.rateCap - Optional rate cap (max rate per second)
 * @param params.rateFloor - Optional rate floor (min rate per second)
 * @returns Object with latestBorrowRate (annualized, 18 decimals) and updated rateAtTarget
 *
 * @example
 * ```typescript
 * const { latestBorrowRate, rateAtTarget } = getBorrowRateInfo({
 *   utilization: 500000000000000000n,
 *   rateAtTarget: 796668712n,
 *   lastUpdate: 1704067200n,
 *   rateCap: 9512937595n,
 * });
 * // latestBorrowRate: ~5% APY in 18 decimals
 * ```
 */
export function getBorrowRateInfo(params: {
  utilization: bigint;
  rateAtTarget: bigint;
  lastUpdate: number | bigint;
  rateCap?: bigint | null;
  rateFloor?: bigint | null;
}): {
  latestBorrowRate: bigint;
  rateAtTarget: bigint;
} {
  const { utilization, rateAtTarget, lastUpdate, rateCap, rateFloor } = params;

  const avgSecondRate = AdaptiveCurveIrmLib.getBorrowRate(
    utilization,
    rateAtTarget,
    BigInt(Math.round(new Date().valueOf() / 1000)) - BigInt(lastUpdate),
  );

  const latestSecondRate = AdaptiveCurveIrmLib.getBorrowRate(
    utilization,
    avgSecondRate.endRateAtTarget,
    0,
  );

  let effectiveRate = latestSecondRate.avgBorrowRate;
  if (rateCap != null && effectiveRate > rateCap) {
    effectiveRate = rateCap;
  } else if (rateFloor != null && effectiveRate < rateFloor) {
    effectiveRate = rateFloor;
  }

  const latestBorrowRate = getAnnualBorrowRate(effectiveRate);

  return {
    latestBorrowRate,
    rateAtTarget: avgSecondRate.endRateAtTarget,
  };
}

/**
 * Convert per-second rate to annualized rate.
 *
 * Uses Taylor series approximation for compound interest over 6 hours,
 * then scales to annual rate.
 *
 * @param rateBySecond - Rate per second (18 decimals)
 * @param seconds - Compounding period in seconds (default: 6 hours)
 * @returns Annualized rate (18 decimals, 1e18 = 100%)
 *
 * @example
 * ```typescript
 * const annualRate = getAnnualBorrowRate(158548959n);
 * // Returns ~5% APY (5e16 in 18 decimals)
 * ```
 */
export function getAnnualBorrowRate(
  rateBySecond: bigint,
  seconds = SIX_HOURS_SECONDS,
): bigint {
  return (
    (MathLib.wTaylorCompounded(rateBySecond, seconds) *
      BigInt(ONE_YEAR_SECONDS)) /
    BigInt(SIX_HOURS_SECONDS)
  );
}

/**
 * Calculate APY from per-second rate using compound interest.
 *
 * @param rateBySecond - Rate per second (18 decimals)
 * @returns APY (18 decimals, 1e18 = 100%)
 */
export function getApy(rateBySecond: bigint): bigint {
  return MathLib.wTaylorCompounded(rateBySecond, ONE_YEAR_SECONDS);
}

/**
 * Calculate borrow rate for a given utilization rate.
 * Applies rate cap and floor constraints.
 *
 * @param params - Calculation parameters
 * @param params.utilRate - Target utilization rate (18 decimals)
 * @param params.rateAtTarget - Rate at target from IRM
 * @param params.lastUpdate - Last update timestamp
 * @param params.rateCap - Optional maximum rate
 * @param params.rateFloor - Optional minimum rate
 * @param params.isFixedRate - Whether this is a fixed rate market
 * @param params.fixedRateView - Fixed rate value if isFixedRate is true
 * @returns Annualized borrow rate (18 decimals)
 */
export function computeBorrowRate(params: {
  utilRate: bigint;
  rateAtTarget: bigint;
  lastUpdate: bigint;
  rateCap?: bigint | null;
  rateFloor?: bigint | null;
  isFixedRate?: boolean;
  fixedRateView?: bigint;
}): bigint {
  const {
    utilRate,
    rateAtTarget,
    lastUpdate,
    rateCap,
    rateFloor,
    isFixedRate,
    fixedRateView,
  } = params;

  if (isFixedRate && fixedRateView != null) {
    return getAnnualBorrowRate(fixedRateView);
  }

  let rateBySecond = getRawBorrowRate(utilRate, rateAtTarget, lastUpdate);

  if (rateCap != null && rateBySecond > rateCap) {
    rateBySecond = rateCap;
  } else if (rateFloor != null && rateBySecond < rateFloor) {
    rateBySecond = rateFloor;
  }

  return getAnnualBorrowRate(rateBySecond);
}

/**
 * Interest rate curve point
 */
export interface InterestRatePoint {
  /** Borrow rate as decimal (0.05 = 5%) */
  borrowRate: number;
  /** Supply rate as decimal (0.03 = 3%) */
  supplyRate: number;
  /** Utilization as decimal (0.5 = 50%) */
  utilization: number;
}

/**
 * Generate interest rate curve data points for charting.
 *
 * @param params - Curve generation parameters
 * @param params.rateAtTarget - Rate at target from IRM
 * @param params.lastUpdate - Last update timestamp
 * @param params.fee - Protocol fee (18 decimals)
 * @param params.rateCap - Optional rate cap
 * @param params.rateFloor - Optional rate floor
 * @param params.points - Number of data points (default: 101 for 0-100%)
 * @returns Array of rate points for different utilization levels
 */
export function getInterestRates(params: {
  rateAtTarget: bigint;
  lastUpdate: number | bigint;
  fee: bigint;
  rateCap?: bigint | null;
  rateFloor?: bigint | null;
  points?: number;
}): InterestRatePoint[] {
  const {
    rateAtTarget,
    lastUpdate,
    fee,
    rateCap,
    rateFloor,
    points = 101,
  } = params;

  const rates: InterestRatePoint[] = [];
  const step = WEI_VALUE / BigInt(points - 1);

  for (let i = 0n; i <= WEI_VALUE; i += step) {
    let borrowRatePerSecond = getRawBorrowRate(i, rateAtTarget, lastUpdate);

    if (rateCap != null && borrowRatePerSecond > rateCap) {
      borrowRatePerSecond = rateCap;
    } else if (rateFloor != null && borrowRatePerSecond < rateFloor) {
      borrowRatePerSecond = rateFloor;
    }

    const supplyRatePerSecond =
      (borrowRatePerSecond * i * (WEI_VALUE - fee)) / WEI_VALUE / WEI_VALUE;

    rates.push({
      borrowRate: Number(getAnnualBorrowRate(borrowRatePerSecond)) / 1e18,
      supplyRate: Number(getAnnualBorrowRate(supplyRatePerSecond)) / 1e18,
      utilization: Number(i) / 1e18,
    });
  }

  return rates;
}

/**
 * Generate interest rate curve for fixed rate markets.
 *
 * @param params - Curve generation parameters
 * @param params.borrowRate - Fixed borrow rate per second
 * @param params.fee - Protocol fee (18 decimals)
 * @param params.points - Number of data points (default: 101)
 * @returns Array of rate points
 */
export function getFixedRateInterestRates(params: {
  borrowRate: bigint;
  fee: bigint;
  points?: number;
}): InterestRatePoint[] {
  const { borrowRate, fee, points = 101 } = params;

  const rates: InterestRatePoint[] = [];
  const step = WEI_VALUE / BigInt(points - 1);

  for (let i = 0n; i <= WEI_VALUE; i += step) {
    const supplyRateBySecond =
      (borrowRate * i * (WEI_VALUE - fee)) / WEI_VALUE / WEI_VALUE;

    rates.push({
      borrowRate: Number(getAnnualBorrowRate(borrowRate)) / 1e18,
      supplyRate: Number(getAnnualBorrowRate(supplyRateBySecond)) / 1e18,
      utilization: Number(i) / 1e18,
    });
  }

  return rates;
}
