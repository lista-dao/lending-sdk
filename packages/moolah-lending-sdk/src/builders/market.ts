import type { Address, PublicClient } from 'viem';
import { zeroAddress } from 'viem';
import {
    MOOLAH_ABI,
    NATIVE_PROVIDER_ABI,
    getContractAddress,
    getContractAddressOptional,
    type NetworkName,
    type WriteMarketConfig,
    type MarketUserData,
} from '@lista-dao/moolah-sdk-core';
import type { ChainId, StepParam } from '../types';
import { buildCallParams } from '../utils';
import { buildApproveSteps } from './approve';

export interface MarketBuilderDeps {
    publicClient: PublicClient;
    network: NetworkName;
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
    const onBehalf = params.onBehalf ?? params.walletAddress;
    const data = '0x' as `0x${string}`;
    const steps: StepParam[] = [];

    if (!marketInfo.collateralIsNative) {
        const contractAddress =
            marketInfo.collateralProvider !== zeroAddress
                ? marketInfo.collateralProvider
                : getContractAddress(network, 'moolah');

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
            step: 'supply',
            params: buildCallParams({
                to: contractAddress,
                abi: MOOLAH_ABI,
                functionName: 'supplyCollateral',
                args: [marketInfo.params, params.assets, onBehalf, data],
                chainId: params.chainId,
            }),
        });

        return steps;
    }

    steps.push({
        step: 'supply',
        params: buildCallParams({
            to: marketInfo.collateralProvider,
            abi: NATIVE_PROVIDER_ABI,
            functionName: 'supplyCollateral',
            args: [marketInfo.params, onBehalf, data],
            value: params.assets,
            chainId: params.chainId,
        }),
    });

    return steps;
}

export function buildBorrowSteps(
    params: {
        chainId: ChainId;
        assets: bigint;
        walletAddress: Address;
        onBehalf?: Address;
        receiver?: Address;
    },
    marketInfo: WriteMarketConfig,
    network: NetworkName,
): StepParam[] {
    const onBehalf = params.onBehalf ?? params.walletAddress;
    const receiver = params.receiver ?? onBehalf;

    const contractAddress =
        marketInfo.loanProvider !== zeroAddress
            ? marketInfo.loanProvider
            : getContractAddress(network, 'moolah');

    return [
        {
            step: 'borrow',
            params: buildCallParams({
                to: contractAddress,
                abi: MOOLAH_ABI,
                functionName: 'borrow',
                args: [marketInfo.params, params.assets, 0n, onBehalf, receiver],
                chainId: params.chainId,
            }),
        },
    ];
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

    if (params.repayAll && userData) {
        const repayAmount = userData._getExtraRepayAmount().roundDown(userData.decimals.l).numerator;
        assets = 0n;
        shares = userData.borrowShares;
        approveAmount = repayAmount;
        if (marketInfo.loanIsNative) {
            nativeValue = repayAmount;
        }
    }

    const steps: StepParam[] = [];
    const wbnb = getContractAddressOptional(network, 'wbnb');
    const isNativeBNB = marketInfo.loanIsNative && marketInfo.loanInfo.address === wbnb;

    if (!marketInfo.loanIsNative) {
        const contractAddress =
            marketInfo.loanProvider !== zeroAddress
                ? marketInfo.loanProvider
                : getContractAddress(network, 'moolah');

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
        steps.push(...approveSteps);
    }

    if (isNativeBNB) {
        steps.push({
            step: 'repay',
            params: buildCallParams({
                to: marketInfo.loanProvider,
                abi: NATIVE_PROVIDER_ABI,
                functionName: 'repay',
                args: [marketInfo.params, assets, shares, onBehalf, '0x'],
                value: nativeValue ?? assets,
                chainId: params.chainId,
            }),
        });
        return steps;
    }

    const contractAddress =
        marketInfo.loanProvider !== zeroAddress
            ? marketInfo.loanProvider
            : getContractAddress(network, 'moolah');

    steps.push({
        step: 'repay',
        params: buildCallParams({
            to: contractAddress,
            abi: MOOLAH_ABI,
            functionName: 'repay',
            args: [marketInfo.params, assets, shares, onBehalf, '0x'],
            chainId: params.chainId,
        }),
    });

    return steps;
}

export function buildWithdrawSteps(
    params: {
        chainId: ChainId;
        assets: bigint;
        walletAddress: Address;
        onBehalf?: Address;
        receiver?: Address;
    },
    marketInfo: WriteMarketConfig,
    network: NetworkName,
): StepParam[] {
    const onBehalf = params.onBehalf ?? params.walletAddress;
    const receiver = params.receiver ?? onBehalf;

    const contractAddress =
        marketInfo.collateralProvider !== zeroAddress
            ? marketInfo.collateralProvider
            : getContractAddress(network, 'moolah');

    return [
        {
            step: 'withdraw',
            params: buildCallParams({
                to: contractAddress,
                abi: MOOLAH_ABI,
                functionName: 'withdrawCollateral',
                args: [marketInfo.params, params.assets, onBehalf, receiver],
                chainId: params.chainId,
            }),
        },
    ];
}
