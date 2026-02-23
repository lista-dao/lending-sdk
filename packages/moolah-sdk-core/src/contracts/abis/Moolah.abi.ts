
import type { Abi } from 'viem';

export const MOOLAH_ABI = [
    {
        inputs: [{ internalType: 'Id', name: '', type: 'bytes32' }],
        name: 'idToMarketParams',
        outputs: [
            { internalType: 'address', name: 'loanToken', type: 'address' },
            { internalType: 'address', name: 'collateralToken', type: 'address' },
            { internalType: 'address', name: 'oracle', type: 'address' },
            { internalType: 'address', name: 'irm', type: 'address' },
            { internalType: 'uint256', name: 'lltv', type: 'uint256' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'Id', name: '', type: 'bytes32' }],
        name: 'market',
        outputs: [
            { internalType: 'uint128', name: 'totalSupplyAssets', type: 'uint128' },
            { internalType: 'uint128', name: 'totalSupplyShares', type: 'uint128' },
            { internalType: 'uint128', name: 'totalBorrowAssets', type: 'uint128' },
            { internalType: 'uint128', name: 'totalBorrowShares', type: 'uint128' },
            { internalType: 'uint128', name: 'lastUpdate', type: 'uint128' },
            { internalType: 'uint128', name: 'fee', type: 'uint128' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'Id', name: '', type: 'bytes32' },
            { internalType: 'address', name: '', type: 'address' },
        ],
        name: 'position',
        outputs: [
            { internalType: 'uint256', name: 'supplyShares', type: 'uint256' },
            { internalType: 'uint128', name: 'borrowShares', type: 'uint128' },
            { internalType: 'uint128', name: 'collateral', type: 'uint128' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'MarketParams',
                name: 'marketParams',
                type: 'tuple',
                components: [
                    { internalType: 'address', name: 'loanToken', type: 'address' },
                    { internalType: 'address', name: 'collateralToken', type: 'address' },
                    { internalType: 'address', name: 'oracle', type: 'address' },
                    { internalType: 'address', name: 'irm', type: 'address' },
                    { internalType: 'uint256', name: 'lltv', type: 'uint256' },
                ],
            },
        ],
        name: 'getPrice',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'MarketParams',
                name: '',
                type: 'tuple',
                components: [
                    { internalType: 'address', name: 'loanToken', type: 'address' },
                    { internalType: 'address', name: 'collateralToken', type: 'address' },
                    { internalType: 'address', name: 'oracle', type: 'address' },
                    { internalType: 'address', name: 'irm', type: 'address' },
                    { internalType: 'uint256', name: 'lltv', type: 'uint256' },
                ],
            },
        ],
        name: 'minLoan',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'Id', name: '', type: 'bytes32' },
            { internalType: 'address', name: '', type: 'address' },
        ],
        name: 'providers',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'Id', name: '', type: 'bytes32' },
            { internalType: 'address', name: '', type: 'address' },
        ],
        name: 'isWhiteList',
        outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
    },
    // Write functions
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
        name: 'supply',
        outputs: [
            { internalType: 'uint256', name: '', type: 'uint256' },
            { internalType: 'uint256', name: '', type: 'uint256' },
        ],
        stateMutability: 'nonpayable',
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
            { internalType: 'address', name: 'onBehalf', type: 'address' },
            { internalType: 'bytes', name: 'data', type: 'bytes' },
        ],
        name: 'supplyCollateral',
        outputs: [],
        stateMutability: 'nonpayable',
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
            { internalType: 'address', name: 'receiver', type: 'address' },
        ],
        name: 'borrow',
        outputs: [
            { internalType: 'uint256', name: '', type: 'uint256' },
            { internalType: 'uint256', name: '', type: 'uint256' },
        ],
        stateMutability: 'nonpayable',
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
            { internalType: 'uint256', name: '', type: 'uint256' },
            { internalType: 'uint256', name: '', type: 'uint256' },
        ],
        stateMutability: 'nonpayable',
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
            { internalType: 'address', name: 'receiver', type: 'address' },
        ],
        name: 'withdraw',
        outputs: [
            { internalType: 'uint256', name: '', type: 'uint256' },
            { internalType: 'uint256', name: '', type: 'uint256' },
        ],
        stateMutability: 'nonpayable',
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
            { internalType: 'address', name: 'onBehalf', type: 'address' },
            { internalType: 'address', name: 'receiver', type: 'address' },
        ],
        name: 'withdrawCollateral',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
] as const satisfies Abi;
