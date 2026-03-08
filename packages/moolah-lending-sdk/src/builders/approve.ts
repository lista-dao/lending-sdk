import type { Address, PublicClient } from "viem";
import { isUsdtLikeToken, type NetworkName } from "@lista-dao/moolah-sdk-core";
import type { ChainId, StepParam } from "../types.js";
import { buildCallParams } from "../utils.js";

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

export async function buildApproveSteps(
  params: BuildApproveParams,
  publicClient: PublicClient,
  network: NetworkName,
): Promise<StepParam[]> {
  if (params.amount <= 0n) return [];

  const allowance = (await publicClient.readContract({
    address: params.token,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: [params.owner, params.spender],
  })) as bigint;

  if (allowance >= params.amount) {
    return [];
  }

  const shouldReset = isUsdtLikeToken(network, params.token) && allowance > 0n;
  const steps: StepParam[] = [];

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
    },
  });

  return steps;
}
