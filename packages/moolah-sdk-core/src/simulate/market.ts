/**
 * Market Simulation Functions
 *
 * Simulates market borrow/repay operations.
 * For internal: Following lista-mono simulateMarketBorrowAtomF/simulateMarketRepayAtomF patterns.
 */

import { Decimal } from "../utils/decimal.js";

/** Default LTV threshold (98%) for safety margin calculations */
export const MARKET_THRESHOLD = new Decimal(98n, 2);

/**
 * Market state needed for simulation
 */
export interface SimulateMarketState {
  /** Total supply in the market */
  totalSupply: Decimal;
  /** Total borrow in the market */
  totalBorrow: Decimal;
  /** Liquidation LTV threshold */
  LLTV: Decimal;
  /** Price rate (collateral/loan price ratio) */
  priceRate: Decimal;
  /** Loan token decimals */
  loanDecimals: number;
  /** Collateral token decimals */
  collateralDecimals: number;
}

/**
 * User's current market position
 */
export interface SimulateUserPosition {
  /** Current collateral amount */
  collateral: Decimal;
  /** Current borrowed amount */
  borrowed: Decimal;
}

/**
 * Compute LTV (Loan-to-Value) ratio for simulation
 *
 * LTV = borrowed / (collateral * priceRate)
 *
 * @param borrowed - Total borrowed amount
 * @param collateral - Total collateral amount
 * @param priceRate - Price rate (collateral/loan price ratio)
 * @returns LTV ratio as Decimal
 */
export function simulateComputeLTV(
  borrowed: Decimal,
  collateral: Decimal,
  priceRate: Decimal,
): Decimal {
  const denominator = collateral.mul(priceRate);
  return denominator.gt(0n) ? borrowed.div(denominator) : Decimal.ZERO;
}

/**
 * Compute maximum loanable amount for simulation
 *
 * loanable = collateral * LTV_threshold * priceRate - borrowed
 *
 * @param collateral - Total collateral amount
 * @param borrowed - Current borrowed amount
 * @param LLTV - Liquidation LTV threshold
 * @param priceRate - Price rate
 * @param loanDecimals - Loan token decimals for rounding
 * @param threshold - Safety threshold (default 98%)
 * @returns Maximum additional amount that can be borrowed
 */
export function simulateComputeLoanable(
  collateral: Decimal,
  borrowed: Decimal,
  LLTV: Decimal,
  priceRate: Decimal,
  loanDecimals: number,
  threshold: Decimal = MARKET_THRESHOLD,
): Decimal {
  return collateral
    .mul(LLTV)
    .mul(threshold)
    .mul(priceRate)
    .sub(borrowed)
    .roundDown(loanDecimals);
}

/**
 * Compute maximum withdrawable collateral for simulation
 *
 * withdrawable = collateral - (borrowed - repay) / priceRate / LLTV / threshold
 *
 * @param collateral - Current collateral amount
 * @param borrowed - Current borrowed amount
 * @param repay - Repay amount
 * @param LLTV - Liquidation LTV threshold
 * @param priceRate - Price rate
 * @param collateralDecimals - Collateral token decimals for rounding
 * @param threshold - Safety threshold (default 98%)
 * @returns Maximum collateral that can be withdrawn
 */
export function simulateComputeWithdrawable(
  collateral: Decimal,
  borrowed: Decimal,
  repay: Decimal,
  LLTV: Decimal,
  priceRate: Decimal,
  collateralDecimals: number,
  threshold: Decimal = MARKET_THRESHOLD,
): Decimal {
  return collateral
    .sub(borrowed.sub(repay).div(priceRate).div(LLTV).div(threshold))
    .roundDown(collateralDecimals);
}

/**
 * Compute liquidation price rate
 *
 * liqPriceRate = borrowed / collateral / LLTV
 *
 * @param borrowed - Current borrowed amount
 * @param collateral - Current collateral amount
 * @param LLTV - Liquidation LTV threshold
 * @returns Liquidation price rate (price at which position gets liquidated)
 */
export function simulateComputeLiqPriceRate(
  borrowed: Decimal,
  collateral: Decimal,
  LLTV: Decimal,
): Decimal {
  if (collateral.lte(Decimal.ZERO)) {
    return Decimal.ZERO;
  }
  return borrowed.div(collateral).div(LLTV).roundDown(18);
}

/**
 * Parameters for market borrow simulation
 */
export interface SimulateMarketBorrowParams {
  /** Amount of collateral to supply */
  supplyAmount: Decimal;
  /** Amount to borrow */
  borrowAmount: Decimal;
  /** Current user position */
  userPosition: SimulateUserPosition;
  /** Market state */
  marketState: SimulateMarketState;
  /** Function to compute borrow rate from utilization rate */
  computeBorrowRate?: (utilRate: Decimal) => Decimal;
}

/**
 * Result of market borrow simulation
 */
export interface MarketBorrowSimulationResult {
  /** New collateral amount after supply */
  collateral: Decimal;
  /** New borrowed amount after borrow */
  borrowed: Decimal;
  /** New LTV ratio */
  LTV: Decimal;
  /** Maximum additional loanable after borrow (affected by borrowAmount) */
  loanable: Decimal;
  /** Maximum loanable from base position + supply (not affected by borrowAmount) */
  baseLoanable: Decimal;
  /** Compute loanable for a target LTV ratio . targetLTV is absolute e.g. 0.4 */
  computeLoanableForLTV: (targetLTV: number) => Decimal;
  /** Liquidation price rate */
  liqPriceRate: Decimal;
  /** New borrow rate (if computeBorrowRate provided) */
  borrowRate?: Decimal;
}

/**
 * Simulate a market borrow operation.
 *
 * @param params - Borrow simulation parameters
 * @returns Simulation result with new state
 *
 * @example
 * ```typescript
 * const result = simulateMarketBorrow({
 *   supplyAmount: Decimal.parse('100', 18),
 *   borrowAmount: Decimal.parse('50', 18),
 *   userPosition: {
 *     collateral: Decimal.parse('500', 18),
 *     borrowed: Decimal.parse('200', 18),
 *   },
 *   marketState: {
 *     totalSupply: Decimal.parse('10000', 18),
 *     totalBorrow: Decimal.parse('5000', 18),
 *     LLTV: Decimal.parse('0.8', 18),
 *     priceRate: Decimal.parse('1', 18),
 *     loanDecimals: 18,
 *     collateralDecimals: 18,
 *   },
 * });
 * // result.collateral = 600
 * // result.borrowed = 250
 * ```
 */
export function simulateMarketBorrow(
  params: SimulateMarketBorrowParams,
): MarketBorrowSimulationResult {
  const {
    supplyAmount,
    borrowAmount,
    userPosition,
    marketState,
    computeBorrowRate,
  } = params;
  const { collateral: currentCollateral, borrowed: currentBorrowed } =
    userPosition;
  const { totalSupply, totalBorrow, LLTV, priceRate, loanDecimals } =
    marketState;

  // Calculate new position
  const collateral = currentCollateral.add(supplyAmount);
  const borrowed = currentBorrowed.add(borrowAmount);

  // Calculate LTV
  const LTV = simulateComputeLTV(borrowed, collateral, priceRate);

  // Calculate loanable (post-borrow remaining)
  const loanable = simulateComputeLoanable(
    collateral,
    borrowed,
    LLTV,
    priceRate,
    loanDecimals,
  );

  // Calculate base loanable (from original borrowed, not affected by borrowAmount)
  const baseLoanable = simulateComputeLoanable(
    collateral,
    currentBorrowed,
    LLTV,
    priceRate,
    loanDecimals,
  );

  // Closure: compute loanable for a specific target LTV
  const computeLoanableForLTV = (targetLTV: number): Decimal => {
    const ltv = Decimal.parse(targetLTV.toString());
    return collateral
      .mul(ltv)
      .mul(priceRate)
      .sub(currentBorrowed)
      .roundDown(loanDecimals);
  };

  // Calculate liquidation price rate
  const liqPriceRate = simulateComputeLiqPriceRate(borrowed, collateral, LLTV);

  const result: MarketBorrowSimulationResult = {
    collateral,
    borrowed,
    LTV,
    loanable,
    baseLoanable,
    computeLoanableForLTV,
    liqPriceRate,
  };

  // Calculate new borrow rate if function provided
  if (computeBorrowRate) {
    const newUtilRate = totalSupply.gt(0n)
      ? totalBorrow.add(borrowAmount).div(totalSupply)
      : Decimal.ZERO;
    result.borrowRate = computeBorrowRate(newUtilRate);
  }

  return result;
}

/**
 * Parameters for market repay simulation
 */
export interface SimulateMarketRepayParams {
  /** Amount to repay */
  repayAmount: Decimal;
  /** Amount of collateral to withdraw */
  withdrawAmount: Decimal;
  /** Whether repaying all borrowed amount */
  isRepayAll?: boolean;
  /** Current user position */
  userPosition: SimulateUserPosition;
  /** Market state */
  marketState: SimulateMarketState;
  /** Function to compute borrow rate from utilization rate */
  computeBorrowRate?: (utilRate: Decimal) => Decimal;
}

/**
 * Result of market repay simulation
 */
export interface MarketRepaySimulationResult {
  /** New collateral amount after withdraw */
  collateral: Decimal;
  /** New borrowed amount after repay */
  borrowed: Decimal;
  /** New LTV ratio */
  LTV: Decimal;
  /** Maximum collateral that can be withdrawn */
  withdrawable: Decimal;
  /** Liquidation price rate */
  liqPriceRate: Decimal;
  /** New borrow rate (if computeBorrowRate provided) */
  borrowRate?: Decimal;
}

/**
 * Simulate a market repay operation.
 *
 * @param params - Repay simulation parameters
 * @returns Simulation result with new state
 *
 * @example
 * ```typescript
 * const result = simulateMarketRepay({
 *   repayAmount: Decimal.parse('100', 18),
 *   withdrawAmount: Decimal.parse('50', 18),
 *   userPosition: {
 *     collateral: Decimal.parse('500', 18),
 *     borrowed: Decimal.parse('200', 18),
 *   },
 *   marketState: {
 *     totalSupply: Decimal.parse('10000', 18),
 *     totalBorrow: Decimal.parse('5000', 18),
 *     LLTV: Decimal.parse('0.8', 18),
 *     priceRate: Decimal.parse('1', 18),
 *     loanDecimals: 18,
 *     collateralDecimals: 18,
 *   },
 * });
 * // result.collateral = 450
 * // result.borrowed = 100
 * ```
 */
export function simulateMarketRepay(
  params: SimulateMarketRepayParams,
): MarketRepaySimulationResult {
  const {
    repayAmount,
    withdrawAmount,
    isRepayAll = false,
    userPosition,
    marketState,
    computeBorrowRate,
  } = params;
  const { collateral: currentCollateral, borrowed: currentBorrowed } =
    userPosition;
  const { totalSupply, totalBorrow, LLTV, priceRate, collateralDecimals } =
    marketState;

  // Calculate new position
  const collateral = currentCollateral
    .sub(withdrawAmount)
    .roundDown(collateralDecimals);
  const borrowed = isRepayAll ? Decimal.ZERO : currentBorrowed.sub(repayAmount);

  // Calculate LTV
  const LTV = simulateComputeLTV(borrowed, collateral, priceRate);

  // Calculate withdrawable
  const withdrawable = isRepayAll
    ? currentCollateral
    : simulateComputeWithdrawable(
        currentCollateral,
        currentBorrowed,
        repayAmount,
        LLTV,
        priceRate,
        collateralDecimals,
      );

  // Calculate liquidation price rate
  const liqPriceRate = simulateComputeLiqPriceRate(borrowed, collateral, LLTV);

  const result: MarketRepaySimulationResult = {
    collateral,
    borrowed,
    LTV,
    withdrawable,
    liqPriceRate,
  };

  // Calculate new borrow rate if function provided
  if (computeBorrowRate) {
    const newUtilRate = totalSupply.gt(0n)
      ? totalBorrow.sub(repayAmount).div(totalSupply)
      : Decimal.ZERO;
    result.borrowRate = computeBorrowRate(newUtilRate);
  }

  return result;
}
