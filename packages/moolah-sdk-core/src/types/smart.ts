import type { Address } from "viem";
import type { Decimal } from "../utils/decimal.js";
import type { TokenInfo } from "./common.js";

export type { SmartMarketUserData, SmartMarketInfo } from "./market.js";

/**
 * Smart Market extra info from chain
 * Contains all data needed for Smart Lending operations
 */
export interface SmartMarketExtraInfo {
  // Market params
  LLTV: Decimal;
  lastUpdate: bigint;
  params: {
    loanToken: Address;
    collateralToken: Address;
    oracle: Address;
    irm: Address;
    lltv: bigint;
  };
  // Supply/Borrow totals
  totalSupply: Decimal;
  totalBorrow: Decimal;
  totalSupplyAssets: bigint;
  totalBorrowShares: bigint;
  totalBorrowAssets: bigint;
  remaining: Decimal;
  minLoan: Decimal;
  feeRate: Decimal;
  utilRate: Decimal;
  borrowRate: Decimal;
  priceRate: Decimal;
  rateCap: bigint;
  rateFloor: bigint;
  rateAtTarget: bigint;
  rateView: bigint;
  // Provider addresses
  loanProvider: Address;
  collateralProvider: Address;
  // Native token flags
  loanIsNative: boolean;
  tokenAIsNative: boolean;
  tokenBIsNative: boolean;
  collateralIsNative: boolean;
  // Token info
  lpInfo: TokenInfo;
  loanInfo: TokenInfo;
  tokenAInfo: TokenInfo;
  tokenBInfo: TokenInfo;
  // LP pool data
  balances: [Decimal, Decimal];
  totalLp: Decimal;
  proportion: Decimal;
  stablePool: Address;
  LPToken: Address;
  stablePoolTool: Address;
  // StableSwap pool parameters (for accurate LP math)
  amplifier: bigint;
  poolFee: bigint;
}

/**
 * Write config for Smart Market operations
 */
export interface WriteSmartMarketConfig {
  params: {
    loanToken: Address;
    collateralToken: Address;
    oracle: Address;
    irm: Address;
    lltv: bigint;
  };
  collateralProvider: Address;
  loanProvider: Address;
  loanIsNative: boolean;
  tokenAIsNative: boolean;
  tokenBIsNative: boolean;
  lpInfo: TokenInfo;
  loanInfo: TokenInfo;
  tokenAInfo: TokenInfo;
  tokenBInfo: TokenInfo;
}
