/**
 * Vault Simulation Functions
 *
 * Simulates vault deposit/withdraw operations.
 * For internal: Following lista-mono simulateVaultDepositAtomF/simulateVaultWithdrawAtomF patterns.
 */

import { Decimal } from "../utils/decimal";

/**
 * Parameters for vault deposit simulation
 */
export interface SimulateVaultDepositParams {
  /** Amount to deposit */
  depositAmount: Decimal;
  /** Current user locked amount in vault */
  userLocked: Decimal;
  /** Current user wallet balance */
  userBalance: Decimal;
  /** Optional: Vault APY for earnings calculation (18 decimals, 1 = 100%) */
  apy?: Decimal;
  /** Optional: Asset price in USD for earnings calculation */
  assetPrice?: Decimal;
}

/**
 * Result of vault deposit simulation
 */
export interface VaultDepositSimulationResult {
  /** New locked amount after deposit */
  locked: Decimal;
  /** New wallet balance after deposit */
  balance: Decimal;
  /** Projected monthly earnings in USD (if apy and assetPrice provided) */
  monthlyEarnings?: Decimal;
  /** Projected yearly earnings in USD (if apy and assetPrice provided) */
  yearlyEarnings?: Decimal;
}

/**
 * Simulate a vault deposit operation.
 *
 * @param params - Deposit simulation parameters
 * @returns Simulation result with new state
 *
 * @example
 * ```typescript
 * const result = simulateVaultDeposit({
 *   depositAmount: Decimal.parse('100', 18),
 *   userLocked: Decimal.parse('500', 18),
 *   userBalance: Decimal.parse('1000', 18),
 *   apy: Decimal.parse('0.05', 18),        // 5% APY
 *   assetPrice: Decimal.parse('1', 18),    // $1 per token
 * });
 * // result.locked = 600
 * // result.balance = 900
 * // result.yearlyEarnings = 30 (600 * 0.05 * 1)
 * ```
 */
export function simulateVaultDeposit(
  params: SimulateVaultDepositParams,
): VaultDepositSimulationResult {
  const { depositAmount, userLocked, userBalance, apy, assetPrice } = params;

  const locked = userLocked.add(depositAmount);
  const balance = userBalance.sub(depositAmount);

  const result: VaultDepositSimulationResult = {
    locked,
    balance,
  };

  // Calculate earnings if APY and asset price are provided
  if (apy && assetPrice) {
    const yearlyEarnings = locked.mul(apy).mul(assetPrice);
    const monthlyEarnings = yearlyEarnings.div(12);
    result.yearlyEarnings = yearlyEarnings;
    result.monthlyEarnings = monthlyEarnings;
  }

  return result;
}

/**
 * Parameters for vault withdraw simulation
 */
export interface SimulateVaultWithdrawParams {
  /** Amount to withdraw */
  withdrawAmount: Decimal;
  /** Current user locked amount in vault */
  userLocked: Decimal;
  /** Current user wallet balance */
  userBalance: Decimal;
  /** Optional: Vault APY for earnings calculation */
  apy?: Decimal;
  /** Optional: Asset price in USD for earnings calculation */
  assetPrice?: Decimal;
}

/**
 * Result of vault withdraw simulation
 */
export interface VaultWithdrawSimulationResult {
  /** New locked amount after withdraw */
  locked: Decimal;
  /** New wallet balance after withdraw */
  balance: Decimal;
  /** Projected monthly earnings in USD (if apy and assetPrice provided) */
  monthlyEarnings?: Decimal;
  /** Projected yearly earnings in USD (if apy and assetPrice provided) */
  yearlyEarnings?: Decimal;
}

/**
 * Simulate a vault withdraw operation.
 *
 * @param params - Withdraw simulation parameters
 * @returns Simulation result with new state
 *
 * @example
 * ```typescript
 * const result = simulateVaultWithdraw({
 *   withdrawAmount: Decimal.parse('100', 18),
 *   userLocked: Decimal.parse('500', 18),
 *   userBalance: Decimal.parse('200', 18),
 *   apy: Decimal.parse('0.05', 18),
 *   assetPrice: Decimal.parse('1', 18),
 * });
 * // result.locked = 400
 * // result.balance = 300
 * ```
 */
export function simulateVaultWithdraw(
  params: SimulateVaultWithdrawParams,
): VaultWithdrawSimulationResult {
  const { withdrawAmount, userLocked, userBalance, apy, assetPrice } = params;

  const locked = userLocked.sub(withdrawAmount);
  const balance = userBalance.add(withdrawAmount);

  const result: VaultWithdrawSimulationResult = {
    locked,
    balance,
  };

  // Calculate earnings if APY and asset price are provided
  if (apy && assetPrice) {
    const yearlyEarnings = locked.mul(apy).mul(assetPrice);
    const monthlyEarnings = yearlyEarnings.div(12);
    result.yearlyEarnings = yearlyEarnings;
    result.monthlyEarnings = monthlyEarnings;
  }

  return result;
}
