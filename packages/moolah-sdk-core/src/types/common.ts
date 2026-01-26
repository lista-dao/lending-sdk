import type { Address } from 'viem';

export type { Address };

/**
 * Network names supported by Moolah SDK
 */
export enum NetworkNames {
    bsc = 'bsc',
    ethereum = 'ethereum',
    bscTestnet = 'bscTestnet',
    sepolia = 'sepolia',
}

/**
 * Token information structure
 */
export interface TokenInfo {
    address: Address;
    symbol: string;
    decimals: number;
}
