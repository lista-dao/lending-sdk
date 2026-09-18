import type { Address } from "viem";

export type { Address };

/**
 * NOTE: the `NetworkNames` enum was removed in 2.0.0. It duplicated the
 * `NetworkName` string union in `contracts/types.ts` and had no internal
 * usages. Use the string literals directly: `NetworkNames.bsc` -> `"bsc"`.
 */

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
