import type { Decimal } from '../utils/decimal';

/**
 * Fixed term loan position
 */
export interface FixedLoanPosition {
    posId: bigint;
    principal: bigint;
    apr: bigint;
    start: bigint;
    end: bigint;
    lastRepaidTime: bigint;
    interestRepaid: bigint;
    principalRepaid: bigint;
}

/**
 * Dynamic loan position
 */
export interface DynamicLoanPosition {
    principal: bigint;
    normalizedDebt?: bigint;
    rate: bigint;
}

/**
 * Repayment information
 */
export interface RepayInfo {
    posId?: bigint;
    amount: string;
    isDynamic?: boolean;
    penalty?: string;
}

/**
 * Dynamic loan repayment result
 */
export interface DynamicLoanRepaymentResult {
    totalRepay: Decimal;
    principal: Decimal;
    interest: Decimal;
    rate: Decimal;
}

/**
 * Fixed loan repayment result
 */
export interface FixedLoanRepaymentResult {
    totalRepay: Decimal;
    principal: bigint;
    interest: bigint;
    penalty: bigint;
}

/**
 * Constant for dynamic position ID
 */
export const DYNAMIC_POS_ID = 'dynamic' as const;
