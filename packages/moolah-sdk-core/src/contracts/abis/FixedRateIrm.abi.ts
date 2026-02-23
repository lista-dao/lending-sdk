/**
 * FixedRateIrm ABI - Read-only functions for fixed rate interest model
 *
 * This ABI contains only the functions needed for reading fixed rate data.
 * For write operations, use the full FixedRateIrm ABI.
 */
export const FIXED_RATE_IRM_ABI = [
    {
        inputs: [
            {
                internalType: 'MarketParams',
                name: 'marketParams',
                type: 'tuple',
                components: [
                    { name: 'loanToken', type: 'address' },
                    { name: 'collateralToken', type: 'address' },
                    { name: 'oracle', type: 'address' },
                    { name: 'irm', type: 'address' },
                    { name: 'lltv', type: 'uint256' },
                ],
            },
            {
                internalType: 'Market',
                name: 'market',
                type: 'tuple',
                components: [
                    { name: 'totalSupplyAssets', type: 'uint128' },
                    { name: 'totalSupplyShares', type: 'uint128' },
                    { name: 'totalBorrowAssets', type: 'uint128' },
                    { name: 'totalBorrowShares', type: 'uint128' },
                    { name: 'lastUpdate', type: 'uint128' },
                    { name: 'fee', type: 'uint128' },
                ],
            },
        ],
        name: 'borrowRateView',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;
