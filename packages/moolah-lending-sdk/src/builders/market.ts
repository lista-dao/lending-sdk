import type { Address, PublicClient } from "viem";
import { zeroAddress } from "viem";
import {
  MOOLAH_ABI,
  NATIVE_PROVIDER_ABI,
  getContractAddress,
  getContractAddressOptional,
  type NetworkName,
  type WriteMarketConfig,
  type MarketUserData,
} from "@lista-dao/moolah-sdk-core";
import type { ChainId, StepParam } from "../types.js";
import { buildCallParams, finalizeSteps, type DraftStep } from "../utils.js";
import {
  buildApproveSteps,
  buildClearAllowanceStep,
  priorAllowanceOf,
} from "./approve.js";
import { withResolvedProviders } from "../resolveProviders.js";
import {
  sharesToAssetCeiling,
  supplySharesToAssetCeiling,
} from "./sharePricing.js";

export interface MarketBuilderDeps {
  publicClient: PublicClient;
  network: NetworkName;
}

/**
 * Resolve an assets-or-shares pair into the contract's argument order.
 *
 * The union makes supplying both a compile error, but the package ships
 * JavaScript too, so the runtime guard is what protects a JS caller from the
 * contract's `exactlyOneZero` revert.
 */
export function resolveAssetsOrShares(params: {
  assets?: bigint;
  shares?: bigint;
}): [bigint, bigint] {
  const assets = params.assets ?? 0n;
  const shares = params.shares ?? 0n;
  if ((assets === 0n) === (shares === 0n)) {
    throw new Error("exactly one of `assets` or `shares` must be non-zero");
  }
  return [assets, shares];
}

export async function buildSupplySteps(
  params: {
    chainId: ChainId;
    assets: bigint;
    walletAddress: Address;
    onBehalf?: Address;
  },
  marketInfo: WriteMarketConfig,
  deps: MarketBuilderDeps,
): Promise<StepParam[]> {
  const { publicClient, network } = deps;
  // The provider is the approval spender and the call target. Take the chain's
  // word for it rather than the config's — see withResolvedProviders.
  marketInfo = await withResolvedProviders(marketInfo, publicClient, network);
  const onBehalf = params.onBehalf ?? params.walletAddress;
  const data = "0x" as `0x${string}`;
  const steps: DraftStep[] = [];

  if (!marketInfo.collateralIsNative) {
    const contractAddress =
      marketInfo.collateralProvider !== zeroAddress
        ? marketInfo.collateralProvider
        : getContractAddress(network, "moolah");

    const approveSteps = await buildApproveSteps(
      {
        chainId: params.chainId,
        owner: params.walletAddress,
        token: marketInfo.collateralInfo.address,
        spender: contractAddress,
        amount: params.assets,
      },
      publicClient,
      network,
    );
    steps.push(...approveSteps);

    steps.push({
      step: "supply",
      params: buildCallParams({
        to: contractAddress,
        abi: MOOLAH_ABI,
        functionName: "supplyCollateral",
        args: [marketInfo.params, params.assets, onBehalf, data],
        chainId: params.chainId,
      }),
    });

    return finalizeSteps(steps);
  }

  // A value-bearing step to the zero address succeeds and burns the funds, so
  // it must be unconstructible however the config arrived — belt and braces
  // with the resolver's own guard.
  if (marketInfo.collateralProvider === zeroAddress) {
    throw new Error(
      "buildSupplySteps: native collateral with no provider — refusing to " +
        "send value to the zero address",
    );
  }

  steps.push({
    step: "supply",
    params: buildCallParams({
      to: marketInfo.collateralProvider,
      abi: NATIVE_PROVIDER_ABI,
      functionName: "supplyCollateral",
      args: [marketInfo.params, onBehalf, data],
      value: params.assets,
      chainId: params.chainId,
    }),
  });

  return finalizeSteps(steps);
}

export async function buildBorrowSteps(
  params: {
    chainId: ChainId;
    assets: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
  },
  marketInfo: WriteMarketConfig,
  network: NetworkName,
  publicClient: PublicClient,
): Promise<StepParam[]> {
  // Resolved for the same reason supply is. Leaving this one reading the
  // config while supply reads the chain was worse than either: a config stale
  // across a provider migration would supply through the new provider and try
  // to withdraw through the old one, stranding the position.
  marketInfo = await withResolvedProviders(marketInfo, publicClient, network);
  const onBehalf = params.onBehalf ?? params.walletAddress;
  const receiver = params.receiver ?? onBehalf;

  const contractAddress =
    marketInfo.loanProvider !== zeroAddress
      ? marketInfo.loanProvider
      : getContractAddress(network, "moolah");

  return finalizeSteps([
    {
      step: "borrow",
      params: buildCallParams({
        to: contractAddress,
        abi: MOOLAH_ABI,
        functionName: "borrow",
        args: [marketInfo.params, params.assets, 0n, onBehalf, receiver],
        chainId: params.chainId,
      }),
    },
  ]);
}

export async function buildRepaySteps(
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
  marketInfo: WriteMarketConfig,
  deps: MarketBuilderDeps,
  userData?: MarketUserData,
): Promise<StepParam[]> {
  const { publicClient, network } = deps;
  const onBehalf = params.onBehalf ?? params.walletAddress;
  let assets = params.assets ?? 0n;
  let shares = params.shares ?? 0n;
  let nativeValue = params.nativeValue;
  let approveAmount = assets;

  if (params.repayAll) {
    // Repay-all is resolved from the user's position, so without it there is
    // nothing to resolve. Previously this fell through and emitted a
    // well-formed step with assets=0 and shares=0, which always reverts —
    // no error, no warning, and nothing in the step to suggest a problem.
    if (!userData) {
      throw new Error(
        "buildRepaySteps: repayAll requires userData to size the repayment",
      );
    }
    const repayAmount = userData
      ._getExtraRepayAmount()
      .roundDown(userData.decimals.l).numerator;
    assets = 0n;
    shares = userData.borrowShares;
    approveAmount = repayAmount;
  } else {
    // The contract requires exactly one of the two to be non-zero. The params
    // union enforces that at the MoolahSDK door, but `./builders` is a public
    // subpath export, so the guard has to live here too.
    [assets, shares] = resolveAssetsOrShares(params);
    if (shares > 0n) {
      approveAmount = await sharesToAssetCeiling(
        shares,
        marketInfo,
        publicClient,
        network,
      );
    }
  }

  // Resolved after the argument checks above, so a malformed call still fails
  // on its arguments rather than on the network.
  marketInfo = await withResolvedProviders(marketInfo, publicClient, network);

  // Sized off the resolved flag, not the caller-supplied one — doing this
  // before resolution let a stale or forged `loanIsNative` pick a `value`
  // that no longer matched the branch resolution actually takes.
  if (marketInfo.loanIsNative) {
    if (params.repayAll) {
      nativeValue = approveAmount;
    } else if (shares > 0n && nativeValue === undefined) {
      nativeValue = approveAmount;
    }
  }

  const steps: DraftStep[] = [];
  let approvedHere = false;
  let priorAllowance = 0n;
  let clearSpender: Address | null = null;
  const wbnb = getContractAddressOptional(network, "wbnb");
  // One predicate decides both whether to approve and which path to execute.
  // Splitting them meant a mismatch produced the worst combination: no
  // approval emitted AND the ERC-20 path taken. Compared case-insensitively
  // because the address book and the API disagree on casing, and guarded on
  // wbnb being configured at all — it is 0x0 on Ethereum.
  const isNativeLoan =
    marketInfo.loanIsNative &&
    wbnb !== zeroAddress &&
    marketInfo.loanInfo.address.toLowerCase() === wbnb.toLowerCase();

  if (!isNativeLoan) {
    const contractAddress =
      marketInfo.loanProvider !== zeroAddress
        ? marketInfo.loanProvider
        : getContractAddress(network, "moolah");

    const approveSteps = await buildApproveSteps(
      {
        chainId: params.chainId,
        owner: params.walletAddress,
        token: marketInfo.loanInfo.address,
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

  if (isNativeLoan) {
    if (marketInfo.loanProvider === zeroAddress) {
      throw new Error(
        "buildRepaySteps: native loan with no provider — refusing to send " +
          "value to the zero address",
      );
    }
    steps.push({
      step: "repay",
      params: buildCallParams({
        to: marketInfo.loanProvider,
        abi: NATIVE_PROVIDER_ABI,
        functionName: "repay",
        args: [marketInfo.params, assets, shares, onBehalf, "0x"],
        value: nativeValue ?? assets,
        chainId: params.chainId,
      }),
    });
    return finalizeSteps(steps);
  }

  const contractAddress =
    marketInfo.loanProvider !== zeroAddress
      ? marketInfo.loanProvider
      : getContractAddress(network, "moolah");

  steps.push({
    step: "repay",
    params: buildCallParams({
      to: contractAddress,
      abi: MOOLAH_ABI,
      functionName: "repay",
      args: [marketInfo.params, assets, shares, onBehalf, "0x"],
      chainId: params.chainId,
    }),
  });

  // Both repay paths over-approve by construction: `repayAll` approves the
  // debt plus twenty minutes of interest, and the shares path adds 1%. What is
  // not taken stays live against the provider unless it is handed back.
  if (approvedHere && !params.keepAllowance && clearSpender) {
    steps.push(
      ...buildClearAllowanceStep({
        chainId: params.chainId,
        token: marketInfo.loanInfo.address,
        spender: clearSpender,
        restoreTo: priorAllowance,
        network: network,
      }),
    );
  }

  return finalizeSteps(steps);
}

export async function buildWithdrawSteps(
  params: {
    chainId: ChainId;
    assets: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
  },
  marketInfo: WriteMarketConfig,
  network: NetworkName,
  publicClient: PublicClient,
): Promise<StepParam[]> {
  marketInfo = await withResolvedProviders(marketInfo, publicClient, network);
  const onBehalf = params.onBehalf ?? params.walletAddress;
  const receiver = params.receiver ?? onBehalf;

  // A zero-valued withdrawal encodes cleanly and settles nothing — the
  // failure mode with no signal, same as the vault's (see
  // buildVaultWithdrawSteps). Reachable by omitting both `assets` and
  // `withdrawAll`, or by `withdrawAll` against a position with nothing
  // withdrawable.
  if (params.assets <= 0n) {
    throw new Error(
      "buildWithdrawSteps: assets must be greater than zero — there is " +
        "nothing to withdraw",
    );
  }

  const contractAddress =
    marketInfo.collateralProvider !== zeroAddress
      ? marketInfo.collateralProvider
      : getContractAddress(network, "moolah");

  return finalizeSteps([
    {
      step: "withdraw",
      params: buildCallParams({
        to: contractAddress,
        abi: MOOLAH_ABI,
        functionName: "withdrawCollateral",
        args: [marketInfo.params, params.assets, onBehalf, receiver],
        chainId: params.chainId,
      }),
    },
  ]);
}

/**
 * Lend directly to a market, bypassing vaults.
 *
 * The existing supply builder supplies *collateral*. This is the lending side:
 * it earns the market's supply rate without a curator between the caller and
 * the market.
 */
export async function buildMoolahSupplySteps(
  params: {
    chainId: ChainId;
    assets?: bigint;
    shares?: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    /** Keep the leftover allowance instead of putting it back. */
    keepAllowance?: boolean;
  },
  marketInfo: WriteMarketConfig,
  deps: MarketBuilderDeps,
): Promise<StepParam[]> {
  const [assets, shares] = resolveAssetsOrShares(params);
  const { publicClient, network } = deps;
  const onBehalf = params.onBehalf ?? params.walletAddress;
  const moolah = getContractAddress(network, "moolah");
  const steps: DraftStep[] = [];

  // Shares mode still pulls tokens — the protocol converts and calls
  // `transferFrom` — so it needs an approval just as much as assets mode does.
  // Leaving it to the caller meant `buildMoolahSupplyParams({ shares })`
  // returned a single step that always reverted.
  const approveAmount =
    assets > 0n
      ? assets
      : await supplySharesToAssetCeiling(
          shares,
          marketInfo,
          publicClient,
          network,
        );

  const approveSteps = await buildApproveSteps(
    {
      chainId: params.chainId,
      owner: params.walletAddress,
      token: marketInfo.params.loanToken,
      spender: moolah,
      amount: approveAmount,
    },
    publicClient,
    network,
  );
  const approvedHere = approveSteps.length > 0;
  const priorAllowance = priorAllowanceOf(approveSteps);
  steps.push(...approveSteps);

  steps.push({
    step: "moolahSupply",
    params: buildCallParams({
      to: moolah,
      abi: MOOLAH_ABI,
      functionName: "supply",
      args: [
        {
          loanToken: marketInfo.params.loanToken,
          collateralToken: marketInfo.params.collateralToken,
          oracle: marketInfo.params.oracle,
          irm: marketInfo.params.irm,
          lltv: marketInfo.params.lltv,
        },
        assets,
        shares,
        onBehalf,
        "0x",
      ],
      chainId: params.chainId,
    }),
    meta: { amount: assets > 0n ? assets : shares },
  });

  // The shares path approves a ceiling with headroom on top, so Moolah takes
  // less than was approved. This was the one over-sizing builder with no
  // reclaim step, against a README that says every one of them has it.
  if (approvedHere && shares > 0n && !params.keepAllowance) {
    steps.push(
      ...buildClearAllowanceStep({
        chainId: params.chainId,
        token: marketInfo.params.loanToken,
        spender: moolah,
        restoreTo: priorAllowance,
        network,
      }),
    );
  }

  return finalizeSteps(steps);
}

/** Withdraw a direct-to-market supply position. */
export function buildMoolahWithdrawSteps(
  params: {
    chainId: ChainId;
    assets?: bigint;
    shares?: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
  },
  marketInfo: WriteMarketConfig,
  network: NetworkName,
): StepParam[] {
  const [assets, shares] = resolveAssetsOrShares(params);

  return finalizeSteps([
    {
      step: "moolahWithdraw",
      params: buildCallParams({
        to: getContractAddress(network, "moolah"),
        abi: MOOLAH_ABI,
        functionName: "withdraw",
        args: [
          {
            loanToken: marketInfo.params.loanToken,
            collateralToken: marketInfo.params.collateralToken,
            oracle: marketInfo.params.oracle,
            irm: marketInfo.params.irm,
            lltv: marketInfo.params.lltv,
          },
          assets,
          shares,
          params.onBehalf ?? params.walletAddress,
          params.receiver ?? params.walletAddress,
        ],
        chainId: params.chainId,
      }),
      meta: { amount: assets > 0n ? assets : shares },
    },
  ]);
}

/**
 * Take a Moolah flash loan.
 *
 * Permissionless and unsecured within the transaction: `data` is handed to the
 * caller's `onMoolahFlashLoan` callback, so the caller must be a contract that
 * implements it and repays before returning.
 */
export function buildFlashLoanSteps(params: {
  chainId: ChainId;
  token: Address;
  assets: bigint;
  data: `0x${string}`;
  network: NetworkName;
}): StepParam[] {
  if (params.assets <= 0n) {
    throw new Error("buildFlashLoanSteps: assets must be greater than zero");
  }

  return finalizeSteps([
    {
      step: "flashLoan",
      params: buildCallParams({
        to: getContractAddress(params.network, "moolah"),
        abi: MOOLAH_ABI,
        functionName: "flashLoan",
        args: [params.token, params.assets, params.data],
        chainId: params.chainId,
      }),
      meta: { token: params.token, amount: params.assets },
    },
  ]);
}
