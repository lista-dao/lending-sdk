/**
 * Position Calculations
 *
 * Pure functions for calculating LTV, loanable amount, withdrawable amount, etc.
 * Position logic aligned with protocol frontend.
 * For internal: Extracted from lista-mono marketUserDataAtomF.ts for SDK reuse.
 *
 * All functions are stateless and can be used independently.
 */

import { MathLib } from "@morpho-org/blue-sdk";

/**
 * Default threshold for safe operations (98%)
 * Used to prevent liquidation by leaving a safety margin
 */
const DEFAULT_THRESHOLD = 98n;
const THRESHOLD_SCALE = 100n;
const DECIMAL_SCALE = 10n ** 18n;

/**
 * Parameters for LTV calculation
 */
export interface ComputeLTVParams {
  /** Current collateral amount (raw bigint, in collateral token decimals) */
  collateral: bigint;
  /** Current borrowed amount (raw bigint, in loan token decimals) */
  borrowed: bigint;
  /** Price rate: collateral/loan price ratio (18 decimals) */
  priceRate: bigint;
  /** Additional collateral to supply (raw bigint) */
  supplyAmount?: bigint;
  /** Amount to borrow (raw bigint) */
  borrowAmount?: bigint;
  /** Amount to repay (raw bigint) */
  repayAmount?: bigint;
  /** Amount to withdraw (raw bigint) */
  withdrawAmount?: bigint;
}

/**
 * Calculate Loan-to-Value ratio.
 *
 * LTV = borrowed / (collateral * priceRate)
 *
 * @param params - Calculation parameters
 * @returns LTV as bigint (18 decimals, 1e18 = 100%)
 *
 * @example
 * ```typescript
 * const ltv = computeLTV({
 *   collateral: 1000000000000000000n,  // 1 ETH
 *   borrowed: 500000000000000000n,      // 0.5 USDC (adjusted)
 *   priceRate: 2000000000000000000000n, // ETH = 2000 USDC
 *   borrowAmount: 100000000000000000n,  // borrow 0.1 more
 * });
 * // Returns new LTV considering the additional borrow
 * ```
 */
export function computeLTV(params: ComputeLTVParams): bigint {
  const {
    collateral,
    borrowed,
    priceRate,
    supplyAmount = 0n,
    borrowAmount = 0n,
    repayAmount = 0n,
    withdrawAmount = 0n,
  } = params;

  // Calculate new collateral and borrow amounts
  const newCollateral = collateral + supplyAmount - withdrawAmount;
  const newBorrowed = borrowed + borrowAmount - repayAmount;

  // denominator = newCollateral * priceRate
  const denominator = (newCollateral * priceRate) / DECIMAL_SCALE;

  if (denominator <= 0n) {
    return 0n;
  }

  // LTV = newBorrowed / denominator
  return (newBorrowed * DECIMAL_SCALE) / denominator;
}

/**
 * Parameters for loanable amount calculation
 */
export interface ComputeLoanableParams {
  /** Current collateral amount (raw bigint) */
  collateral: bigint;
  /** Current borrowed amount (raw bigint) */
  borrowed: bigint;
  /** Price rate: collateral/loan price ratio (18 decimals) */
  priceRate: bigint;
  /** Liquidation LTV from market params (18 decimals) */
  lltv: bigint;
  /** Additional collateral to supply (raw bigint) */
  supplyAmount?: bigint;
  /** Target LTV percentage (0-100, default uses LLTV * 98%) */
  targetLTVPercent?: number;
  /** Loan token decimals (for rounding) */
  loanDecimals?: number;
}

/**
 * Calculate maximum loanable amount.
 *
 * loanable = (collateral + supply) * targetLTV * priceRate - borrowed
 *
 * @param params - Calculation parameters
 * @returns Maximum additional amount that can be borrowed (raw bigint)
 *
 * @example
 * ```typescript
 * const loanable = computeLoanable({
 *   collateral: 1000000000000000000n,  // 1 ETH
 *   borrowed: 0n,
 *   priceRate: 2000000000000000000000n, // ETH = 2000 USDC
 *   lltv: 800000000000000000n,          // 80% LLTV
 *   supplyAmount: 500000000000000000n,  // adding 0.5 ETH
 * });
 * // Returns max borrowable with safety margin
 * ```
 */
export function computeLoanable(params: ComputeLoanableParams): bigint {
  const {
    collateral,
    borrowed,
    priceRate,
    lltv,
    supplyAmount = 0n,
    targetLTVPercent,
    loanDecimals = 18,
  } = params;

  // Calculate effective LTV target
  let targetLTV: bigint;
  if (targetLTVPercent != null) {
    targetLTV = BigInt(Math.floor(targetLTVPercent * 1e16)); // Convert percent to 18 decimals
  } else {
    // Default: LLTV * 98%
    targetLTV = (lltv * DEFAULT_THRESHOLD) / THRESHOLD_SCALE;
  }

  const totalCollateral = collateral + supplyAmount;

  // loanable = totalCollateral * targetLTV * priceRate - borrowed
  const maxBorrow =
    (totalCollateral * targetLTV * priceRate) / DECIMAL_SCALE / DECIMAL_SCALE;

  const loanable = maxBorrow > borrowed ? maxBorrow - borrowed : 0n;

  // Round down to loan token decimals
  const scale = 10n ** BigInt(loanDecimals);
  return (loanable / scale) * scale;
}

/**
 * Parameters for withdrawable amount calculation
 */
export interface ComputeWithdrawableParams {
  /** Current collateral amount (raw bigint) */
  collateral: bigint;
  /** Current borrowed amount (raw bigint) */
  borrowed: bigint;
  /** Price rate: collateral/loan price ratio (18 decimals) */
  priceRate: bigint;
  /** Liquidation LTV from market params (18 decimals) */
  lltv: bigint;
  /** Amount to repay (raw bigint) */
  repayAmount?: bigint;
  /** Collateral token decimals (for rounding) */
  collateralDecimals?: number;
}

/**
 * Calculate maximum withdrawable collateral amount.
 *
 * withdrawable = collateral - (borrowed - repay) / priceRate / LLTV / threshold
 *
 * @param params - Calculation parameters
 * @returns Maximum collateral that can be withdrawn (raw bigint)
 *
 * @example
 * ```typescript
 * const withdrawable = computeWithdrawable({
 *   collateral: 1000000000000000000n,   // 1 ETH
 *   borrowed: 1000000000000000000000n,  // 1000 USDC
 *   priceRate: 2000000000000000000000n, // ETH = 2000 USDC
 *   lltv: 800000000000000000n,          // 80% LLTV
 *   repayAmount: 500000000000000000000n, // repaying 500 USDC
 * });
 * ```
 */
export function computeWithdrawable(params: ComputeWithdrawableParams): bigint {
  const {
    collateral,
    borrowed,
    priceRate,
    lltv,
    repayAmount = 0n,
    collateralDecimals = 18,
  } = params;

  const remainingBorrow = borrowed > repayAmount ? borrowed - repayAmount : 0n;

  if (remainingBorrow === 0n) {
    return collateral;
  }

  // Calculate minimum collateral required
  // minCollateral = remainingBorrow / priceRate / LLTV / threshold
  const threshold = (lltv * DEFAULT_THRESHOLD) / THRESHOLD_SCALE;
  const minCollateral =
    (remainingBorrow * DECIMAL_SCALE * DECIMAL_SCALE) / priceRate / threshold;

  const withdrawable =
    collateral > minCollateral ? collateral - minCollateral : 0n;

  // Round down to collateral token precision
  // Only apply rounding for tokens with fewer than 18 decimals
  if (collateralDecimals >= 18) {
    return withdrawable;
  }
  const scale = 10n ** BigInt(18 - collateralDecimals);
  return (withdrawable / scale) * scale;
}

/**
 * Parameters for extra repay amount calculation
 */
export interface GetExtraRepayAmountParams {
  /** Current borrowed amount (raw bigint) */
  borrowed: bigint;
  /** Current interest rate per second from contract */
  rateView: bigint;
  /** Last update timestamp */
  lastUpdate: bigint;
  /** Buffer time in minutes (default: 20) */
  bufferMinutes?: number;
}

/**
 * Calculate extra repay amount needed to fully close a position.
 *
 * Accounts for interest accrued during transaction confirmation time.
 *
 * @param params - Calculation parameters
 * @returns Total repay amount including buffer interest (raw bigint)
 *
 * @example
 * ```typescript
 * const totalRepay = getExtraRepayAmount({
 *   borrowed: 1000000000000000000000n,  // 1000 USDC
 *   rateView: 158548959n,                // rate per second
 *   lastUpdate: 1704067200n,
 *   bufferMinutes: 20,                   // 20 min buffer
 * });
 * ```
 */
export function getExtraRepayAmount(params: GetExtraRepayAmountParams): bigint {
  const { borrowed, rateView, lastUpdate, bufferMinutes = 20 } = params;

  const now = BigInt(Math.round(Date.now() / 1000));
  const elapsed = now - lastUpdate + BigInt(bufferMinutes * 60);

  // Calculate unrealized interest rate using Taylor expansion
  const unrealizedRate = MathLib.wTaylorCompounded(rateView, elapsed);

  // Total = borrowed * (1 + unrealizedRate)
  const total = borrowed + (borrowed * unrealizedRate) / DECIMAL_SCALE;

  return total;
}

/**
 * Calculate liquidation price rate.
 *
 * The price at which the position would be liquidated.
 * liqPrice = borrowed / collateral / LLTV
 *
 * @param params - Calculation parameters
 * @returns Liquidation price rate (18 decimals)
 */
export function computeLiquidationPrice(params: {
  collateral: bigint;
  borrowed: bigint;
  lltv: bigint;
}): bigint {
  const { collateral, borrowed, lltv } = params;

  if (collateral <= 0n) {
    return 0n;
  }

  // liqPrice = borrowed / collateral / LLTV
  return (borrowed * DECIMAL_SCALE * DECIMAL_SCALE) / collateral / lltv;
}

/**
 * Simulation result for borrow/repay operations
 */
export interface SimulationResult {
  /** New LTV after operation (18 decimals) */
  newLTV: bigint;
  /** New borrowed amount */
  newBorrowed: bigint;
  /** New collateral amount */
  newCollateral: bigint;
  /** New liquidation price */
  newLiqPrice: bigint;
  /** Maximum additional loanable */
  newLoanable: bigint;
  /** Maximum withdrawable */
  newWithdrawable: bigint;
}

/**
 * Simulate a borrow operation and return new position state.
 *
 * @param params - Current position and operation parameters
 * @returns New position state after operation
 */
export function simulateBorrow(params: {
  collateral: bigint;
  borrowed: bigint;
  priceRate: bigint;
  lltv: bigint;
  supplyAmount?: bigint;
  borrowAmount?: bigint;
  loanDecimals?: number;
  collateralDecimals?: number;
}): SimulationResult {
  const {
    collateral,
    borrowed,
    priceRate,
    lltv,
    supplyAmount = 0n,
    borrowAmount = 0n,
    loanDecimals = 18,
    collateralDecimals = 18,
  } = params;

  const newCollateral = collateral + supplyAmount;
  const newBorrowed = borrowed + borrowAmount;

  const newLTV = computeLTV({
    collateral: newCollateral,
    borrowed: newBorrowed,
    priceRate,
  });

  const newLiqPrice = computeLiquidationPrice({
    collateral: newCollateral,
    borrowed: newBorrowed,
    lltv,
  });

  const newLoanable = computeLoanable({
    collateral: newCollateral,
    borrowed: newBorrowed,
    priceRate,
    lltv,
    loanDecimals,
  });

  const newWithdrawable = computeWithdrawable({
    collateral: newCollateral,
    borrowed: newBorrowed,
    priceRate,
    lltv,
    collateralDecimals,
  });

  return {
    newLTV,
    newBorrowed,
    newCollateral,
    newLiqPrice,
    newLoanable,
    newWithdrawable,
  };
}

/**
 * Simulate a repay operation and return new position state.
 *
 * @param params - Current position and operation parameters
 * @returns New position state after operation
 */
export function simulateRepay(params: {
  collateral: bigint;
  borrowed: bigint;
  priceRate: bigint;
  lltv: bigint;
  repayAmount?: bigint;
  withdrawAmount?: bigint;
  loanDecimals?: number;
  collateralDecimals?: number;
}): SimulationResult {
  const {
    collateral,
    borrowed,
    priceRate,
    lltv,
    repayAmount = 0n,
    withdrawAmount = 0n,
    loanDecimals = 18,
    collateralDecimals = 18,
  } = params;

  const newCollateral =
    collateral > withdrawAmount ? collateral - withdrawAmount : 0n;
  const newBorrowed = borrowed > repayAmount ? borrowed - repayAmount : 0n;

  const newLTV = computeLTV({
    collateral: newCollateral,
    borrowed: newBorrowed,
    priceRate,
  });

  const newLiqPrice = computeLiquidationPrice({
    collateral: newCollateral,
    borrowed: newBorrowed,
    lltv,
  });

  const newLoanable = computeLoanable({
    collateral: newCollateral,
    borrowed: newBorrowed,
    priceRate,
    lltv,
    loanDecimals,
  });

  const newWithdrawable = computeWithdrawable({
    collateral: newCollateral,
    borrowed: newBorrowed,
    priceRate,
    lltv,
    collateralDecimals,
  });

  return {
    newLTV,
    newBorrowed,
    newCollateral,
    newLiqPrice,
    newLoanable,
    newWithdrawable,
  };
}
