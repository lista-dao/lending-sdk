import type { Address, PublicClient } from "viem";
import {
  LENDING_BROKER_ABI,
  type NetworkName,
} from "@lista-dao/moolah-sdk-core";
import type { ChainId, StepParam } from "../types.js";
import { buildCallParams } from "../utils.js";
import { buildApproveSteps } from "./approve.js";

export function buildBrokerBorrowSteps(params: {
  chainId: ChainId;
  brokerAddress: Address;
  amount: bigint;
  termId?: bigint;
}): StepParam[] {
  return [
    {
      step: "brokerBorrow",
      params: buildCallParams({
        to: params.brokerAddress,
        abi: LENDING_BROKER_ABI,
        functionName: "borrow",
        args:
          params.termId !== undefined
            ? [params.amount, params.termId]
            : [params.amount],
        chainId: params.chainId,
      }),
    },
  ];
}

export async function buildBrokerRepaySteps(
  params: {
    chainId: ChainId;
    brokerAddress: Address;
    amount: bigint;
    posId?: bigint;
    onBehalf?: Address;
    loanToken?: Address;
    walletAddress?: Address;
  },
  publicClient: PublicClient,
  network: NetworkName,
): Promise<StepParam[]> {
  const steps: StepParam[] = [];

  if (params.loanToken && params.walletAddress) {
    const approveSteps = await buildApproveSteps(
      {
        chainId: params.chainId,
        owner: params.walletAddress,
        token: params.loanToken,
        spender: params.brokerAddress,
        amount: params.amount,
      },
      publicClient,
      network,
    );
    steps.push(...approveSteps);
  }

  steps.push({
    step: "brokerRepay",
    params: buildCallParams({
      to: params.brokerAddress,
      abi: LENDING_BROKER_ABI,
      functionName: "repay",
      args:
        params.posId !== undefined
          ? [
              params.amount,
              params.posId,
              params.onBehalf ?? params.walletAddress,
            ]
          : [params.amount, params.onBehalf ?? params.walletAddress],
      chainId: params.chainId,
    }),
  });

  return steps;
}
