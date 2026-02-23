import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PublicClient, Address } from 'viem';
import { zeroAddress } from 'viem';
import {
    buildSupplySteps,
    buildBorrowSteps,
    buildRepaySteps,
    buildWithdrawSteps,
} from '../../builders/market';
import type { WriteMarketConfig } from '@lista-dao/moolah-sdk-core';

const mockReadContract = vi.fn();
const mockPublicClient = {
    readContract: mockReadContract,
} as unknown as PublicClient;

const COLLATERAL_TOKEN = '0x1111111111111111111111111111111111111111' as Address;
const LOAN_TOKEN = '0x2222222222222222222222222222222222222222' as Address;
const WALLET = '0x3333333333333333333333333333333333333333' as Address;
const PROVIDER = '0x4444444444444444444444444444444444444444' as Address;

const baseMarketConfig: WriteMarketConfig = {
    params: {
        loanToken: LOAN_TOKEN,
        collateralToken: COLLATERAL_TOKEN,
        oracle: '0x5555555555555555555555555555555555555555' as Address,
        irm: '0x6666666666666666666666666666666666666666' as Address,
        lltv: 800000000000000000n,
    },
    collateralInfo: { address: COLLATERAL_TOKEN, decimals: 18, symbol: 'COLL' },
    loanInfo: { address: LOAN_TOKEN, decimals: 18, symbol: 'LOAN' },
    collateralProvider: zeroAddress,
    loanProvider: zeroAddress,
    collateralIsNative: false,
    loanIsNative: false,
};

describe('buildSupplySteps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockReadContract.mockResolvedValue(0n);
    });

    it('should build supply steps with approval', async () => {
        const steps = await buildSupplySteps(
            {
                chainId: 56,
                assets: 1000n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseMarketConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        expect(steps.length).toBeGreaterThanOrEqual(1);
        expect(steps.some((s) => s.step === 'approve')).toBe(true);
        expect(steps.some((s) => s.step === 'supply')).toBe(true);
    });

    it('should use onBehalf if provided', async () => {
        const onBehalf = '0x7777777777777777777777777777777777777777' as Address;
        const steps = await buildSupplySteps(
            {
                chainId: 56,
                assets: 1000n,
                walletAddress: WALLET,
                onBehalf,
            },
            baseMarketConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        const supplyStep = steps.find((s) => s.step === 'supply');
        expect(supplyStep?.params.args).toContain(onBehalf);
    });

    it('should use collateralProvider when set', async () => {
        const configWithProvider = {
            ...baseMarketConfig,
            collateralProvider: PROVIDER,
        };

        const steps = await buildSupplySteps(
            {
                chainId: 56,
                assets: 1000n,
                walletAddress: WALLET,
            },
            configWithProvider,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        const supplyStep = steps.find((s) => s.step === 'supply');
        expect(supplyStep?.params.to).toBe(PROVIDER);
    });

    it('should handle native collateral', async () => {
        const nativeConfig = {
            ...baseMarketConfig,
            collateralIsNative: true,
            collateralProvider: PROVIDER,
        };

        const steps = await buildSupplySteps(
            {
                chainId: 56,
                assets: 1000n,
                walletAddress: WALLET,
            },
            nativeConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        // Should not have approve step for native
        expect(steps.some((s) => s.step === 'approve')).toBe(false);
        const supplyStep = steps.find((s) => s.step === 'supply');
        expect(supplyStep?.params.value).toBe(1000n);
    });

    it('should skip approve when allowance is sufficient', async () => {
        mockReadContract.mockResolvedValue(10000n * 10n ** 18n);

        const steps = await buildSupplySteps(
            {
                chainId: 56,
                assets: 100n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseMarketConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        expect(steps.filter((s) => s.step === 'approve')).toHaveLength(0);
        expect(steps.some((s) => s.step === 'supply')).toBe(true);
    });
});

describe('buildBorrowSteps', () => {
    it('should build borrow step', () => {
        const steps = buildBorrowSteps(
            {
                chainId: 56,
                assets: 500n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseMarketConfig,
            'bsc',
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].step).toBe('borrow');
        expect(steps[0].params.functionName).toBe('borrow');
    });

    it('should use receiver if provided', () => {
        const receiver = '0x8888888888888888888888888888888888888888' as Address;
        const steps = buildBorrowSteps(
            {
                chainId: 56,
                assets: 500n,
                walletAddress: WALLET,
                receiver,
            },
            baseMarketConfig,
            'bsc',
        );

        expect(steps[0].params.args).toContain(receiver);
    });

    it('should use loanProvider when set', () => {
        const configWithProvider = {
            ...baseMarketConfig,
            loanProvider: PROVIDER,
        };

        const steps = buildBorrowSteps(
            {
                chainId: 56,
                assets: 500n,
                walletAddress: WALLET,
            },
            configWithProvider,
            'bsc',
        );

        expect(steps[0].params.to).toBe(PROVIDER);
    });
});

describe('buildRepaySteps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockReadContract.mockResolvedValue(0n);
    });

    it('should build repay steps with approval', async () => {
        const steps = await buildRepaySteps(
            {
                chainId: 56,
                assets: 500n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseMarketConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        expect(steps.some((s) => s.step === 'approve')).toBe(true);
        expect(steps.some((s) => s.step === 'repay')).toBe(true);
    });

    it('should handle native loan repay', async () => {
        const nativeConfig = {
            ...baseMarketConfig,
            loanIsNative: true,
            loanProvider: PROVIDER,
            loanInfo: { ...baseMarketConfig.loanInfo, address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as Address },
        };

        const steps = await buildRepaySteps(
            {
                chainId: 56,
                assets: 500n,
                walletAddress: WALLET,
            },
            nativeConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        // Should not have approve step for native
        expect(steps.some((s) => s.step === 'approve')).toBe(false);
        const repayStep = steps.find((s) => s.step === 'repay');
        expect(repayStep?.params.value).toBe(500n);
    });

    it('should handle repayAll with user data', async () => {
        const mockUserData = {
            borrowShares: 1000n,
            decimals: { l: 18 },
            _getExtraRepayAmount: () => ({
                roundDown: () => ({ numerator: 1100n * 10n ** 18n }),
            }),
        };

        const steps = await buildRepaySteps(
            {
                chainId: 56,
                repayAll: true,
                walletAddress: WALLET,
            },
            baseMarketConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
            mockUserData as any,
        );

        expect(steps.some((s) => s.step === 'repay')).toBe(true);
    });

    it('should handle repayAll with native loan and user data', async () => {
        const nativeConfig = {
            ...baseMarketConfig,
            loanIsNative: true,
            loanProvider: PROVIDER,
            loanInfo: { ...baseMarketConfig.loanInfo, address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as Address },
        };

        const mockUserData = {
            borrowShares: 1000n,
            decimals: { l: 18 },
            _getExtraRepayAmount: () => ({
                roundDown: () => ({ numerator: 500n }),
            }),
        };

        const steps = await buildRepaySteps(
            {
                chainId: 56,
                repayAll: true,
                walletAddress: WALLET,
            },
            nativeConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
            mockUserData as any,
        );

        const repayStep = steps.find((s) => s.step === 'repay');
        // Native value should be set for native loan repayAll
        expect(repayStep?.params.value).toBe(500n);
    });

    it('should use shares when provided', async () => {
        const steps = await buildRepaySteps(
            {
                chainId: 56,
                shares: 500n,
                walletAddress: WALLET,
            },
            baseMarketConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        const repayStep = steps.find((s) => s.step === 'repay');
        expect(repayStep?.params.args).toContain(500n);
    });

    it('should skip approve when allowance is sufficient', async () => {
        mockReadContract.mockResolvedValue(10000n * 10n ** 18n);

        const steps = await buildRepaySteps(
            {
                chainId: 56,
                assets: 100n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseMarketConfig,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        expect(steps.filter((s) => s.step === 'approve')).toHaveLength(0);
        expect(steps.some((s) => s.step === 'repay')).toBe(true);
    });

    it('should use loanProvider when not zero address', async () => {
        const configWithProvider = {
            ...baseMarketConfig,
            loanProvider: PROVIDER,
        };

        const steps = await buildRepaySteps(
            {
                chainId: 56,
                assets: 500n,
                walletAddress: WALLET,
            },
            configWithProvider,
            { publicClient: mockPublicClient, network: 'bsc' },
        );

        const repayStep = steps.find((s) => s.step === 'repay');
        expect(repayStep?.params.to).toBe(PROVIDER);
    });
});

describe('buildWithdrawSteps', () => {
    it('should build withdraw step', () => {
        const steps = buildWithdrawSteps(
            {
                chainId: 56,
                assets: 500n * 10n ** 18n,
                walletAddress: WALLET,
            },
            baseMarketConfig,
            'bsc',
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].step).toBe('withdraw');
        expect(steps[0].params.functionName).toBe('withdrawCollateral');
    });

    it('should use receiver if provided', () => {
        const receiver = '0x9999999999999999999999999999999999999999' as Address;
        const steps = buildWithdrawSteps(
            {
                chainId: 56,
                assets: 500n,
                walletAddress: WALLET,
                receiver,
            },
            baseMarketConfig,
            'bsc',
        );

        expect(steps[0].params.args).toContain(receiver);
    });

    it('should use collateralProvider when set', () => {
        const configWithProvider = {
            ...baseMarketConfig,
            collateralProvider: PROVIDER,
        };

        const steps = buildWithdrawSteps(
            {
                chainId: 56,
                assets: 500n,
                walletAddress: WALLET,
            },
            configWithProvider,
            'bsc',
        );

        expect(steps[0].params.to).toBe(PROVIDER);
    });
});
