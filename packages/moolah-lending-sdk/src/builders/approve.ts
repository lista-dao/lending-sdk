import type { Address, PublicClient } from "viem";
import { isUsdtLikeToken, type NetworkName } from "@lista-dao/moolah-sdk-core";
import type { ChainId, StepParam } from "../types.js";
import { buildCallParams, finalizeSteps, type DraftStep } from "../utils.js";

export const ERC20_APPROVE_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export interface BuildApproveParams {
  chainId: ChainId;
  owner: Address;
  token: Address;
  spender: Address;
  amount: bigint;
}

/**
 * A step that returns an allowance to zero.
 *
 * `meta.reversalSteps` on an approve covers *abandoning* a sequence. It does
 * not cover finishing one: where the approval was deliberately over-sized —
 * every repay and every liquidation in this SDK, because the amount owed moves
 * between building and inclusion — the unused remainder is still live against
 * the spender afterwards, and nothing reclaims it. Builders that over-size
 * append this so the sequence ends where it started.
 */
export function buildClearAllowanceStep(params: {
  chainId: ChainId;
  token: Address;
  spender: Address;
  /**
   * What the allowance was before this sequence raised it. Restoring that —
   * rather than zeroing — is the difference between undoing the over-approval
   * and destroying an allowance the caller was relying on. Defaults to zero.
   */
  restoreTo?: bigint;
  /** Needed to know whether the token refuses a non-zero-to-non-zero change. */
  network: NetworkName;
}): DraftStep[] {
  const restoreTo = params.restoreTo ?? 0n;
  const steps: DraftStep[] = [];

  // Tether refuses any non-zero to non-zero change, in either direction. The
  // raise path has always emitted the reset pair; the lowering path did not,
  // so the final step of every USDT sequence with a prior allowance reverted —
  // the same token rule, missed on the other side of the same function.
  if (restoreTo > 0n && isUsdtLikeToken(params.network, params.token)) {
    steps.push(approveStep(params.chainId, params.token, params.spender, 0n));
  }
  steps.push(
    approveStep(
      params.chainId,
      params.token,
      params.spender,
      restoreTo,
      "the approval above was deliberately over-sized; this puts the " +
        "allowance back where the sequence found it",
    ),
  );
  return steps;
}

/** One `approve` call, as a step. */
function approveStep(
  chainId: ChainId,
  token: Address,
  spender: Address,
  amount: bigint,
  precondition = "token requires the allowance to pass through zero",
): DraftStep {
  return {
    step: "approve",
    params: buildCallParams({
      to: token,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, amount],
      chainId,
    }),
    meta: { token, spender, amount, reset: true, precondition },
  };
}

/**
 * The allowance that was in place before these approve steps raise it.
 *
 * `buildApproveSteps` records it as `meta.observedState.allowance`; pairing the
 * clear step with it is what keeps the undo an undo.
 */
export function priorAllowanceOf(steps: readonly StepParam[]): bigint {
  // Only an approve step's `observedState.allowance` is an allowance. The vault
  // mint step stamps the same field with a `previewMint` quote, so reading it
  // blindly would pin a permanent allowance at that ceiling instead of
  // restoring one.
  const first = steps[0];
  if (!first || first.step !== "approve") return 0n;
  const observed = first.meta?.observedState?.allowance;
  return typeof observed === "bigint" ? observed : 0n;
}

export async function buildApproveSteps(
  params: BuildApproveParams,
  publicClient: PublicClient,
  network: NetworkName,
): Promise<StepParam[]> {
  if (params.amount <= 0n) return finalizeSteps([]);

  const allowance = (await publicClient.readContract({
    address: params.token,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: [params.owner, params.spender],
  })) as bigint;

  if (allowance >= params.amount) {
    return finalizeSteps([]);
  }

  const shouldReset = isUsdtLikeToken(network, params.token) && allowance > 0n;
  const steps: DraftStep[] = [];

  // These steps exist because of a read taken now, while the transactions land
  // later. Record what was observed so the caller can decide whether the gap
  // matters rather than discovering a stale decision at send time.
  const observedState = { allowance };

  // Undoing any step in this sequence means going back to what was there
  // before it, which is not necessarily zero — and on a token that refuses a
  // non-zero to non-zero change, going back needs the same reset pair that
  // going up does.
  const restore = buildClearAllowanceStep({
    chainId: params.chainId,
    token: params.token,
    spender: params.spender,
    restoreTo: allowance,
    network,
  });

  if (shouldReset) {
    steps.push({
      step: "approve",
      params: buildCallParams({
        to: params.token,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [params.spender, 0n],
        chainId: params.chainId,
      }),
      meta: {
        token: params.token,
        spender: params.spender,
        amount: 0n,
        reset: true,
        precondition:
          "token requires the allowance to be reset to 0 before it can be raised",
        observedState,
        // The reset is itself a change to durable state: abandoning after it
        // leaves the spender at zero when the caller started at `allowance`.
        reversalSteps: finalizeSteps(restore),
      },
    });
  }

  steps.push({
    step: "approve",
    params: buildCallParams({
      to: params.token,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [params.spender, params.amount],
      chainId: params.chainId,
    }),
    meta: {
      token: params.token,
      spender: params.spender,
      amount: params.amount,
      precondition: "allowance is below the required amount",
      observedState,
      // An allowance is durable state: abandoning the sequence after this step
      // leaves the spender able to pull the approved amount indefinitely. The
      // undo travels with the step that creates it — and it restores rather
      // than zeroes, because zeroing is not an undo for a caller who arrived
      // with an allowance already in place.
      reversalSteps: finalizeSteps(restore),
    },
  });

  return finalizeSteps(steps);
}
