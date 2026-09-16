/**
 * Type-level assertions. Compiled by `check:types`, never executed.
 *
 * The contracts require exactly one of assets/shares to be non-zero. These
 * assert that the invalid combinations do not typecheck, so the mistake is
 * caught by the compiler rather than by a reverted transaction.
 */
import type {
  BuildRepayParams,
  BuildVaultWithdrawParams,
  BuildSmartRepayParams,
  BuildMoolahSupplyParams,
  BuildLiquidateParams,
} from "../types.js";

const ADDRESS = "0x0000000000000000000000000000000000000001" as const;
const MARKET = "0x0000000000000000000000000000000000000002" as const;
const base = { chainId: 56, marketId: MARKET, walletAddress: ADDRESS } as const;

// Valid: exactly one amount.
const repayByAssets: BuildRepayParams = { ...base, assets: 1n };
const repayByShares: BuildRepayParams = { ...base, shares: 1n };
const repayEverything: BuildRepayParams = { ...base, repayAll: true };
void repayByAssets;
void repayByShares;
void repayEverything;

// @ts-expect-error both amounts: the contract reverts on this
const repayBoth: BuildRepayParams = { ...base, assets: 1n, shares: 1n };
void repayBoth;

// @ts-expect-error neither amount, and not a repay-all
const repayNeither: BuildRepayParams = { ...base };
void repayNeither;

// @ts-expect-error repayAll alongside an explicit amount
const repayAllAndAmount: BuildRepayParams = {
  ...base,
  repayAll: true,
  assets: 1n,
};
void repayAllAndAmount;

const vaultBase = {
  chainId: 56,
  vaultAddress: ADDRESS,
  walletAddress: ADDRESS,
};
const withdrawByAssets: BuildVaultWithdrawParams = {
  ...vaultBase,
  assets: 1n,
};
void withdrawByAssets;

// @ts-expect-error both amounts
const withdrawBoth: BuildVaultWithdrawParams = {
  ...vaultBase,
  assets: 1n,
  shares: 1n,
};
void withdrawBoth;

const smartRepay: BuildSmartRepayParams = { ...base, shares: 1n };
void smartRepay;

// @ts-expect-error both amounts
const smartRepayBoth: BuildSmartRepayParams = {
  ...base,
  assets: 1n,
  shares: 1n,
};
void smartRepayBoth;

const supplyByAssets: BuildMoolahSupplyParams = { ...base, assets: 1n };
void supplyByAssets;

// @ts-expect-error both amounts
const supplyBoth: BuildMoolahSupplyParams = { ...base, assets: 1n, shares: 1n };
void supplyBoth;

const liquidateBase = {
  chainId: 56,
  marketId: "0x00" as `0x${string}`,
  borrower: ADDRESS,
  walletAddress: ADDRESS,
  loanToken: ADDRESS,
  maxRepayAmount: 1n,
};
const liquidateBySeized: BuildLiquidateParams = {
  ...liquidateBase,
  seizedAssets: 1n,
};
void liquidateBySeized;

// @ts-expect-error both sides of the liquidation fixed at once
const liquidateBoth: BuildLiquidateParams = {
  ...liquidateBase,
  seizedAssets: 1n,
  repaidShares: 1n,
};
void liquidateBoth;
