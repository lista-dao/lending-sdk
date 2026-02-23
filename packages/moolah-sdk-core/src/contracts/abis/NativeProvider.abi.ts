
import type { Abi } from 'viem';

export const NATIVE_PROVIDER_ABI = [
    {
        inputs: [
            {
                components: [
                    { internalType: 'address', name: 'loanToken', type: 'address' },
                    { internalType: 'address', name: 'collateralToken', type: 'address' },
                    { internalType: 'address', name: 'oracle', type: 'address' },
                    { internalType: 'address', name: 'irm', type: 'address' },
                    { internalType: 'uint256', name: 'lltv', type: 'uint256' },
                ],
                internalType: 'struct MarketParams',
                name: 'marketParams',
                type: 'tuple',
            },
            { internalType: 'address', name: 'onBehalf', type: 'address' },
            { internalType: 'bytes', name: 'data', type: 'bytes' },
        ],
        name: 'supplyCollateral',
        outputs: [],
        stateMutability: 'payable',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    { internalType: 'address', name: 'loanToken', type: 'address' },
                    { internalType: 'address', name: 'collateralToken', type: 'address' },
                    { internalType: 'address', name: 'oracle', type: 'address' },
                    { internalType: 'address', name: 'irm', type: 'address' },
                    { internalType: 'uint256', name: 'lltv', type: 'uint256' },
                ],
                internalType: 'struct MarketParams',
                name: 'marketParams',
                type: 'tuple',
            },
            { internalType: 'uint256', name: 'assets', type: 'uint256' },
            { internalType: 'uint256', name: 'shares', type: 'uint256' },
            { internalType: 'address', name: 'onBehalf', type: 'address' },
            { internalType: 'bytes', name: 'data', type: 'bytes' },
        ],
        name: 'repay',
        outputs: [
            { internalType: 'uint256', name: '_assets', type: 'uint256' },
            { internalType: 'uint256', name: '_shares', type: 'uint256' },
        ],
        stateMutability: 'payable',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'address', name: 'vault', type: 'address' },
            { internalType: 'address', name: 'receiver', type: 'address' },
        ],
        name: 'deposit',
        outputs: [{ internalType: 'uint256', name: 'shares', type: 'uint256' }],
        stateMutability: 'payable',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'address', name: 'vault', type: 'address' },
            { internalType: 'uint256', name: 'assets', type: 'uint256' },
            { internalType: 'address payable', name: 'receiver', type: 'address' },
            { internalType: 'address', name: 'owner', type: 'address' },
        ],
        name: 'withdraw',
        outputs: [{ internalType: 'uint256', name: 'shares', type: 'uint256' }],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'address', name: 'vault', type: 'address' },
            { internalType: 'uint256', name: 'shares', type: 'uint256' },
            { internalType: 'address payable', name: 'receiver', type: 'address' },
            { internalType: 'address', name: 'owner', type: 'address' },
        ],
        name: 'redeem',
        outputs: [{ internalType: 'uint256', name: 'assets', type: 'uint256' }],
        stateMutability: 'nonpayable',
        type: 'function',
    },
] as const satisfies Abi;
