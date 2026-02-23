import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PublicClient, Address } from 'viem';
import { buildApproveSteps, ERC20_APPROVE_ABI } from '../../builders/approve';

const mockReadContract = vi.fn();

const mockPublicClient = {
    readContract: mockReadContract,
} as unknown as PublicClient;

const TEST_TOKEN = '0x1234567890123456789012345678901234567890' as Address;
const TEST_SPENDER = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address;
const TEST_OWNER = '0x0000000000000000000000000000000000000001' as Address;

describe('buildApproveSteps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return empty array for zero amount', async () => {
        const steps = await buildApproveSteps(
            {
                chainId: 56,
                owner: TEST_OWNER,
                token: TEST_TOKEN,
                spender: TEST_SPENDER,
                amount: 0n,
            },
            mockPublicClient,
            'bsc',
        );

        expect(steps).toHaveLength(0);
        expect(mockReadContract).not.toHaveBeenCalled();
    });

    it('should return empty array when allowance is sufficient', async () => {
        mockReadContract.mockResolvedValue(1000n);

        const steps = await buildApproveSteps(
            {
                chainId: 56,
                owner: TEST_OWNER,
                token: TEST_TOKEN,
                spender: TEST_SPENDER,
                amount: 500n,
            },
            mockPublicClient,
            'bsc',
        );

        expect(steps).toHaveLength(0);
        expect(mockReadContract).toHaveBeenCalledWith({
            address: TEST_TOKEN,
            abi: ERC20_APPROVE_ABI,
            functionName: 'allowance',
            args: [TEST_OWNER, TEST_SPENDER],
        });
    });

    it('should return approve step when allowance is insufficient', async () => {
        mockReadContract.mockResolvedValue(0n);

        const steps = await buildApproveSteps(
            {
                chainId: 56,
                owner: TEST_OWNER,
                token: TEST_TOKEN,
                spender: TEST_SPENDER,
                amount: 1000n,
            },
            mockPublicClient,
            'bsc',
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].step).toBe('approve');
        expect(steps[0].params.to).toBe(TEST_TOKEN);
        expect(steps[0].params.functionName).toBe('approve');
        expect(steps[0].meta?.amount).toBe(1000n);
        expect(steps[0].meta?.spender).toBe(TEST_SPENDER);
        expect(steps[0].meta?.token).toBe(TEST_TOKEN);
    });

    it('should reset USDT-like tokens before approving', async () => {
        // USDT on BSC
        const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955' as Address;
        mockReadContract.mockResolvedValue(100n); // Has some existing allowance

        const steps = await buildApproveSteps(
            {
                chainId: 56,
                owner: TEST_OWNER,
                token: USDT_ADDRESS,
                spender: TEST_SPENDER,
                amount: 1000n,
            },
            mockPublicClient,
            'bsc',
        );

        // Should have 2 steps: reset to 0, then approve
        expect(steps).toHaveLength(2);

        // First step: reset to 0
        expect(steps[0].step).toBe('approve');
        expect(steps[0].meta?.amount).toBe(0n);
        expect(steps[0].meta?.reset).toBe(true);

        // Second step: approve new amount
        expect(steps[1].step).toBe('approve');
        expect(steps[1].meta?.amount).toBe(1000n);
        expect(steps[1].meta?.reset).toBeUndefined();
    });

    it('should not reset USDT if allowance is zero', async () => {
        const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955' as Address;
        mockReadContract.mockResolvedValue(0n);

        const steps = await buildApproveSteps(
            {
                chainId: 56,
                owner: TEST_OWNER,
                token: USDT_ADDRESS,
                spender: TEST_SPENDER,
                amount: 1000n,
            },
            mockPublicClient,
            'bsc',
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].meta?.reset).toBeUndefined();
    });

    it('should handle string chainId', async () => {
        mockReadContract.mockResolvedValue(0n);

        const steps = await buildApproveSteps(
            {
                chainId: '56',
                owner: TEST_OWNER,
                token: TEST_TOKEN,
                spender: TEST_SPENDER,
                amount: 1000n,
            },
            mockPublicClient,
            'bsc',
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].params.chainId).toBe('56');
    });

    it('should return empty array for negative amount', async () => {
        const steps = await buildApproveSteps(
            {
                chainId: 56,
                owner: TEST_OWNER,
                token: TEST_TOKEN,
                spender: TEST_SPENDER,
                amount: -100n,
            },
            mockPublicClient,
            'bsc',
        );

        expect(steps).toHaveLength(0);
    });

    it('should approve when allowance equals amount (not greater)', async () => {
        mockReadContract.mockResolvedValue(1000n);

        const steps = await buildApproveSteps(
            {
                chainId: 56,
                owner: TEST_OWNER,
                token: TEST_TOKEN,
                spender: TEST_SPENDER,
                amount: 1000n, // Equal to allowance
            },
            mockPublicClient,
            'bsc',
        );

        // allowance >= amount, so no approve needed
        expect(steps).toHaveLength(0);
    });

    it('should approve when allowance is slightly less than amount', async () => {
        mockReadContract.mockResolvedValue(999n);

        const steps = await buildApproveSteps(
            {
                chainId: 56,
                owner: TEST_OWNER,
                token: TEST_TOKEN,
                spender: TEST_SPENDER,
                amount: 1000n,
            },
            mockPublicClient,
            'bsc',
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].step).toBe('approve');
    });
});
