import type { Address, PublicClient } from "viem";
import { zeroAddress } from "viem";
import {
  MOOLAH_VAULT_ABI,
  NATIVE_PROVIDER_ABI,
  getContractAddressOptional,
  type NetworkName,
  type VaultInfo,
  type VaultUserData,
} from "@lista-dao/moolah-sdk-core";
import type { ChainId, StepParam } from "../types";
import { buildCallParams } from "../utils";
import { buildApproveSteps } from "./approve";

export interface VaultBuilderDeps {
  publicClient: PublicClient;
  network: NetworkName;
}

export async function buildVaultDepositSteps(
  params: {
    chainId: ChainId;
    vaultAddress: Address;
    assets: bigint;
    walletAddress: Address;
    receiver?: Address;
  },
  vaultInfo: VaultInfo,
  deps: VaultBuilderDeps,
): Promise<StepParam[]> {
  const { publicClient, network } = deps;
  const receiver = params.receiver ?? params.walletAddress;
  const wbnb = getContractAddressOptional(network, "wbnb");
  const isNativeBNB =
    vaultInfo.isNative && vaultInfo.assetInfo.address === wbnb;

  const steps: StepParam[] = [];

  if (!isNativeBNB) {
    const contractAddress =
      vaultInfo.provider !== zeroAddress
        ? vaultInfo.provider
        : params.vaultAddress;

    const approveSteps = await buildApproveSteps(
      {
        chainId: params.chainId,
        owner: params.walletAddress,
        token: vaultInfo.assetInfo.address,
        spender: contractAddress,
        amount: params.assets,
      },
      publicClient,
      network,
    );
    steps.push(...approveSteps);

    steps.push({
      step: "depositVault",
      params: buildCallParams({
        to: contractAddress,
        abi: MOOLAH_VAULT_ABI,
        functionName: "deposit",
        args: [params.assets, receiver],
        chainId: params.chainId,
      }),
    });
    return steps;
  }

  if (vaultInfo.provider !== zeroAddress) {
    steps.push({
      step: "depositVault",
      params: buildCallParams({
        to: vaultInfo.provider,
        abi: NATIVE_PROVIDER_ABI,
        functionName: "deposit",
        args: [params.vaultAddress, receiver],
        value: params.assets,
        chainId: params.chainId,
      }),
    });
    return steps;
  }

  steps.push({
    step: "depositVault",
    params: buildCallParams({
      to: params.vaultAddress,
      abi: MOOLAH_VAULT_ABI,
      functionName: "deposit",
      args: [params.assets, receiver],
      chainId: params.chainId,
    }),
  });

  return steps;
}

export function buildVaultWithdrawSteps(
  params: {
    chainId: ChainId;
    vaultAddress: Address;
    assets?: bigint;
    shares?: bigint;
    withdrawAll?: boolean;
    walletAddress: Address;
    receiver?: Address;
  },
  vaultInfo: VaultInfo,
  network: NetworkName,
  userData?: VaultUserData,
): StepParam[] {
  const receiver = params.receiver ?? params.walletAddress;
  const owner = receiver;
  const wbnb = getContractAddressOptional(network, "wbnb");
  const isNativeBNB =
    vaultInfo.isNative && vaultInfo.assetInfo.address === wbnb;

  let shares = params.shares;
  const assets = params.assets;

  if (params.withdrawAll && userData) {
    shares = userData.shares.numerator;
  }

  const contractAddress =
    vaultInfo.provider !== zeroAddress
      ? vaultInfo.provider
      : params.vaultAddress;

  if (shares !== undefined) {
    if (isNativeBNB && vaultInfo.provider !== zeroAddress) {
      return [
        {
          step: "withdrawVault",
          params: buildCallParams({
            to: vaultInfo.provider,
            abi: NATIVE_PROVIDER_ABI,
            functionName: "redeem",
            args: [params.vaultAddress, shares, receiver, owner],
            chainId: params.chainId,
          }),
        },
      ];
    }

    return [
      {
        step: "withdrawVault",
        params: buildCallParams({
          to: contractAddress,
          abi: MOOLAH_VAULT_ABI,
          functionName: "redeem",
          args: [shares, receiver, owner],
          chainId: params.chainId,
        }),
      },
    ];
  }

  if (assets === undefined) {
    throw new Error("assets or shares is required for vault withdraw");
  }

  if (isNativeBNB && vaultInfo.provider !== zeroAddress) {
    return [
      {
        step: "withdrawVault",
        params: buildCallParams({
          to: vaultInfo.provider,
          abi: NATIVE_PROVIDER_ABI,
          functionName: "withdraw",
          args: [params.vaultAddress, assets, receiver, owner],
          chainId: params.chainId,
        }),
      },
    ];
  }

  return [
    {
      step: "withdrawVault",
      params: buildCallParams({
        to: contractAddress,
        abi: MOOLAH_VAULT_ABI,
        functionName: "withdraw",
        args: [assets, receiver, owner],
        chainId: params.chainId,
      }),
    },
  ];
}
