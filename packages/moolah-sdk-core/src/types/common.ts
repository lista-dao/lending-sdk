import type { Address } from 'viem';

export type { Address };

/**
 * Network names supported by Moolah SDK
 */
export enum NetworkNames {
    bsc = 'bsc',
    ethereum = 'ethereum',
    // bscTestnet = 'bscTestnet',
    // sepolia = 'sepolia',
}

/**
 * Token information structure
 */
export interface TokenInfo {
    address: Address;
    symbol: string;
    decimals: number;
    /** Token name (optional, not always needed) */
    name?: string;
}


/**
 * Default rate cap for interest rate model (per-second rate)
 * Used when rateCap returns 0 from contract
 */
export const DEFAULT_RATE_CAP = 9512937595n;
