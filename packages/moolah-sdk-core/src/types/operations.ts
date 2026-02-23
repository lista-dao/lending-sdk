
export type OperationExecutor = () => Promise<{
    (options?: { confirmations?: number; timeout?: number }): Promise<unknown>;
    hash: `0x${string}`;
}>;

/**
 * Built supply operation with approve steps
 */
export interface BuiltSupplyOperation {
    approves: OperationExecutor[];
    supply: OperationExecutor;
}

/**
 * Built borrow operation (no approve needed for borrow)
 */
export interface BuiltBorrowOperation {
    borrow: OperationExecutor;
}

/**
 * Built repay operation with approve steps
 */
export interface BuiltRepayOperation {
    approves: OperationExecutor[];
    repay: OperationExecutor;
}

/**
 * Built withdraw operation (no approve needed for withdraw)
 */
export interface BuiltWithdrawOperation {
    withdraw: OperationExecutor;
}

/**
 * Built vault deposit operation with approve steps
 */
export interface BuiltVaultDepositOperation {
    approves: OperationExecutor[];
    deposit: OperationExecutor;
}

/**
 * Built vault withdraw operation (no approve needed for withdraw)
 */
export interface BuiltVaultWithdrawOperation {
    withdraw: OperationExecutor;
}

/**
 * Built smart supply (LP mode) operation with approve steps
 */
export interface BuiltSmartSupplyLpOperation {
    approves: OperationExecutor[];
    supplyLp: OperationExecutor;
}

/**
 * Built smart supply (collateral mode) operation with approve steps
 */
export interface BuiltSmartSupplyCollateralOperation {
    approves: OperationExecutor[];
    supplyCollateral: OperationExecutor;
}

/**
 * Built smart repay operation with approve steps
 */
export interface BuiltSmartRepayOperation {
    approves: OperationExecutor[];
    repay: OperationExecutor;
}

/**
 * Built broker borrow operation (no approve needed)
 */
export interface BuiltBrokerBorrowOperation {
    borrow: OperationExecutor;
}

/**
 * Built broker repay operation with approve steps
 */
export interface BuiltBrokerRepayOperation {
    approves: OperationExecutor[];
    repay: OperationExecutor;
}
