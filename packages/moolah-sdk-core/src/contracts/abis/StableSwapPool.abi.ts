import type { Abi } from 'viem';

/**
 * StableSwapPool ABI - for LP pool operations
 */
export const STABLE_SWAP_POOL_ABI = [
    {
        inputs: [],
        name: 'A',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'uint256', name: 'i', type: 'uint256' }],
        name: 'balances',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'fee',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const satisfies Abi;

/**
 * StableSwapLP ABI - for LP token
 */
export const STABLE_SWAP_LP_ABI = [
    {
        inputs: [],
        name: 'totalSupply',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const satisfies Abi;
