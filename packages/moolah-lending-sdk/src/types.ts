import type { Abi, Address, PublicClient } from "viem";
import type {
  WriteMarketConfig,
  WriteSmartMarketConfig,
  VaultInfo,
  VaultUserData,
  MarketExtraInfo,
  MarketUserData,
  SmartMarketUserData,
  MarketBorrowSimulationResult,
  MarketRepaySimulationResult,
} from "@lista-dao/moolah-sdk-core";

export type ChainId = number | string;

export interface SdkTransportConfig {
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}

export interface MoolahSDKConfig {
  /**
   * RPC endpoints per chain id, for chains the SDK should build its own client
   * for. One URL or several — several become a viem `fallback`.
   *
   * Optional, because `publicClients` is the other way to answer the same
   * question, and a caller who supplies a client for every chain they touch
   * never reaches this. Supply one of the two: a config with neither is
   * rejected at construction rather than on the first call.
   */
  rpcUrls?: Record<string, string | string[]>;
  /**
   * REST host override.
   *
   * Production REST host override. Omit it to use the Lista production API.
   */
  apiBaseUrl?: string;
  transport?: SdkTransportConfig;
  transportByChainId?: Record<string, SdkTransportConfig>;
  /**
   * Bring your own viem clients. Takes precedence over `rpcUrls` for any chain
   * id present here — the SDK will not build a second client for it, and the
   * transport settings above do not apply to it.
   */
  publicClients?: Record<string, PublicClient>;
}

export interface ContractCallParams {
  to: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  chainId: ChainId;
  /** Encoded calldata for convenience */
  data: `0x${string}`;
}

export type StepName =
  | "approve"
  | "supply"
  | "borrow"
  | "repay"
  | "withdraw"
  | "depositVault"
  | "withdrawVault"
  | "supplySmartDexLp"
  | "supplySmartCollateral"
  | "withdrawSmartDexLp"
  | "withdrawSmartCollateral"
  | "withdrawSmartCollateralFixed"
  | "withdrawSmartCollateralOneCoin"
  | "redeemSmartLpCollateral"
  | "repaySmartMarket"
  | "brokerBorrow"
  | "brokerRepay"
  | "brokerRepayAll"
  | "brokerRefinanceMatured"
  | "convertDynamicToFixed"
  | "setAuthorization"
  | "revokeAuthorization"
  | "migrateToFixedTerm"
  | "liquidate"
  | "moolahSupply"
  | "moolahWithdraw"
  | "vaultMint"
  | "flashLoan";

/**
 * Chain state a step was derived from.
 *
 * Builders that read the chain to decide whether a step is needed record what
 * they saw. The read happens when the steps are built; the transaction lands
 * later, so the caller — not the SDK — owns the decision to rebuild if the
 * gap matters.
 */
export interface StepObservedState {
  /** Block the backing reads were taken at, when the builder captured it. */
  atBlock?: bigint;
  /** Result of `Moolah.isAuthorized` for the step's target. */
  isAuthorized?: boolean;
  /** ERC-20 allowance observed for the step's token/spender pair. */
  allowance?: bigint;
}

/**
 * One transaction in an ordered sequence.
 *
 * The array returned by a builder is strictly ordered: execute steps in
 * ascending `index`, waiting for each to be mined before sending the next.
 * Reordering or skipping is undefined behaviour.
 *
 * Executing only a prefix is always possible — the caller owns the wallet, so
 * the SDK cannot make a sequence atomic. Any step that leaves durable state
 * behind when the rest of the sequence is abandoned carries `reversalSteps`
 * describing how to undo it.
 */
export interface StepParam {
  step: StepName;
  /** Position in the sequence, from 0. Execute in ascending order. */
  index: number;
  params: ContractCallParams;
  meta?: {
    token?: Address;
    spender?: Address;
    amount?: bigint;
    reset?: boolean;
    /** Why this step is present, when its presence was decided by a read. */
    precondition?: string;
    /** The chain state the builder observed when it emitted this step. */
    observedState?: StepObservedState;
    /** How to undo the durable state this step creates. */
    reversalSteps?: StepParam[];
  };
}

export interface BuildSupplyParams {
  chainId: ChainId;
  marketId: Address;
  assets: bigint;
  walletAddress: Address;
  onBehalf?: Address;
  marketInfo?: WriteMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
}

export interface BuildBorrowParams {
  chainId: ChainId;
  marketId: Address;
  assets: bigint;
  walletAddress: Address;
  onBehalf?: Address;
  receiver?: Address;
  marketInfo?: WriteMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
}

/**
 * How much to repay: everything, a stated amount, or a share count.
 *
 * The contract requires exactly one of assets/shares to be non-zero, so the
 * union makes the invalid combinations unrepresentable rather than leaving
 * them to revert on-chain.
 */
export type RepayAmount =
  | { repayAll: true; assets?: undefined; shares?: undefined }
  | { assets: bigint; shares?: undefined; repayAll?: false }
  | { shares: bigint; assets?: undefined; repayAll?: false };

export type BuildRepayParams = {
  chainId: ChainId;
  marketId: Address;
  walletAddress: Address;
  onBehalf?: Address;
  /** For native repay-all, explicit value override */
  nativeValue?: bigint;
  marketInfo?: WriteMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
  userData?: MarketUserData;
  /** Keep the leftover allowance instead of putting it back. */
  keepAllowance?: boolean;
} & RepayAmount;

export interface BuildWithdrawParams {
  chainId: ChainId;
  marketId: Address;
  assets?: bigint;
  withdrawAll?: boolean;
  walletAddress: Address;
  onBehalf?: Address;
  receiver?: Address;
  marketInfo?: WriteMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
  userData?: MarketUserData;
}

export interface BuildVaultDepositParams {
  chainId: ChainId;
  vaultAddress: Address;
  assets: bigint;
  walletAddress: Address;
  receiver?: Address;
  vaultInfo?: VaultInfo;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
}

/** How much to withdraw: everything, an asset amount, or a share count. */
export type WithdrawAmount =
  | { withdrawAll: true; assets?: undefined; shares?: undefined }
  | { assets: bigint; shares?: undefined; withdrawAll?: false }
  | { shares: bigint; assets?: undefined; withdrawAll?: false };

export type BuildVaultWithdrawParams = {
  chainId: ChainId;
  vaultAddress: Address;
  walletAddress: Address;
  receiver?: Address;
  vaultInfo?: VaultInfo;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
  userData?: VaultUserData;
} & WithdrawAmount;

export interface BuildSmartSupplyDexLpParams {
  chainId: ChainId;
  marketId: Address;
  lpAmount: bigint;
  walletAddress: Address;
  onBehalf?: Address;
  smartConfig?: WriteSmartMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
}

export interface BuildSmartSupplyCollateralParams {
  chainId: ChainId;
  marketId: Address;
  tokenAAmount: bigint;
  tokenBAmount: bigint;
  minLpAmount: bigint;
  walletAddress: Address;
  onBehalf?: Address;
  smartConfig?: WriteSmartMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
}

export interface BuildSmartWithdrawDexLpParams {
  chainId: ChainId;
  marketId: Address;
  lpAmount: bigint;
  walletAddress: Address;
  onBehalf?: Address;
  receiver?: Address;
  smartConfig?: WriteSmartMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
}

export interface BuildSmartWithdrawCollateralParams {
  chainId: ChainId;
  marketId: Address;
  tokenAAmount: bigint;
  tokenBAmount: bigint;
  maxLpBurn: bigint;
  walletAddress: Address;
  onBehalf?: Address;
  receiver?: Address;
  smartConfig?: WriteSmartMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
}

export interface BuildSmartWithdrawCollateralFixedParams {
  chainId: ChainId;
  marketId: Address;
  lpAmount: bigint;
  minTokenAAmount: bigint;
  minTokenBAmount: bigint;
  walletAddress: Address;
  onBehalf?: Address;
  receiver?: Address;
  smartConfig?: WriteSmartMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
}

export type BuildSmartRepayParams = {
  chainId: ChainId;
  marketId: Address;
  walletAddress: Address;
  onBehalf?: Address;
  nativeValue?: bigint;
  smartConfig?: WriteSmartMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
  userData?: SmartMarketUserData;
  /** Keep the leftover allowance instead of putting it back. */
  keepAllowance?: boolean;
} & RepayAmount;

export interface BuildBrokerBorrowParams {
  chainId: ChainId;
  brokerAddress: Address;
  amount: bigint;
  /** Omit to borrow against the flexible (dynamic) leg. */
  termId?: bigint;
  /**
   * Borrow on another account's behalf and/or send the proceeds elsewhere.
   * Both must be given together; they select the four-argument overload, which
   * requires `termId`.
   */
  onBehalf?: Address;
  receiver?: Address;
  /** The market this broker should serve. Supply it and the pair is checked. */
  marketId?: `0x${string}`;
}

/**
 * Amount for a Moolah operation that accepts either assets or shares.
 *
 * The contract requires exactly one of the two to be non-zero. Expressing that
 * as a union makes supplying both a compile error rather than a revert.
 */
export type AssetsOrShares =
  | { assets: bigint; shares?: undefined }
  | { shares: bigint; assets?: undefined };

/** Lend directly to a market, bypassing vaults. */
export type BuildMoolahSupplyParams = {
  chainId: ChainId;
  marketId: Address;
  walletAddress: Address;
  onBehalf?: Address;
  marketInfo?: WriteMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
  /** Keep the leftover allowance instead of putting it back. */
  keepAllowance?: boolean;
} & AssetsOrShares;

/** Withdraw a direct-to-market supply position. */
export type BuildMoolahWithdrawParams = {
  chainId: ChainId;
  marketId: Address;
  walletAddress: Address;
  onBehalf?: Address;
  receiver?: Address;
  marketInfo?: WriteMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
} & AssetsOrShares;

/** Deposit into a vault for an exact number of shares (ERC-4626 `mint`). */
export interface BuildVaultMintParams {
  chainId: ChainId;
  vaultAddress: Address;
  /** Shares to mint. */
  shares: bigint;
  walletAddress: Address;
  receiver?: Address;
  /**
   * Approval ceiling. Omit to size it from `previewMint` plus headroom, which
   * costs one extra read. An allowance is a ceiling, not a payment.
   */
  maxAssets?: bigint;
  /**
   * Override the headroom added to an auto-sized approval, in basis points.
   * Defaults to 100 (1%): an interest-bearing vault reprices every block, so an
   * exact quote is stale by the time the transaction is mined.
   */
  approvalBufferBps?: bigint;
  /** Keep the leftover allowance instead of returning it to zero. */
  keepAllowance?: boolean;
  vaultInfo?: VaultInfo;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
  /**
   * Route mint through the vault's provider. Only meaningful for a
   * non-native provider you have verified implements `mint`.
   */
  allowProviderRouting?: boolean;
}

/**
 * Take a Moolah flash loan.
 *
 * `data` is forwarded to the caller's `onMoolahFlashLoan` callback, so the
 * borrower must be a contract the caller controls.
 */
export interface BuildFlashLoanParams {
  chainId: ChainId;
  token: Address;
  assets: bigint;
  data: `0x${string}`;
}

/** Grant or withdraw permission for a contract to act on your positions. */
export interface BuildAuthorizationParams {
  chainId: ChainId;
  /** Contract being authorized. Usually the PositionManager. */
  authorized: Address;
}

/** How much debt a migration moves: all of it, or a stated amount. */
export type MigrationDebtAmount =
  | { borrowShares: bigint; borrowAmount?: undefined }
  | { borrowAmount: bigint; borrowShares?: undefined };

/** Move a variable-rate position into a fixed-term market. */
export type BuildMigrateToFixedTermParams = {
  chainId: ChainId;
  /** Variable-rate market to migrate out of. */
  outMarketId: Address;
  /** Fixed-term market to migrate into. */
  inMarketId: Address;
  collateralAmount: bigint;
  termId: bigint;
  walletAddress: Address;
  outMarket?: WriteMarketConfig;
  inMarket?: WriteMarketConfig;
} & MigrationDebtAmount;

/** Which side of a liquidation the caller fixes. */
export type SeizedOrRepaid =
  | { seizedAssets: bigint; repaidShares?: undefined }
  | { repaidShares: bigint; seizedAssets?: undefined };

/** Liquidate an unhealthy position through the public liquidator. */
export type BuildLiquidateParams = {
  chainId: ChainId;
  marketId: `0x${string}`;
  borrower: Address;
  walletAddress: Address;
  /** Loan token pulled from the caller to repay the debt. */
  loanToken: Address;
  /**
   * Ceiling for the approval. The amount owed moves with the oracle between
   * building and inclusion, so pass headroom.
   */
  maxRepayAmount: bigint;
  /**
   * Build the call even though the market is not on the public liquidator's
   * allowlist. Without this the builder refuses, because the call would revert
   * with `NotWhitelisted()`.
   */
  allowUnlistedMarket?: boolean;
  /** Keep the leftover allowance instead of returning it to zero. */
  keepAllowance?: boolean;
} & SeizedOrRepaid;

/** Quote the loan-token outlay for a liquidation. */
export type QuoteLiquidationCostParams = {
  chainId: ChainId;
  marketId: `0x${string}`;
} & SeizedOrRepaid;

/** Withdraw LP collateral as a single one of the pool's two tokens. */
export interface BuildSmartWithdrawCollateralOneCoinParams {
  chainId: ChainId;
  marketId: Address;
  /** Amount of LP collateral to burn. */
  collateralAmount: bigint;
  /** Which pool token to receive: 0 or 1. */
  tokenIndex: 0 | 1;
  /** Slippage floor on the chosen token. */
  minTokenAmount: bigint;
  walletAddress: Address;
  onBehalf?: Address;
  receiver?: Address;
  smartConfig?: WriteSmartMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
}

/**
 * Redeem seized LP collateral into its underlying pair.
 *
 * The liquidator side of a Smart Lending liquidation: burns LP the caller
 * already holds and returns both pool tokens.
 */
export interface BuildRedeemSmartLpCollateralParams {
  chainId: ChainId;
  marketId: Address;
  lpAmount: bigint;
  minAmount0: bigint;
  minAmount1: bigint;
  smartConfig?: WriteSmartMarketConfig;
  /**
   * Skip the on-chain check on a supplied config. Only for callers who
   * resolved it themselves and are sure of the source — the config is where
   * the approval spender comes from.
   */
  trustedConfig?: boolean;
}

/** Repay the caller's entire debt with this broker, fixed legs included. */
export interface BuildBrokerRepayAllParams {
  chainId: ChainId;
  brokerAddress: Address;
  onBehalf: Address;
  /**
   * Upper bound used for the allowance check and, for a native loan token, for
   * the value sent. Debt accrues between building and sending, so pass a
   * figure with headroom; the contract refunds any excess.
   */
  maxRepayAmount: bigint;
  /** Omit for a native loan token — no approval applies. */
  loanToken?: Address;
  walletAddress?: Address;
  /** Set when the loan token is the chain's native currency. */
  isNativeLoanToken?: boolean;
  /** Keep the leftover allowance instead of returning it to zero. */
  keepAllowance?: boolean;
  /** The market being repaid. Supply it and the broker is checked against it. */
  marketId?: `0x${string}`;
}

/** Roll matured fixed-term positions into fresh terms. */
export interface BuildBrokerRefinanceMaturedParams {
  chainId: ChainId;
  brokerAddress: Address;
  user: Address;
  /** Position ids to refinance. Must be non-empty. */
  positionIds: bigint[];
  /** The market this broker should serve. Supply it and the pair is checked. */
  marketId?: `0x${string}`;
}

/** Move part of the flexible leg into a fixed term, inside one broker. */
export interface BuildConvertDynamicToFixedParams {
  chainId: ChainId;
  brokerAddress: Address;
  amount: bigint;
  termId: bigint;
  /** The market this broker should serve. Supply it and the pair is checked. */
  marketId?: `0x${string}`;
}

export interface BuildBrokerRepayParams {
  chainId: ChainId;
  brokerAddress: Address;
  amount: bigint;
  posId?: bigint;
  onBehalf?: Address;
  /** Optional loan token address for allowance checks */
  loanToken?: Address;
  walletAddress?: Address;
  /** Keep the leftover allowance instead of putting it back. */
  keepAllowance?: boolean;
  /** The market being repaid. Supply it and the broker is checked against it. */
  marketId?: `0x${string}`;
}

export interface MarketRuntimeData {
  marketExtraInfo: MarketExtraInfo;
  marketInfo: WriteMarketConfig;
  userData: MarketUserData;
}

export interface SimulateBorrowPositionParams {
  chainId: ChainId;
  marketId: Address;
  walletAddress: Address;
  supplyAssets?: bigint;
  borrowAssets?: bigint;
  marketExtraInfo?: MarketExtraInfo;
  userData?: MarketUserData;
}

export interface SimulateBorrowPositionResult {
  marketExtraInfo: MarketExtraInfo;
  userData: MarketUserData;
  simulation: MarketBorrowSimulationResult;
}

export interface SimulateRepayPositionParams {
  chainId: ChainId;
  marketId: Address;
  walletAddress: Address;
  repayAssets?: bigint;
  withdrawAssets?: bigint;
  repayAll?: boolean;
  marketExtraInfo?: MarketExtraInfo;
  userData?: MarketUserData;
}

export interface SimulateRepayPositionResult {
  marketExtraInfo: MarketExtraInfo;
  userData: MarketUserData;
  simulation: MarketRepaySimulationResult;
}
