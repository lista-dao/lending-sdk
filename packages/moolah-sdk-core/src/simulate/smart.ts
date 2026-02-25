/**
 * Smart Lending Market Simulation Functions
 *
 * Simulates smart lending market borrow/repay operations.
 * Smart lending uses LP tokens as collateral with two underlying tokens (A and B).
 * Simulates smart market borrow/repay for LP-collateral positions.
 * For internal: Following lista-mono simulateMarketBorrowOfSmartAtomF/simulateMarketRepayOfSmartAtomF patterns.
 */

import { Decimal } from "../utils/decimal";

/** Default LTV threshold (98%) for safety margin calculations */
export const SMART_THRESHOLD = new Decimal(98n, 2);

/**
 * Smart market state needed for simulation
 */
export interface SmartMarketState {
    /** Total supply in the market */
    totalSupply: Decimal;
    /** Total borrow in the market */
    totalBorrow: Decimal;
    /** Liquidation LTV threshold */
    LLTV: Decimal;
    /** Price rate (LP/loan price ratio) */
    priceRate: Decimal;
    /** Loan token decimals */
    loanDecimals: number;
    /** LP token decimals */
    lpDecimals: number;
    /** LP token balances [tokenA, tokenB] */
    lpBalances: readonly [Decimal, Decimal];
    /** Total LP supply */
    totalLp: Decimal;
}

/**
 * User's current smart market position
 */
export interface SmartUserPosition {
    /** Current LP collateral amount */
    collateral: Decimal;
    /** Current borrowed amount */
    borrowed: Decimal;
    /** Current LP token A value */
    lpTokenA: Decimal;
    /** Current LP token B value */
    lpTokenB: Decimal;
}

/**
 * Compute Smart Market LTV (Loan-to-Value) ratio
 *
 * LTV = borrowed / (collateral * priceRate)
 *
 * @param borrowed - Total borrowed amount (with any additional borrow)
 * @param collateral - Total LP collateral amount
 * @param priceRate - Price rate (LP/loan price ratio)
 * @returns LTV ratio as Decimal
 */
export function computeSmartLTV(
    borrowed: Decimal,
    collateral: Decimal,
    priceRate: Decimal,
): Decimal {
    try {
        const denominator = collateral.mul(priceRate);
        return denominator.gt(0n) ? borrowed.div(denominator) : Decimal.ZERO;
    } catch {
        return Decimal.ZERO;
    }
}

/**
 * Compute maximum loanable amount for smart market
 *
 * loanable = collateral * LLTV * threshold * priceRate - borrowed
 *
 * @param collateral - Total LP collateral amount
 * @param borrowed - Current borrowed amount
 * @param LLTV - Liquidation LTV threshold
 * @param priceRate - Price rate
 * @param loanDecimals - Loan token decimals for rounding
 * @param threshold - Safety threshold (default 98%)
 * @returns Maximum additional amount that can be borrowed
 */
export function computeSmartLoanable(
    collateral: Decimal,
    borrowed: Decimal,
    LLTV: Decimal,
    priceRate: Decimal,
    loanDecimals: number,
    threshold: Decimal = SMART_THRESHOLD,
): Decimal {
    return collateral
        .mul(LLTV)
        .mul(threshold)
        .mul(priceRate)
        .sub(borrowed)
        .roundDown(loanDecimals);
}

/**
 * Compute maximum withdrawable LP collateral for smart market
 *
 * @param collateral - Current LP collateral amount
 * @param borrowed - Current borrowed amount
 * @param repay - Repay amount
 * @param LLTV - Liquidation LTV threshold
 * @param priceRate - Price rate
 * @param lpDecimals - LP token decimals for rounding
 * @param lpBalances - LP token balances [tokenA, tokenB]
 * @param totalLp - Total LP supply
 * @param slippage - Slippage tolerance
 * @param isFixed - Whether using fixed withdraw (no slippage)
 * @param threshold - Safety threshold (default 98%)
 * @returns Tuple of [maxWithdrawA, maxWithdrawB, maxWithdrawLp]
 */
export function computeSmartWithdrawable(
    collateral: Decimal,
    borrowed: Decimal,
    repay: Decimal,
    LLTV: Decimal,
    priceRate: Decimal,
    lpDecimals: number,
    lpBalances: readonly [Decimal, Decimal],
    totalLp: Decimal,
    slippage: Decimal = Decimal.ZERO,
    isFixed: boolean = false,
    threshold: Decimal = SMART_THRESHOLD,
): readonly [Decimal, Decimal, Decimal] {
    if (priceRate.isZero() || totalLp.isZero()) {
        return [Decimal.ZERO, Decimal.ZERO, Decimal.ZERO] as const;
    }

    const percent = Decimal.ONE.sub(slippage);
    let maxWithdrawLp = collateral
        .sub(borrowed.sub(repay).div(priceRate).div(LLTV).div(threshold))
        .roundDown(lpDecimals);

    if (isFixed) {
        const maxWithdrawA = lpBalances[0].mul(maxWithdrawLp).div(totalLp);
        const maxWithdrawB = lpBalances[1].mul(maxWithdrawLp).div(totalLp);
        return [maxWithdrawA, maxWithdrawB, maxWithdrawLp] as const;
    }

    maxWithdrawLp = maxWithdrawLp.mul(percent).roundDown(18);
    const maxWithdrawA = lpBalances[0].mul(maxWithdrawLp).div(totalLp);
    const maxWithdrawB = lpBalances[1].mul(maxWithdrawLp).div(totalLp);
    return [maxWithdrawA, maxWithdrawB, maxWithdrawLp] as const;
}

/**
 * Break down LP amount into token A and B amounts
 *
 * @param lpAmount - LP token amount
 * @param lpBalances - LP token balances [tokenA, tokenB]
 * @param totalLp - Total LP supply
 * @returns Object with aOutput and bOutput
 */
export function breakdownLp(
    lpAmount: Decimal,
    lpBalances: readonly [Decimal, Decimal],
    totalLp: Decimal,
): { aOutput: Decimal; bOutput: Decimal } {
    if (totalLp.isZero()) {
        return { aOutput: Decimal.ZERO, bOutput: Decimal.ZERO };
    }
    const aOutput = lpBalances[0].mul(lpAmount).div(totalLp);
    const bOutput = lpBalances[1].mul(lpAmount).div(totalLp);
    return { aOutput, bOutput };
}

/**
 * Parameters for smart market borrow simulation
 */
export interface SimulateSmartMarketBorrowParams {
    /** LP amount to supply directly (mutually exclusive with tokenA/tokenB) */
    supplyLpAmount: Decimal;
    /** Token A amount to supply (used with tokenBAmount) */
    tokenAAmount: Decimal;
    /** Token B amount to supply (used with tokenAAmount) */
    tokenBAmount: Decimal;
    /** Amount to borrow */
    borrowAmount: Decimal;
    /** Current user position */
    userPosition: SmartUserPosition;
    /** Market state */
    marketState: SmartMarketState;
    /** Function to compute LP output from token amounts */
    computeLpOutput?: (
        dAmounts: [Decimal, Decimal],
        originalLp: Decimal,
    ) => { lpOutput: Decimal; aOutput: Decimal; bOutput: Decimal };
    /** Function to compute borrow rate from utilization rate */
    computeBorrowRate?: (utilRate: Decimal) => Decimal;
}

/**
 * Result of smart market borrow simulation
 */
export interface SmartMarketBorrowSimulationResult {
    /** New LP collateral amount after supply */
    collateral: Decimal;
    /** New LP token A value */
    lpTokenA: Decimal;
    /** New LP token B value */
    lpTokenB: Decimal;
    /** New borrowed amount after borrow */
    borrowed: Decimal;
    /** New LTV ratio */
    LTV: Decimal;
    /** Maximum additional loanable after borrow (affected by borrowAmount) */
    loanable: Decimal;
    /** Maximum loanable from base position + supply (not affected by borrowAmount, for % buttons) */
    baseLoanable: Decimal;
    /** Compute loanable for a target LTV ratio (for slider). targetLTV is absolute e.g. 0.4 */
    computeLoanableForLTV: (targetLTV: number) => Decimal;
    /** New borrow rate (if computeBorrowRate provided) */
    borrowRate?: Decimal;
}

/**
 * Simulate a smart market borrow operation.
 *
 * @param params - Borrow simulation parameters
 * @returns Simulation result with new state
 *
 * @example
 * ```typescript
 * const result = simulateSmartMarketBorrow({
 *   supplyLpAmount: Decimal.ZERO,
 *   tokenAAmount: Decimal.parse('100', 18),
 *   tokenBAmount: Decimal.parse('100', 18),
 *   borrowAmount: Decimal.parse('50', 18),
 *   userPosition: { ... },
 *   marketState: { ... },
 *   computeLpOutput: info._computeLpOutput,
 * });
 * ```
 */
export function simulateSmartMarketBorrow(
    params: SimulateSmartMarketBorrowParams,
): SmartMarketBorrowSimulationResult {
    const {
        supplyLpAmount,
        tokenAAmount,
        tokenBAmount,
        borrowAmount,
        userPosition,
        marketState,
        computeLpOutput,
        computeBorrowRate,
    } = params;
    const { collateral, borrowed: currentBorrowed } = userPosition;
    const {
        totalSupply,
        totalBorrow,
        LLTV,
        priceRate,
        loanDecimals,
        lpBalances,
        totalLp,
    } = marketState;

    const isLpMode = supplyLpAmount.gt(Decimal.ZERO);

    let aOutput: Decimal;
    let bOutput: Decimal;
    let lpOutput: Decimal;

    if (isLpMode) {
        lpOutput = collateral.add(supplyLpAmount);
        const breakdown = breakdownLp(lpOutput, lpBalances, totalLp);
        aOutput = breakdown.aOutput;
        bOutput = breakdown.bOutput;
    } else if (computeLpOutput) {
        const result = computeLpOutput([tokenAAmount, tokenBAmount], collateral);
        aOutput = result.aOutput;
        bOutput = result.bOutput;
        lpOutput = result.lpOutput;
    } else {
        // Fallback: just use current collateral
        lpOutput = collateral;
        const breakdown = breakdownLp(lpOutput, lpBalances, totalLp);
        aOutput = breakdown.aOutput;
        bOutput = breakdown.bOutput;
    }

    // Calculate new borrowed
    const borrowed = currentBorrowed.add(borrowAmount);

    // Calculate LTV
    const LTV = computeSmartLTV(borrowed, lpOutput, priceRate);

    // Calculate loanable (post-borrow remaining)
    const loanable = computeSmartLoanable(
        lpOutput,
        borrowed,
        LLTV,
        priceRate,
        loanDecimals,
    );

    // Calculate base loanable (from original borrowed, not affected by borrowAmount)
    const baseLoanable = computeSmartLoanable(
        lpOutput,
        currentBorrowed,
        LLTV,
        priceRate,
        loanDecimals,
    );

    // Closure: compute loanable for a specific target LTV
    const computeLoanableForLTV = (targetLTV: number): Decimal => {
        const ltv = Decimal.parse(targetLTV.toString());
        return lpOutput
            .mul(ltv)
            .mul(priceRate)
            .sub(currentBorrowed)
            .roundDown(loanDecimals);
    };

    const result: SmartMarketBorrowSimulationResult = {
        collateral: lpOutput,
        lpTokenA: aOutput,
        lpTokenB: bOutput,
        borrowed,
        LTV,
        loanable,
        baseLoanable,
        computeLoanableForLTV,
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
 * Parameters for smart market repay simulation
 */
export interface SimulateSmartMarketRepayParams {
    /** Swap type: 'fixed', 'variable', or 'lp' */
    swapType: "fixed" | "variable" | "lp";
    /** Amount to repay */
    repayAmount: Decimal;
    /** LP amount to withdraw (for 'lp' mode) */
    withdrawLpAmount: Decimal;
    /** Token A amount to withdraw (for 'variable' mode) */
    tokenAAmount: Decimal;
    /** Token B amount to withdraw (for 'variable' mode) */
    tokenBAmount: Decimal;
    /** Slippage tolerance */
    slippage: Decimal;
    /** Whether repaying all borrowed amount */
    isRepayAll?: boolean;
    /** Whether withdrawing all collateral */
    isWithdrawAll?: boolean;
    /** Current user position */
    userPosition: SmartUserPosition;
    /** Market state */
    marketState: SmartMarketState;
    /** Function to compute LP output from token amounts */
    computeLpOutput?: (
        dAmounts: [Decimal, Decimal],
        originalLp: Decimal,
        slippage?: Decimal,
    ) => { lpOutput: Decimal; aOutput: Decimal; bOutput: Decimal };
    /** Function to compute borrow rate from utilization rate */
    computeBorrowRate?: (utilRate: Decimal) => Decimal;
}

/**
 * Result of smart market repay simulation
 */
export interface SmartMarketRepaySimulationResult {
    /** New LP token A value */
    lpTokenA: Decimal;
    /** New LP token B value */
    lpTokenB: Decimal;
    /** New borrowed amount after repay */
    borrowed: Decimal;
    /** New LTV ratio */
    LTV: Decimal;
    /** Maximum withdrawable [tokenA, tokenB, lp] */
    withdrawable: readonly [Decimal, Decimal, Decimal];
    /** Whether position exceeds safety limits */
    exceedError: boolean;
    /** New borrow rate (if computeBorrowRate provided) */
    borrowRate?: Decimal;
}

/**
 * Simulate a smart market repay operation.
 *
 * @param params - Repay simulation parameters
 * @returns Simulation result with new state
 *
 * @example
 * ```typescript
 * const result = simulateSmartMarketRepay({
 *   swapType: 'fixed',
 *   repayAmount: Decimal.parse('100', 18),
 *   withdrawLpAmount: Decimal.ZERO,
 *   tokenAAmount: Decimal.parse('50', 18),
 *   tokenBAmount: Decimal.parse('50', 18),
 *   slippage: Decimal.parse('0.005', 3),
 *   userPosition: { ... },
 *   marketState: { ... },
 *   computeLpOutput: info._computeLpOutput,
 * });
 * ```
 */
export function simulateSmartMarketRepay(
    params: SimulateSmartMarketRepayParams,
): SmartMarketRepaySimulationResult {
    const {
        swapType,
        repayAmount,
        withdrawLpAmount,
        tokenAAmount,
        tokenBAmount,
        slippage,
        isRepayAll = false,
        isWithdrawAll = false,
        userPosition,
        marketState,
        computeLpOutput,
        computeBorrowRate,
    } = params;
    const { collateral, borrowed: currentBorrowed } = userPosition;
    const {
        totalSupply,
        totalBorrow,
        LLTV,
        priceRate,
        lpDecimals,
        lpBalances,
        totalLp,
    } = marketState;

    const isFixedOrLp = swapType === "fixed" || swapType === "lp";
    const isLpWithdraw = swapType === "lp" && withdrawLpAmount.gt(Decimal.ZERO);

    let aOutput: Decimal;
    let bOutput: Decimal;
    let lpOutput: Decimal;

    if (isLpWithdraw) {
        lpOutput = collateral.sub(withdrawLpAmount);
        const breakdown = breakdownLp(lpOutput, lpBalances, totalLp);
        aOutput = breakdown.aOutput;
        bOutput = breakdown.bOutput;
    } else if (isWithdrawAll) {
        lpOutput = Decimal.ZERO;
        aOutput = Decimal.ZERO;
        bOutput = Decimal.ZERO;
    } else if (computeLpOutput) {
        const result = computeLpOutput(
            [tokenAAmount.negated(), tokenBAmount.negated()],
            collateral,
        );
        aOutput = result.aOutput;
        bOutput = result.bOutput;
        lpOutput = result.lpOutput;
    } else {
        // Fallback
        lpOutput = collateral;
        const breakdown = breakdownLp(lpOutput, lpBalances, totalLp);
        aOutput = breakdown.aOutput;
        bOutput = breakdown.bOutput;
    }

    // Calculate LTV (with repay as negative borrow)
    const LTV = computeSmartLTV(
        currentBorrowed.sub(repayAmount),
        lpOutput,
        priceRate,
    );

    // Calculate withdrawable
    const withdrawable = computeSmartWithdrawable(
        collateral,
        currentBorrowed,
        isRepayAll ? currentBorrowed : repayAmount,
        LLTV,
        priceRate,
        lpDecimals,
        lpBalances,
        totalLp,
        slippage,
        isFixedOrLp,
    );

    // Calculate borrowed after repay
    const borrowed = isRepayAll ? Decimal.ZERO : currentBorrowed.sub(repayAmount);

    // Check exceed error
    let exceedError = false;
    if (isFixedOrLp) {
        exceedError =
            LTV.gt(LLTV.mul(SMART_THRESHOLD)) || lpOutput.lt(Decimal.ZERO);
    } else {
        // Consider slippage for variable mode
        if (computeLpOutput) {
            const lpOutputWithSlippage = computeLpOutput(
                [tokenAAmount.negated(), tokenBAmount.negated()],
                collateral,
                slippage,
            ).lpOutput;
            const LTVWithSlippage = computeSmartLTV(
                currentBorrowed.sub(repayAmount),
                lpOutputWithSlippage,
                priceRate,
            );
            // 981/1000 = 0.981 (98.1%)
            exceedError =
                LTVWithSlippage.gt(LLTV.mul(981n, 3)) || lpOutput.lt(Decimal.ZERO);
        } else {
            exceedError =
                LTV.gt(LLTV.mul(SMART_THRESHOLD)) || lpOutput.lt(Decimal.ZERO);
        }
    }

    const result: SmartMarketRepaySimulationResult = {
        lpTokenA: aOutput,
        lpTokenB: bOutput,
        borrowed,
        LTV: LTV.lt(Decimal.ZERO) ? Decimal.ZERO : LTV,
        withdrawable,
        exceedError,
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
