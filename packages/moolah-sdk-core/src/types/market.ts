import type { Address } from 'viem';
import type { Decimal } from '../utils/decimal';
import type { TokenInfo } from './common';

/**
 * Market parameters from chain
 */
export interface MarketParams {
    loanToken: Address;
    collateralToken: Address;
    oracle: Address;
    irm: Address;
    lltv: bigint;
}

/**
 * Market state from chain
 */
export interface MarketState {
    totalSupplyAssets: bigint;
    totalSupplyShares: bigint;
    totalBorrowAssets: bigint;
    totalBorrowShares: bigint;
    lastUpdate: bigint;
    fee: bigint;
}

/**
 * Market information from API
 */
export interface MarketInfo {
    description: string;
    descriptionZh?: string;
    supplyApy: string;
    curator: string;
    curatorIcon: string;
    performanceFeeRate: number;
    borrowRate: number;
    collateralTokenName: string;
    collateralTokenIcon: string;
    loanTokenName: string;
    loanTokenIcon: string;
    loanTokenPrice: number;
    zone: number;
    rewards?: { name: string; icon: string; points: string }[];
    collateralPriceLogic?: string;
    collateralPriceLogicCn?: string;
    loanPriceLogic?: string;
    loanPriceLogicCn?: string;
    collateralOracles: Array<{
        address: Address;
        baseTokenOracle?: Address | '';
        discountOracle?: Address | '';
        url: string | '';
        descCn: string;
        descEn: string;
        baseTokenSymbol?: string;
        baseToken?: Address;
    }>;
    loanOracles: Array<{
        address: Address;
        baseTokenOracle?: Address | '';
        discountOracle?: Address | '';
        url: string | '';
        descCn: string;
        descEn: string;
        baseTokenSymbol?: string;
        baseToken?: Address;
    }>;
    oracle: Address;
    loanToken: Address;
    collateralToken: Address;
    broker?: Address;
    termType: number;
    terms?: Array<{
        id: bigint;
        duration: bigint;
        apr: bigint;
    }>;
    chain: string;
}

/**
 * Market extra information from chain
 */
export interface MarketExtraInfo {
    lastUpdate: bigint;
    LLTV: Decimal;
    params: MarketParams;
    totalSupply: Decimal;
    totalBorrow: Decimal;
    totalSupplyAssets: bigint;
    totalBorrowShares: bigint;
    totalBorrowAssets: bigint;
    remaining: Decimal;
    minLoan: Decimal;
    feeRate: Decimal;
    utilRate: Decimal;
    borrowRate: Decimal;
    priceRate: Decimal;
    rateCap: bigint;
    rateFloor: bigint | null;
    rateAtTarget: bigint;
    rateView: bigint;
    loanProvider: Address;
    collateralProvider: Address;
    loanIsNative: boolean;
    collateralIsNative: boolean;
    isFixedRate: boolean;
    loanInfo: TokenInfo;
    collateralInfo: TokenInfo;
    _computeBorrowRate: (utilRate: bigint) => Decimal;
}

/**
 * Smart Market extra information from chain
 */
export interface MarketExtraInfoOfSmart {
    LLTV: Decimal;
    lastUpdate: bigint;
    params: MarketParams;
    totalSupply: Decimal;
    totalBorrow: Decimal;
    totalSupplyAssets: bigint;
    totalBorrowShares: bigint;
    totalBorrowAssets: bigint;
    remaining: Decimal;
    minLoan: Decimal;
    feeRate: Decimal;
    utilRate: Decimal;
    borrowRate: Decimal;
    priceRate: Decimal;
    rateCap: bigint;
    rateAtTarget: bigint;
    rateView: bigint;
    loanProvider: Address;
    collateralProvider: Address;
    loanIsNative: boolean;
    tokenAIsNative: boolean;
    tokenBIsNative: boolean;
    collateralIsNative: boolean;
    lpInfo: TokenInfo;
    loanInfo: TokenInfo;
    tokenAInfo: TokenInfo;
    tokenBInfo: TokenInfo;
    balances: [Decimal, Decimal];
    totalLp: Decimal;
    proportion: Decimal;
    stablePool: Address;
    LPToken: Address;
    stablePoolTool: Address;
    _computeBorrowRate: (utilRate: Decimal) => Decimal;
    _computeLpOutput: (
        dAmounts: [Decimal, Decimal],
        originalLp: Decimal,
        slippage?: Decimal,
    ) => {
        lpOutput: Decimal;
        aOutput: Decimal;
        bOutput: Decimal;
    };
    _breakdownLp: (lpAmount: Decimal) => {
        aOutput: Decimal;
        bOutput: Decimal;
    };
    _computeMaxX: (userLp: Decimal, index: number) => Decimal;
    _computeMaxY: (
        userLp: bigint,
        withdraw: bigint[],
        index: number,
    ) => bigint;
}

/**
 * User's market data
 */
export interface MarketUserData {
    collateral: Decimal;
    borrowShares: bigint;
    borrowed: Decimal;
    rawBorrowed: Decimal;
    borrowRate: Decimal;
    loanable: Decimal;
    withdrawable: Decimal;
    LTV: Decimal;
    LLTV: Decimal;
    liqPriceRate: Decimal;
    decimals: {
        l: number;
        c: number;
    };
    balances: {
        loan: Decimal;
        collateral: Decimal;
    };
    isWhiteList: boolean;
    loanInfo: TokenInfo;
    collateralInfo: TokenInfo;
    loanIsNative: boolean;
    collateralIsNative: boolean;
    _getExtraRepayAmount: () => Decimal;
    _computeLTV: (params: {
        supplyAmount?: string | number;
        borrowAmount?: string | number;
        repayAmount?: string | number;
        withdrawAmount?: string | number;
    }) => Decimal;
    _computeLoanable: (supplyAmount: string | number, LTV?: number) => Decimal;
    _computeWithdrawable: (repayAmount: string | number) => Decimal;
}

/**
 * Smart Market user data
 */
export interface MarketUserDataOfSmart {
    collateral: Decimal;
    lpTokenA: Decimal;
    lpTokenB: Decimal;
    borrowShares: bigint;
    borrowed: Decimal;
    borrowRate: Decimal;
    loanable: Decimal;
    LTV: Decimal;
    LLTV: Decimal;
    decimals: {
        l: number;
        c: number;
        a: number;
        b: number;
        lp: number;
    };
    balances: {
        lp: Decimal;
        loan: Decimal;
        tokenA: Decimal;
        tokenB: Decimal;
    };
    isWhiteList: boolean;
    _getExtraRepayAmount: () => Decimal;
    _computeLTV: (params: {
        collateral: Decimal;
        borrowAmount?: Decimal;
    }) => Decimal;
    _computeLoanable: (collateral: Decimal, LTV?: number) => Decimal;
    _computeWithdrawable: (
        repay: Decimal,
        slippage: Decimal,
        isFixed?: boolean,
    ) => readonly [Decimal, Decimal, Decimal];
}

/**
 * User fixed term data
 */
export interface UserFixedTermData {
    dynamicOutstanding: Decimal;
    fixedOutstanding: Decimal;
    totalBorrowed: Decimal;
    weightedBorrowRate: Decimal;
}
