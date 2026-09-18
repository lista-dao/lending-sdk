import type { Address, PublicClient } from "viem";
import { zeroAddress } from "viem";
import {
  MOOLAH_ABI,
  NATIVE_PROVIDER_ABI,
  SMART_PROVIDER_ABI,
  getContractAddress,
  type NetworkName,
  type WriteSmartMarketConfig,
  type SmartMarketUserData,
} from "@lista-dao/moolah-sdk-core";
import type { ChainId, StepParam } from "../types.js";
import { buildCallParams, finalizeSteps, type DraftStep } from "../utils.js";
import {
  buildApproveSteps,
  buildClearAllowanceStep,
  priorAllowanceOf,
} from "./approve.js";
import { withResolvedProviders } from "../resolveProviders.js";
import { resolveAssetsOrShares } from "./market.js";
import { sharesToAssetCeiling } from "./sharePricing.js";

export interface SmartBuilderDeps {
  publicClient: PublicClient;
  network: NetworkName;
}

function buildSmartMarketParams(config: WriteSmartMarketConfig) {
  return {
    loanToken: config.params.loanToken,
    collateralToken: config.params.collateralToken,
    oracle: config.params.oracle,
    irm: config.params.irm,
    lltv: config.params.lltv,
  };
}

export async function buildSmartSupplyDexLpSteps(
  params: {
    chainId: ChainId;
    lpAmount: bigint;
    walletAddress: Address;
    onBehalf?: Address;
  },
  smartConfig: WriteSmartMarketConfig,
  deps: SmartBuilderDeps,
): Promise<StepParam[]> {
  // The provider is the approval spender and the call target here too. The
  // market builders resolved it and these did not, which made the guarantee in
  // MIGRATION #19 false for every Smart path.
  smartConfig = await withResolvedProviders(
    smartConfig,
    deps.publicClient,
    deps.network,
  );

  const { publicClient, network } = deps;
  const steps: DraftStep[] = [];

  const approveSteps = await buildApproveSteps(
    {
      chainId: params.chainId,
      owner: params.walletAddress,
      token: smartConfig.lpInfo.address,
      spender: smartConfig.collateralProvider,
      amount: params.lpAmount,
    },
    publicClient,
    network,
  );
  steps.push(...approveSteps);

  steps.push({
    step: "supplySmartDexLp",
    params: buildCallParams({
      to: smartConfig.collateralProvider,
      abi: SMART_PROVIDER_ABI,
      functionName: "supplyDexLp",
      args: [
        buildSmartMarketParams(smartConfig),
        params.onBehalf ?? params.walletAddress,
        params.lpAmount,
      ],
      chainId: params.chainId,
    }),
  });

  return finalizeSteps(steps);
}

export async function buildSmartSupplyCollateralSteps(
  params: {
    chainId: ChainId;
    tokenAAmount: bigint;
    tokenBAmount: bigint;
    minLpAmount: bigint;
    walletAddress: Address;
    onBehalf?: Address;
  },
  smartConfig: WriteSmartMarketConfig,
  deps: SmartBuilderDeps,
): Promise<StepParam[]> {
  // The provider is the approval spender and the call target here too. The
  // market builders resolved it and these did not, which made the guarantee in
  // MIGRATION #19 false for every Smart path.
  smartConfig = await withResolvedProviders(
    smartConfig,
    deps.publicClient,
    deps.network,
  );

  const { publicClient, network } = deps;
  const steps: DraftStep[] = [];

  if (!smartConfig.tokenAIsNative) {
    const approveSteps = await buildApproveSteps(
      {
        chainId: params.chainId,
        owner: params.walletAddress,
        token: smartConfig.tokenAInfo.address,
        spender: smartConfig.collateralProvider,
        amount: params.tokenAAmount,
      },
      publicClient,
      network,
    );
    steps.push(...approveSteps);
  }

  if (!smartConfig.tokenBIsNative) {
    const approveSteps = await buildApproveSteps(
      {
        chainId: params.chainId,
        owner: params.walletAddress,
        token: smartConfig.tokenBInfo.address,
        spender: smartConfig.collateralProvider,
        amount: params.tokenBAmount,
      },
      publicClient,
      network,
    );
    steps.push(...approveSteps);
  }

  const value = smartConfig.tokenAIsNative
    ? params.tokenAAmount
    : smartConfig.tokenBIsNative
      ? params.tokenBAmount
      : undefined;

  // A value-bearing step to the zero address succeeds and burns the funds, so
  // it must be unconstructible however the config arrived — belt and braces
  // with the resolver's own guard.
  if (value !== undefined && smartConfig.collateralProvider === zeroAddress) {
    throw new Error(
      "buildSmartSupplyCollateralSteps: a native pool token with no " +
        "collateral provider — refusing to send value to the zero address",
    );
  }

  steps.push({
    step: "supplySmartCollateral",
    params: buildCallParams({
      to: smartConfig.collateralProvider,
      abi: SMART_PROVIDER_ABI,
      functionName: "supplyCollateral",
      args: [
        buildSmartMarketParams(smartConfig),
        params.onBehalf ?? params.walletAddress,
        params.tokenAAmount,
        params.tokenBAmount,
        params.minLpAmount,
      ],
      value,
      chainId: params.chainId,
    }),
  });

  return finalizeSteps(steps);
}

/**
 * The exits resolve too, and for a sharper reason than the entries do.
 *
 * A wrong provider on the way *in* fails loudly: the approval and the call go
 * to the same dead address and nothing moves. A wrong provider on the way
 * *out* is how a position gets stranded — the collateral sits in the provider
 * the entry resolved to, and the exit asks a different contract to release it.
 * Resolving one side and not the other is strictly worse than resolving
 * neither, because it is the combination that produces a position you can
 * enter and cannot leave.
 */
export async function buildSmartWithdrawDexLpSteps(
  params: {
    chainId: ChainId;
    lpAmount: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
  },
  smartConfig: WriteSmartMarketConfig,
  deps: SmartBuilderDeps,
): Promise<StepParam[]> {
  smartConfig = await withResolvedProviders(
    smartConfig,
    deps.publicClient,
    deps.network,
  );

  return finalizeSteps([
    {
      step: "withdrawSmartDexLp",
      params: buildCallParams({
        to: smartConfig.collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "withdrawDexLp",
        args: [
          buildSmartMarketParams(smartConfig),
          params.lpAmount,
          params.onBehalf ?? params.walletAddress,
          params.receiver ?? params.walletAddress,
        ],
        chainId: params.chainId,
      }),
    },
  ]);
}

/** Resolves its provider — see {@link buildSmartWithdrawDexLpSteps}. */
export async function buildSmartWithdrawCollateralSteps(
  params: {
    chainId: ChainId;
    tokenAAmount: bigint;
    tokenBAmount: bigint;
    maxLpBurn: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
  },
  smartConfig: WriteSmartMarketConfig,
  deps: SmartBuilderDeps,
): Promise<StepParam[]> {
  smartConfig = await withResolvedProviders(
    smartConfig,
    deps.publicClient,
    deps.network,
  );

  return finalizeSteps([
    {
      step: "withdrawSmartCollateral",
      params: buildCallParams({
        to: smartConfig.collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "withdrawCollateralImbalance",
        args: [
          buildSmartMarketParams(smartConfig),
          params.tokenAAmount,
          params.tokenBAmount,
          params.maxLpBurn,
          params.onBehalf ?? params.walletAddress,
          params.receiver ?? params.walletAddress,
        ],
        chainId: params.chainId,
      }),
    },
  ]);
}

/** Resolves its provider — see {@link buildSmartWithdrawDexLpSteps}. */
export async function buildSmartWithdrawCollateralFixedSteps(
  params: {
    chainId: ChainId;
    lpAmount: bigint;
    minTokenAAmount: bigint;
    minTokenBAmount: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
  },
  smartConfig: WriteSmartMarketConfig,
  deps: SmartBuilderDeps,
): Promise<StepParam[]> {
  smartConfig = await withResolvedProviders(
    smartConfig,
    deps.publicClient,
    deps.network,
  );

  return finalizeSteps([
    {
      step: "withdrawSmartCollateralFixed",
      params: buildCallParams({
        to: smartConfig.collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "withdrawCollateral",
        args: [
          buildSmartMarketParams(smartConfig),
          params.lpAmount,
          params.minTokenAAmount,
          params.minTokenBAmount,
          params.onBehalf ?? params.walletAddress,
          params.receiver ?? params.walletAddress,
        ],
        chainId: params.chainId,
      }),
    },
  ]);
}

export async function buildSmartRepaySteps(
  params: {
    chainId: ChainId;
    assets?: bigint;
    shares?: bigint;
    repayAll?: boolean;
    walletAddress: Address;
    onBehalf?: Address;
    nativeValue?: bigint;
    /** Keep the leftover allowance instead of putting it back. */
    keepAllowance?: boolean;
  },
  smartConfig: WriteSmartMarketConfig,
  deps: SmartBuilderDeps,
  userData?: SmartMarketUserData,
): Promise<StepParam[]> {
  const { publicClient, network } = deps;

  let assets = params.assets ?? 0n;
  let shares = params.shares ?? 0n;
  let nativeValue = params.nativeValue;
  let approvedHere = false;
  let priorAllowance = 0n;
  let clearSpender: Address | null = null;
  let approveAmount = assets;

  if (params.repayAll) {
    // Without userData there is nothing to size the repayment from. Falling
    // through emitted a well-formed step with assets=0 and shares=0, which
    // always reverts and gives the caller no signal that it will.
    if (!userData) {
      throw new Error(
        "buildSmartRepaySteps: repayAll requires userData to size the repayment",
      );
    }
    const repayAmount = userData
      ._getExtraRepayAmount()
      .roundDown(userData.decimals.l).numerator;
    assets = 0n;
    shares = userData.borrowShares;
    approveAmount = repayAmount;
  } else {
    // Exactly one of the two must be non-zero; `./builders` is a public
    // subpath export, so the guard cannot live only in the params union.
    [assets, shares] = resolveAssetsOrShares(params);
    if (shares > 0n) {
      // Same reason as the plain market repay: shares say how much debt to
      // clear, not how many tokens it costs, and the provider still pulls
      // tokens. Sizing the approval from `assets` — zero on this path — emitted
      // no approve step at all and reverted inside `transferFrom`.
      approveAmount = await sharesToAssetCeiling(
        shares,
        smartConfig,
        publicClient,
        network,
      );
    }
  }

  // Resolved after the argument checks above, so a malformed call still fails
  // on its arguments rather than on the network.
  smartConfig = await withResolvedProviders(smartConfig, publicClient, network);

  // Sized off the resolved flag, not the caller-supplied one — doing this
  // before resolution let a stale or forged `loanIsNative` pick a `value`
  // that no longer matched the branch resolution actually takes.
  // `approveAmount` already equals `assets` when neither branch above touched
  // it, so this collapses to one check: honour an explicit caller override in
  // every path, not just the shares one.
  if (smartConfig.loanIsNative && nativeValue === undefined) {
    nativeValue = approveAmount;
  }

  const steps: DraftStep[] = [];

  if (!smartConfig.loanIsNative) {
    const contractAddress =
      smartConfig.loanProvider !== zeroAddress
        ? smartConfig.loanProvider
        : getContractAddress(network, "moolah");

    const approveSteps = await buildApproveSteps(
      {
        chainId: params.chainId,
        owner: params.walletAddress,
        token: smartConfig.loanInfo.address,
        spender: contractAddress,
        amount: approveAmount,
      },
      publicClient,
      network,
    );
    approvedHere = approveSteps.length > 0;
    priorAllowance = priorAllowanceOf(approveSteps);
    clearSpender = contractAddress;
    steps.push(...approveSteps);
  }

  if (smartConfig.loanIsNative) {
    steps.push({
      step: "repaySmartMarket",
      params: buildCallParams({
        to: smartConfig.loanProvider,
        abi: NATIVE_PROVIDER_ABI,
        functionName: "repay",
        args: [
          buildSmartMarketParams(smartConfig),
          assets,
          shares,
          params.onBehalf ?? params.walletAddress,
          "0x",
        ],
        value: nativeValue ?? assets,
        chainId: params.chainId,
      }),
    });
    return finalizeSteps(steps);
  }

  const contractAddress =
    smartConfig.loanProvider !== zeroAddress
      ? smartConfig.loanProvider
      : getContractAddress(network, "moolah");

  steps.push({
    step: "repaySmartMarket",
    params: buildCallParams({
      to: contractAddress,
      abi: MOOLAH_ABI,
      functionName: "repay",
      args: [
        buildSmartMarketParams(smartConfig),
        assets,
        shares,
        params.onBehalf ?? params.walletAddress,
        "0x",
      ],
      chainId: params.chainId,
    }),
  });

  // Over-approved for the same reason as every other repay here — the debt
  // moves between building and inclusion — so the remainder goes back.
  if (approvedHere && !params.keepAllowance && clearSpender) {
    steps.push(
      ...buildClearAllowanceStep({
        chainId: params.chainId,
        token: smartConfig.loanInfo.address,
        spender: clearSpender,
        restoreTo: priorAllowance,
        network: network,
      }),
    );
  }

  return finalizeSteps(steps);
}

/**
 * Withdraw LP collateral as a single one of the pool's two tokens.
 *
 * The two-token withdrawals return both sides in a fixed or custom ratio. This
 * one removes liquidity single-sided, so the caller takes the pool's imbalance
 * cost in exchange for not receiving a token they do not want.
 */
/** Resolves its provider — see {@link buildSmartWithdrawDexLpSteps}. */
export async function buildSmartWithdrawCollateralOneCoinSteps(
  params: {
    chainId: ChainId;
    collateralAmount: bigint;
    tokenIndex: 0 | 1;
    minTokenAmount: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
  },
  smartConfig: WriteSmartMarketConfig,
  deps: SmartBuilderDeps,
): Promise<StepParam[]> {
  if (params.collateralAmount <= 0n) {
    throw new Error(
      "buildSmartWithdrawCollateralOneCoinSteps: collateralAmount must be greater than zero",
    );
  }
  if (params.tokenIndex !== 0 && params.tokenIndex !== 1) {
    throw new Error(
      "buildSmartWithdrawCollateralOneCoinSteps: tokenIndex must be 0 or 1",
    );
  }

  smartConfig = await withResolvedProviders(
    smartConfig,
    deps.publicClient,
    deps.network,
  );

  return finalizeSteps([
    {
      step: "withdrawSmartCollateralOneCoin",
      params: buildCallParams({
        to: smartConfig.collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "withdrawCollateralOneCoin",
        args: [
          buildSmartMarketParams(smartConfig),
          params.collateralAmount,
          BigInt(params.tokenIndex),
          params.minTokenAmount,
          params.onBehalf ?? params.walletAddress,
          params.receiver ?? params.walletAddress,
        ],
        chainId: params.chainId,
      }),
      meta: { amount: params.collateralAmount },
    },
  ]);
}

/**
 * Redeem LP collateral the caller already holds into the underlying pair.
 *
 * This is the liquidator's exit from a Smart Lending seizure: the LP is burned
 * from `msg.sender`, so no approval applies and no position is touched. The
 * provider is still resolved — it is the contract that holds the redemption,
 * and a liquidator sent to the wrong one burns nothing but gets nothing back.
 */
export async function buildRedeemSmartLpCollateralSteps(
  params: {
    chainId: ChainId;
    lpAmount: bigint;
    minAmount0: bigint;
    minAmount1: bigint;
  },
  smartConfig: WriteSmartMarketConfig,
  deps: SmartBuilderDeps,
): Promise<StepParam[]> {
  if (params.lpAmount <= 0n) {
    throw new Error(
      "buildRedeemSmartLpCollateralSteps: lpAmount must be greater than zero",
    );
  }

  smartConfig = await withResolvedProviders(
    smartConfig,
    deps.publicClient,
    deps.network,
  );

  return finalizeSteps([
    {
      step: "redeemSmartLpCollateral",
      params: buildCallParams({
        to: smartConfig.collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "redeemLpCollateral",
        args: [params.lpAmount, params.minAmount0, params.minAmount1],
        chainId: params.chainId,
      }),
      meta: { amount: params.lpAmount },
    },
  ]);
}
