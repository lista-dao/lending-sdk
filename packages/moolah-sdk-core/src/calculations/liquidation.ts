/**
 * Liquidation incentive maths.
 *
 * A liquidator repays a borrower's debt and seizes collateral at a discount.
 * The discount is derived from the market's LLTV, capped, and both constants
 * come straight from the protocol's ConstantsLib:
 *
 *   MAX_LIQUIDATION_INCENTIVE_FACTOR = 1.15e18
 *   LIQUIDATION_CURSOR               = 0.3e18
 *
 * They are asserted against the deployed contracts by the conformance job, so
 * a protocol-side change shows up as a red test rather than silently wrong
 * numbers in a liquidator's sizing.
 */

const WAD = 10n ** 18n;

/** Ceiling on the incentive factor: 1.15e18. */
export const MAX_LIQUIDATION_INCENTIVE_FACTOR = 1_150_000_000_000_000_000n;

/** Share of the LLTV shortfall paid as incentive: 0.3e18. */
export const LIQUIDATION_CURSOR = 300_000_000_000_000_000n;

/**
 * Incentive factor for a market, in WAD.
 *
 * `min(MAX, 1 / (1 - CURSOR * (1 - lltv)))` — the further LLTV is from 1, the
 * larger the incentive, until the cap binds.
 *
 * @param lltv Loan-to-value in WAD (0.8e18 = 80%).
 */
export function liquidationIncentiveFactor(lltv: bigint): bigint {
  if (lltv < 0n || lltv > WAD) {
    throw new Error(
      `liquidationIncentiveFactor: lltv must be between 0 and 1e18, got ${lltv}`,
    );
  }

  // denominator = 1 - cursor * (1 - lltv), in WAD
  const denominator = WAD - (LIQUIDATION_CURSOR * (WAD - lltv)) / WAD;
  const factor = (WAD * WAD) / denominator;

  return factor < MAX_LIQUIDATION_INCENTIVE_FACTOR
    ? factor
    : MAX_LIQUIDATION_INCENTIVE_FACTOR;
}

/**
 * Effective price a liquidator pays per unit of seized collateral.
 *
 * The collateral's oracle price divided by the incentive factor — the discount
 * that makes liquidating worthwhile.
 */
export function liquidationDiscountPrice(
  collateralPrice: bigint,
  lltv: bigint,
): bigint {
  return (collateralPrice * WAD) / liquidationIncentiveFactor(lltv);
}

/**
 * Discount as a WAD fraction of the oracle price, for display.
 *
 * `1 - 1/factor`. A factor of 1.15e18 is roughly a 13% discount.
 */
export function liquidationDiscountRate(lltv: bigint): bigint {
  return WAD - (WAD * WAD) / liquidationIncentiveFactor(lltv);
}

/**
 * Health factor for a position, in WAD. Below 1e18 is liquidatable.
 *
 * Returns `null` when there is no debt, since a position with nothing borrowed
 * has no health factor rather than an infinite one.
 */
export function positionHealthFactor(params: {
  collateral: bigint;
  /** Collateral price in the market's oracle scale. */
  collateralPrice: bigint;
  /** Debt in loan-token units, in the same scale as `collateralPrice` implies. */
  borrowed: bigint;
  lltv: bigint;
  /** Oracle price scale. Moolah's market oracles are 1e36. */
  priceScale?: bigint;
}): bigint | null {
  if (params.borrowed <= 0n) return null;

  const scale = params.priceScale ?? 10n ** 36n;
  const collateralValue = (params.collateral * params.collateralPrice) / scale;
  const maxBorrow = (collateralValue * params.lltv) / WAD;

  return (maxBorrow * WAD) / params.borrowed;
}
