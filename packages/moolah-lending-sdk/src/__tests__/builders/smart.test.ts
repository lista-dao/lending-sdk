import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PublicClient, Address } from 'viem';
import { zeroAddress } from 'viem';
import {
    buildSmartSupplyDexLpSteps,
    buildSmartSupplyCollateralSteps,
    buildSmartWithdrawDexLpSteps,
    buildSmartWithdrawCollateralSteps,
    buildSmartWithdrawCollateralFixedSteps,
    buildSmartRepaySteps,
} from '../../builders/smart';
import type { WriteSmartMarketConfig } from '@lista-dao/moolah-sdk-core';

const mockReadContract = vi.fn();
const mockPublicClient = {
    readContract: mockReadContract,
} as unknown as PublicClient;

const LP_TOKEN = '0x1111111111111111111111111111111111111111' as Address;
const TOKEN_A = '0x2222222222222222222222222222222222222222' as Address;
const TOKEN_B = '0x3333333333333333333333333333333333333333' as Address;
const LOAN_TOKEN = '0x4444444444444444444444444444444444444444' as Address;
const WALLET = '0x5555555555555555555555555555555555555555' as Address;
const COLLATERAL_PROVIDER = '0x6666666666666666666666666666666666666666' as Address;
const LOAN_PROVIDER = '0x7777777777777777777777777777777777777777' as Address;

const baseSmartConfig: WriteSmartMarketConfig = {
    params: {
        loanToken: LOAN_TOKEN,
        collateralToken: LP_TOKEN,
        oracle: '0x8888888888888888888888888888888888888888' as Address,
        irm: '0x9999999999999999999999999999999999999999' as Address,
        lltv: 800000000000000000n,
    },
    collateralProvider: COLLATERAL_PROVIDER,
    loanProvider: LOAN_PROVIDER,
    loanIsNative: false,
    tokenAIsNative: false,
    tokenBIsNative: false,
    lpInfo: { address: LP_TOKEN, decimals: 18, symbol: 'LP' },
    loanInfo: { address: LOAN_TOKEN, decimals: 18, symbol: 'LOAN' },
    tokenAInfo: { address: TOKEN_A, decimals: 18, symbol: 'TOKA' },
    tokenBInfo: { address: TOKEN_B, decimals: 18, symbol: 'TOKB' },
};

describe('buildSmartSupplyDexLpSteps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockReadContract.mockResolvedValue(0n);
    });

    it('should build supply LP steps with approval', async () => {
        const steps = await buildSmartSupplyDexLpSteps(
            {
                chainId: 56,
                lpAmount: 1000n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseSmartConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        expect(steps.some((s) => s.step === 'approve')).toBe(true);
        expect(steps.some((s) => s.step === 'supplySmartDexLp')).toBe(true);

        const supplyStep = steps.find((s) => s.step === 'supplySmartDexLp');
        expect(supplyStep?.params.to).toBe(COLLATERAL_PROVIDER);
        expect(supplyStep?.params.functionName).toBe('supplyDexLp');
    });

    it('should use onBehalf if provided', async () => {
        const onBehalf = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
        const steps = await buildSmartSupplyDexLpSteps(
            {
                chainId: 56,
                lpAmount: 1000n,
                walletAddress: WALLET,
                onBehalf,
            },
            baseSmartConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        const supplyStep = steps.find((s) => s.step === 'supplySmartDexLp');
        expect(supplyStep?.params.args).toContain(onBehalf);
    });

    it('should skip approve when allowance is sufficient', async () => {
        mockReadContract.mockResolvedValue(10000n * 10n ** 18n);

        const steps = await buildSmartSupplyDexLpSteps(
            {
                chainId: 56,
                lpAmount: 100n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseSmartConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        expect(steps.filter((s) => s.step === 'approve')).toHaveLength(0);
        expect(steps.some((s) => s.step === 'supplySmartDexLp')).toBe(true);
    });
});

describe('buildSmartSupplyCollateralSteps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockReadContract.mockResolvedValue(0n);
    });

    it('should build supply collateral steps with both token approvals', async () => {
        const steps = await buildSmartSupplyCollateralSteps(
            {
                chainId: 56,
                tokenAAmount: 500n * 10n ** 18n,
                tokenBAmount: 500n * 10n ** 18n,
                minLpAmount: 900n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseSmartConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        // Should have approvals for both tokens
        const approveSteps = steps.filter((s) => s.step === 'approve');
        expect(approveSteps.length).toBeGreaterThanOrEqual(2);

        expect(steps.some((s) => s.step === 'supplySmartCollateral')).toBe(true);
    });

    it('should skip approval for native token A', async () => {
        const nativeTokenAConfig = {
            ...baseSmartConfig,
            tokenAIsNative: true,
        };

        const steps = await buildSmartSupplyCollateralSteps(
            {
                chainId: 56,
                tokenAAmount: 500n,
                tokenBAmount: 500n,
                minLpAmount: 900n,
                walletAddress: WALLET,
            },
            nativeTokenAConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        // Should include value for native token
        const supplyStep = steps.find((s) => s.step === 'supplySmartCollateral');
        expect(supplyStep?.params.value).toBe(500n);
    });

    it('should skip approval for native token B', async () => {
        const nativeTokenBConfig = {
            ...baseSmartConfig,
            tokenBIsNative: true,
        };

        const steps = await buildSmartSupplyCollateralSteps(
            {
                chainId: 56,
                tokenAAmount: 500n,
                tokenBAmount: 600n,
                minLpAmount: 900n,
                walletAddress: WALLET,
            },
            nativeTokenBConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        const supplyStep = steps.find((s) => s.step === 'supplySmartCollateral');
        expect(supplyStep?.params.value).toBe(600n);
    });
});

describe('buildSmartWithdrawDexLpSteps', () => {
    it('should build withdraw LP step', () => {
        const steps = buildSmartWithdrawDexLpSteps(
            {
                chainId: 56,
                lpAmount: 500n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseSmartConfig,
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].step).toBe('withdrawSmartDexLp');
        expect(steps[0].params.functionName).toBe('withdrawDexLp');
        expect(steps[0].params.to).toBe(COLLATERAL_PROVIDER);
    });

    it('should use receiver if provided', () => {
        const receiver = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
        const steps = buildSmartWithdrawDexLpSteps(
            {
                chainId: 56,
                lpAmount: 500n,
                walletAddress: WALLET,
                receiver,
            },
            baseSmartConfig,
        );

        expect(steps[0].params.args).toContain(receiver);
    });
});

describe('buildSmartWithdrawCollateralSteps', () => {
    it('should build withdraw collateral step', () => {
        const steps = buildSmartWithdrawCollateralSteps(
            {
                chainId: 56,
                tokenAAmount: 300n,
                tokenBAmount: 200n,
                maxLpBurn: 600n,
                walletAddress: WALLET,
            },
            baseSmartConfig,
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].step).toBe('withdrawSmartCollateral');
        expect(steps[0].params.functionName).toBe('withdrawCollateralImbalance');
    });

    it('should use receiver if provided', () => {
        const receiver = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
        const steps = buildSmartWithdrawCollateralSteps(
            {
                chainId: 56,
                tokenAAmount: 300n,
                tokenBAmount: 200n,
                maxLpBurn: 600n,
                walletAddress: WALLET,
                receiver,
            },
            baseSmartConfig,
        );

        expect(steps[0].params.args).toContain(receiver);
    });

    it('should use onBehalf if provided', () => {
        const onBehalf = '0xdddddddddddddddddddddddddddddddddddddddd' as Address;
        const steps = buildSmartWithdrawCollateralSteps(
            {
                chainId: 56,
                tokenAAmount: 300n,
                tokenBAmount: 200n,
                maxLpBurn: 600n,
                walletAddress: WALLET,
                onBehalf,
            },
            baseSmartConfig,
        );

        expect(steps[0].params.args).toContain(onBehalf);
    });
});

describe('buildSmartWithdrawCollateralFixedSteps', () => {
    it('should build withdraw collateral fixed step', () => {
        const steps = buildSmartWithdrawCollateralFixedSteps(
            {
                chainId: 56,
                lpAmount: 500n,
                minTokenAAmount: 200n,
                minTokenBAmount: 200n,
                walletAddress: WALLET,
            },
            baseSmartConfig,
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].step).toBe('withdrawSmartCollateralFixed');
        expect(steps[0].params.functionName).toBe('withdrawCollateral');
    });

    it('should use receiver if provided', () => {
        const receiver = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Address;
        const steps = buildSmartWithdrawCollateralFixedSteps(
            {
                chainId: 56,
                lpAmount: 500n,
                minTokenAAmount: 200n,
                minTokenBAmount: 200n,
                walletAddress: WALLET,
                receiver,
            },
            baseSmartConfig,
        );

        expect(steps[0].params.args).toContain(receiver);
    });

    it('should use onBehalf if provided', () => {
        const onBehalf = '0xffffffffffffffffffffffffffffffffffffffff' as Address;
        const steps = buildSmartWithdrawCollateralFixedSteps(
            {
                chainId: 56,
                lpAmount: 500n,
                minTokenAAmount: 200n,
                minTokenBAmount: 200n,
                walletAddress: WALLET,
                onBehalf,
            },
            baseSmartConfig,
        );

        expect(steps[0].params.args).toContain(onBehalf);
    });
});

describe('buildSmartRepaySteps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockReadContract.mockResolvedValue(0n);
    });

    it('should build repay steps with approval', async () => {
        const steps = await buildSmartRepaySteps(
            {
                chainId: 56,
                assets: 500n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseSmartConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        expect(steps.some((s) => s.step === 'approve')).toBe(true);
        expect(steps.some((s) => s.step === 'repaySmartMarket')).toBe(true);
    });

    it('should handle native loan repay', async () => {
        const nativeLoanConfig = {
            ...baseSmartConfig,
            loanIsNative: true,
        };

        const steps = await buildSmartRepaySteps(
            {
                chainId: 56,
                assets: 500n,
                walletAddress: WALLET,
            },
            nativeLoanConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        // Should not have approve step
        expect(steps.some((s) => s.step === 'approve')).toBe(false);

        const repayStep = steps.find((s) => s.step === 'repaySmartMarket');
        expect(repayStep?.params.to).toBe(LOAN_PROVIDER);
    });

    it('should handle repayAll with user data', async () => {
        const mockUserData = {
            borrowShares: 1000n,
            decimals: { l: 18 },
            _getExtraRepayAmount: () => ({
                roundDown: () => ({ numerator: 1100n * 10n ** 18n }),
            }),
        };

        const steps = await buildSmartRepaySteps(
            {
                chainId: 56,
                repayAll: true,
                walletAddress: WALLET,
            },
            baseSmartConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
            mockUserData as any,
        );

        expect(steps.some((s) => s.step === 'repaySmartMarket')).toBe(true);
    });

    it('should handle repayAll with native loan and user data', async () => {
        const nativeLoanConfig = {
            ...baseSmartConfig,
            loanIsNative: true,
        };

        const mockUserData = {
            borrowShares: 1000n,
            decimals: { l: 18 },
            _getExtraRepayAmount: () => ({
                roundDown: () => ({ numerator: 500n }),
            }),
        };

        const steps = await buildSmartRepaySteps(
            {
                chainId: 56,
                repayAll: true,
                walletAddress: WALLET,
            },
            nativeLoanConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
            mockUserData as any,
        );

        const repayStep = steps.find((s) => s.step === 'repaySmartMarket');
        // Native value should be set for native loan repay
        expect(repayStep?.params.value).toBe(500n);
    });

    it('should use moolah contract when no loan provider', async () => {
        const configNoProvider = {
            ...baseSmartConfig,
            loanProvider: zeroAddress,
        };

        const steps = await buildSmartRepaySteps(
            {
                chainId: 56,
                assets: 500n,
                walletAddress: WALLET,
            },
            configNoProvider,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        const repayStep = steps.find((s) => s.step === 'repaySmartMarket');
        // Should use moolah contract address instead of zero address
        expect(repayStep?.params.to).not.toBe(zeroAddress);
    });
});
