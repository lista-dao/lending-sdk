import type { Address, PublicClient } from "viem";
import {
  PUBLIC_LIQUIDATOR_ABI,
  getContractAddress,
  type NetworkName,
} from "@lista-dao/moolah-sdk-core";
import type { ChainId, StepParam } from "../types.js";
import { buildCallParams, finalizeSteps, type DraftStep } from "../utils.js";
import {
  buildApproveSteps,
  buildClearAllowanceStep,
  priorAllowanceOf,
} from "./approve.js";

export interface LiquidationBuilderDeps {
  publicClient: PublicClient;
  network: NetworkName;
}

/**
 * Resolve the seized/repaid pair into the contract's argument order.
 *
 * `liquidate` takes both and requires exactly one to be non-zero. The union on
 * the params type makes supplying both a compile error; this guard is what
 * protects a JavaScript caller, who has no types at all.
 */
function resolveLiquidationAmounts(params: {
  seizedAssets?: bigint;
  repaidShares?: bigint;
}): [bigint, bigint] {
  const seized = params.seizedAssets ?? 0n;
  const repaid = params.repaidShares ?? 0n;
  if ((seized === 0n) === (repaid === 0n)) {
    throw new Error(
      "exactly one of `seizedAssets` or `repaidShares` must be non-zero",
    );
  }
  return [seized, repaid];
}

/**
 * Is this market enabled on the public liquidator?
 *
 * The liquidator keeps a per-market allowlist and reverts `NotWhitelisted()`
 * for everything else. At the time of writing not one of the thirteen distinct
 * markets the "close to liquidation" feed returns on BSC was enabled, so this
 * is the common case, not the corner case — and the revert carries a bare
 * selector, which is what an integrator would be left staring at.
 */
export async function isLiquidationMarketEnabled(
  marketId: `0x${string}`,
  deps: LiquidationBuilderDeps,
): Promise<boolean> {
  return (await deps.publicClient.readContract({
    address: getContractAddress(deps.network, "moolahPublicLiquidation"),
    abi: PUBLIC_LIQUIDATOR_ABI,
    functionName: "marketWhitelist",
    args: [marketId],
  })) as boolean;
}

/**
 * Quote the loan-token outlay for a liquidation.
 *
 * Reads `loanTokenAmountNeed` on the public liquidator. The figure moves with
 * the oracle between quoting and inclusion, so treat it as a size estimate for
 * the approval rather than a settled cost.
 */
export async function quoteLiquidationCost(
  params: {
    marketId: `0x${string}`;
    seizedAssets?: bigint;
    repaidShares?: bigint;
  },
  deps: LiquidationBuilderDeps,
): Promise<bigint> {
  const [seized, repaid] = resolveLiquidationAmounts(params);
  return (await deps.publicClient.readContract({
    address: getContractAddress(deps.network, "moolahPublicLiquidation"),
    abi: PUBLIC_LIQUIDATOR_ABI,
    functionName: "loanTokenAmountNeed",
    args: [params.marketId, seized, repaid],
  })) as bigint;
}

/**
 * Liquidate an unhealthy position through the public liquidator.
 *
 * Two modes, selected by which amount you supply: `seizedAssets` fixes how
 * much collateral you take, `repaidShares` fixes how much debt you clear.
 *
 * The repayment is pulled from the caller, so the loan token is approved to
 * the liquidator first. `maxRepayAmount` sizes that approval — pass headroom,
 * since the amount actually owed moves with the oracle between building and
 * inclusion. Use {@link quoteLiquidationCost} for a starting figure.
 *
 * The liquidator only serves markets an admin has put on its allowlist. That
 * is checked before anything is built, because the alternative is a bare
 * `NotWhitelisted()` selector after the gas has been spent.
 *
 * This is the plain path. `flashLiquidate` — which borrows the repayment and
 * settles it from the seized collateral in one transaction — needs swap
 * calldata from an aggregator and is not built here.
 */
export async function buildLiquidateSteps(
  params: {
    chainId: ChainId;
    marketId: `0x${string}`;
    borrower: Address;
    walletAddress: Address;
    loanToken: Address;
    maxRepayAmount: bigint;
    seizedAssets?: bigint;
    repaidShares?: bigint;
    /**
     * Build the call even though the market is not on the liquidator's
     * allowlist. Only useful when you expect it to be enabled by the time the
     * transaction lands.
     */
    allowUnlistedMarket?: boolean;
    /** Keep the leftover allowance instead of returning it to zero. */
    keepAllowance?: boolean;
  },
  deps: LiquidationBuilderDeps,
): Promise<StepParam[]> {
  const [seized, repaid] = resolveLiquidationAmounts(params);
  if (params.maxRepayAmount <= 0n) {
    throw new Error(
      "buildLiquidateSteps: maxRepayAmount must be greater than zero",
    );
  }

  if (!params.allowUnlistedMarket) {
    const enabled = await isLiquidationMarketEnabled(params.marketId, deps);
    if (!enabled) {
      throw new Error(
        `buildLiquidateSteps: market ${params.marketId} is not on the public ` +
          `liquidator's allowlist, so this call would revert with ` +
          `NotWhitelisted(). Check marketWhitelist() before offering the ` +
          `action, or pass allowUnlistedMarket to build it anyway.`,
      );
    }
  }

  const liquidator = getContractAddress(
    deps.network,
    "moolahPublicLiquidation",
  );
  const steps: DraftStep[] = [];

  const approveSteps = await buildApproveSteps(
    {
      chainId: params.chainId,
      owner: params.walletAddress,
      token: params.loanToken,
      spender: liquidator,
      amount: params.maxRepayAmount,
    },
    deps.publicClient,
    deps.network,
  );
  const approvedHere = approveSteps.length > 0;
  const priorAllowance = priorAllowanceOf(approveSteps);
  steps.push(...approveSteps);

  steps.push({
    step: "liquidate",
    params: buildCallParams({
      to: liquidator,
      abi: PUBLIC_LIQUIDATOR_ABI,
      functionName: "liquidate",
      // Amounts are raw on-chain units. A display multiplier must never reach
      // this call: it would misstate how much collateral moves.
      args: [params.marketId, params.borrower, seized, repaid],
      chainId: params.chainId,
    }),
    meta: {
      token: params.loanToken,
      spender: liquidator,
      // `amount` is read as "an amount of `token`", so it has to be the
      // loan-token figure. The seized/repaid quantities are in collateral and
      // share units respectively and belong in the description, not here.
      amount: params.maxRepayAmount,
      precondition:
        seized > 0n
          ? `seizing ${seized} collateral units, repaying up to ${params.maxRepayAmount}`
          : `repaying ${repaid} borrow shares, up to ${params.maxRepayAmount} loan tokens`,
    },
  });

  // `maxRepayAmount` is headroom against an oracle that moves, so the
  // liquidator takes less than was approved. Hand the rest back — but only when
  // this sequence created the allowance, and it is put back where it was
  // rather than at zero, so a liquidator bot's standing approval survives.
  if (approvedHere && !params.keepAllowance) {
    steps.push(
      ...buildClearAllowanceStep({
        chainId: params.chainId,
        token: params.loanToken,
        spender: liquidator,
        restoreTo: priorAllowance,
        network: deps.network,
      }),
    );
  }

  return finalizeSteps(steps);
}
