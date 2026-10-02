import type { Abi, Address } from "viem";
import { encodeFunctionData } from "viem";
import type { ChainId, ContractCallParams, StepParam } from "./types.js";

/**
 * A step before it has been given a sequence position. Builders assemble
 * these and stamp them once, at the exported entry point.
 */
export type DraftStep = Omit<StepParam, "index">;

/**
 * Stamp sequence positions onto a built step list.
 *
 * Builders compose — a repay builder embeds approve steps — so indices are
 * assigned once at each builder's boundary. Re-stamping an already-stamped
 * list is idempotent, which is what makes composition safe.
 */
export function finalizeSteps(steps: readonly DraftStep[]): StepParam[] {
  return steps.map((step, index) => ({ ...step, index }));
}

export function buildCallParams(params: {
  to: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  chainId: ChainId;
}): ContractCallParams {
  const data = encodeFunctionData({
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
  });

  return {
    to: params.to,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
    value: params.value,
    chainId: params.chainId,
    data,
  };
}
