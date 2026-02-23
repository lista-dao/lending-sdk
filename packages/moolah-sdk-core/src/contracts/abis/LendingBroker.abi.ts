import type { Abi } from 'viem';

/**
 * LendingBroker ABI - for fixed term lending operations
 */
export const LENDING_BROKER_ABI = [
    // Read functions
    {
        inputs: [],
        name: 'MARKET_ID',
        outputs: [{ internalType: 'Id', name: '', type: 'bytes32' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'LOAN_TOKEN',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'COLLATERAL_TOKEN',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'rateCalculator',
        outputs: [{ internalType: 'address', name: '', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'getFixedTerms',
        outputs: [
            {
                components: [
                    { internalType: 'uint256', name: 'termId', type: 'uint256' },
                    { internalType: 'uint256', name: 'duration', type: 'uint256' },
                    { internalType: 'uint256', name: 'apr', type: 'uint256' },
                ],
                internalType: 'struct FixedTermAndRate[]',
                name: '',
                type: 'tuple[]',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
        name: 'userFixedPositions',
        outputs: [
            {
                components: [
                    { internalType: 'uint256', name: 'posId', type: 'uint256' },
                    { internalType: 'uint256', name: 'principal', type: 'uint256' },
                    { internalType: 'uint256', name: 'apr', type: 'uint256' },
                    { internalType: 'uint256', name: 'start', type: 'uint256' },
                    { internalType: 'uint256', name: 'end', type: 'uint256' },
                    { internalType: 'uint256', name: 'lastRepaidTime', type: 'uint256' },
                    { internalType: 'uint256', name: 'interestRepaid', type: 'uint256' },
                    { internalType: 'uint256', name: 'principalRepaid', type: 'uint256' },
                ],
                internalType: 'struct FixedLoanPosition[]',
                name: '',
                type: 'tuple[]',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
        name: 'userDynamicPosition',
        outputs: [
            {
                components: [
                    { internalType: 'uint256', name: 'principal', type: 'uint256' },
                    { internalType: 'uint256', name: 'normalizedDebt', type: 'uint256' },
                ],
                internalType: 'struct DynamicLoanPosition',
                name: '',
                type: 'tuple',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'address', name: 'user', type: 'address' },
            { internalType: 'uint256', name: 'amount', type: 'uint256' },
            { internalType: 'uint256', name: 'posId', type: 'uint256' },
        ],
        name: 'previewRepayFixedLoanPosition',
        outputs: [
            { internalType: 'uint256', name: 'interestRepaid', type: 'uint256' },
            { internalType: 'uint256', name: 'penalty', type: 'uint256' },
            { internalType: 'uint256', name: 'principalRepaid', type: 'uint256' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    // Write functions
    {
        inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
        name: 'borrow',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'uint256', name: 'amount', type: 'uint256' },
            { internalType: 'uint256', name: 'termId', type: 'uint256' },
        ],
        name: 'borrow',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'uint256', name: 'amount', type: 'uint256' },
            { internalType: 'address', name: 'onBehalf', type: 'address' },
        ],
        name: 'repay',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'uint256', name: 'amount', type: 'uint256' },
            { internalType: 'uint256', name: 'posId', type: 'uint256' },
            { internalType: 'address', name: 'onBehalf', type: 'address' },
        ],
        name: 'repay',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
] as const satisfies Abi;

/**
 * BrokerRateCalculator ABI - for getting dynamic rate
 */
export const BROKER_RATE_CALCULATOR_ABI = [
    {
        inputs: [{ internalType: 'address', name: 'broker', type: 'address' }],
        name: 'getRate',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const satisfies Abi;
