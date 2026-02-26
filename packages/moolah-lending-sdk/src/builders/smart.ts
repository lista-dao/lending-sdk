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
import type { ChainId, StepParam } from "../types";
import { buildCallParams } from "../utils";
import { buildApproveSteps } from "./approve";

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
  const { publicClient, network } = deps;
  const steps: StepParam[] = [];

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

  return steps;
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
  const { publicClient, network } = deps;
  const steps: StepParam[] = [];

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

  return steps;
}

export function buildSmartWithdrawDexLpSteps(
  params: {
    chainId: ChainId;
    lpAmount: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
  },
  smartConfig: WriteSmartMarketConfig,
): StepParam[] {
  return [
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
  ];
}

export function buildSmartWithdrawCollateralSteps(
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
): StepParam[] {
  return [
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
  ];
}

export function buildSmartWithdrawCollateralFixedSteps(
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
): StepParam[] {
  return [
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
  ];
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
  },
  smartConfig: WriteSmartMarketConfig,
  deps: SmartBuilderDeps,
  userData?: SmartMarketUserData,
): Promise<StepParam[]> {
  const { publicClient, network } = deps;

  let assets = params.assets ?? 0n;
  let shares = params.shares ?? 0n;
  let nativeValue = params.nativeValue;
  let approveAmount = assets;

  if (params.repayAll && userData) {
    const repayAmount = userData
      ._getExtraRepayAmount()
      .roundDown(userData.decimals.l).numerator;
    assets = 0n;
    shares = userData.borrowShares;
    approveAmount = repayAmount;
    if (smartConfig.loanIsNative) {
      nativeValue = repayAmount;
    }
  }

  const steps: StepParam[] = [];

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
        value: nativeValue,
        chainId: params.chainId,
      }),
    });
    return steps;
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

  return steps;
}
