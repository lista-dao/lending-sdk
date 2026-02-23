import type { Abi, Address } from 'viem';
import type {
    WriteMarketConfig,
    WriteSmartMarketConfig,
    VaultInfo,
    VaultUserData,
    MarketUserData,
    SmartMarketUserData,
} from '@lista-dao/moolah-sdk-core';

export type ChainId = number | string;

export interface MoolahSDKConfig {
    rpcUrls: Record<string, string>;
    apiBaseUrl?: string;
}



export interface ContractCallParams {
    to: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
    chainId: ChainId;
    /** Encoded calldata for convenience */
    data: `0x${string}`;
}

export interface StepParam {
    step:
    | 'approve'
    | 'supply'
    | 'borrow'
    | 'repay'
    | 'withdraw'
    | 'depositVault'
    | 'withdrawVault'
    | 'supplySmartDexLp'
    | 'supplySmartCollateral'
    | 'withdrawSmartDexLp'
    | 'withdrawSmartCollateral'
    | 'withdrawSmartCollateralFixed'
    | 'repaySmartMarket'
    | 'brokerBorrow'
    | 'brokerRepay';
    params: ContractCallParams;
    meta?: {
        token?: Address;
        spender?: Address;
        amount?: bigint;
        reset?: boolean;
    };
}

export interface BuildSupplyParams {
    chainId: ChainId;
    marketId: Address;
    assets: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    marketInfo?: WriteMarketConfig;
}

export interface BuildBorrowParams {
    chainId: ChainId;
    marketId: Address;
    assets: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
    marketInfo?: WriteMarketConfig;
}

export interface BuildRepayParams {
    chainId: ChainId;
    marketId: Address;
    assets?: bigint;
    shares?: bigint;
    repayAll?: boolean;
    walletAddress: Address;
    onBehalf?: Address;
    /** For native repay-all, explicit value override */
    nativeValue?: bigint;
    marketInfo?: WriteMarketConfig;
    userData?: MarketUserData;
}

export interface BuildWithdrawParams {
    chainId: ChainId;
    marketId: Address;
    assets?: bigint;
    withdrawAll?: boolean;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
    marketInfo?: WriteMarketConfig;
    userData?: MarketUserData;
}

export interface BuildVaultDepositParams {
    chainId: ChainId;
    vaultAddress: Address;
    assets: bigint;
    walletAddress: Address;
    receiver?: Address;
    vaultInfo?: VaultInfo;
}

export interface BuildVaultWithdrawParams {
    chainId: ChainId;
    vaultAddress: Address;
    assets?: bigint;
    shares?: bigint;
    withdrawAll?: boolean;
    walletAddress: Address;
    receiver?: Address;
    vaultInfo?: VaultInfo;
    userData?: VaultUserData;
}

export interface BuildSmartSupplyDexLpParams {
    chainId: ChainId;
    marketId: Address;
    lpAmount: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    smartConfig?: WriteSmartMarketConfig;
}

export interface BuildSmartSupplyCollateralParams {
    chainId: ChainId;
    marketId: Address;
    tokenAAmount: bigint;
    tokenBAmount: bigint;
    minLpAmount: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    smartConfig?: WriteSmartMarketConfig;
}

export interface BuildSmartWithdrawDexLpParams {
    chainId: ChainId;
    marketId: Address;
    lpAmount: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
    smartConfig?: WriteSmartMarketConfig;
}

export interface BuildSmartWithdrawCollateralParams {
    chainId: ChainId;
    marketId: Address;
    tokenAAmount: bigint;
    tokenBAmount: bigint;
    maxLpBurn: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
    smartConfig?: WriteSmartMarketConfig;
}

export interface BuildSmartWithdrawCollateralFixedParams {
    chainId: ChainId;
    marketId: Address;
    lpAmount: bigint;
    minTokenAAmount: bigint;
    minTokenBAmount: bigint;
    walletAddress: Address;
    onBehalf?: Address;
    receiver?: Address;
    smartConfig?: WriteSmartMarketConfig;
}

export interface BuildSmartRepayParams {
    chainId: ChainId;
    marketId: Address;
    assets?: bigint;
    shares?: bigint;
    repayAll?: boolean;
    walletAddress: Address;
    onBehalf?: Address;
    nativeValue?: bigint;
    smartConfig?: WriteSmartMarketConfig;
    userData?: SmartMarketUserData;
}

export interface BuildBrokerBorrowParams {
    chainId: ChainId;
    brokerAddress: Address;
    amount: bigint;
    termId?: bigint;
}

export interface BuildBrokerRepayParams {
    chainId: ChainId;
    brokerAddress: Address;
    amount: bigint;
    posId?: bigint;
    onBehalf?: Address;
    /** Optional loan token address for allowance checks */
    loanToken?: Address;
    walletAddress?: Address;
}
