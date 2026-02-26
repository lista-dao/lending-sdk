import type { Address } from "viem";
import type { Decimal } from "../utils/decimal";

/**
 * Vault asset information
 */
export interface VaultAssetInfo {
  symbol: string;
  decimals: number;
  address: Address;
}

/**
 * Vault basic information from chain
 */
export interface VaultInfo {
  assetInfo: VaultAssetInfo;
  totalAssets: Decimal;
  totalSupply: Decimal;
  isNative: boolean;
  isProvider: boolean;
  provider: Address;
}

/**
 * User's vault data
 */
export interface VaultUserData {
  locked: Decimal;
  shares: Decimal;
  balance: Decimal;
  assetInfo: VaultAssetInfo;
  isWhiteList: boolean;
}

/**
 * Vault basic information from API
 */
export interface VaultBasicInfo {
  address: Address;
  name: string;
  icon: string;
  deposits: string;
  asset: Address;
  assetSymbol: string;
  assetIcon?: string;
  displayDecimal: number;
  curator: string;
  curatorIcon: string;
  apy: number;
  emissionApy: number;
  emissionDetail: Record<
    string,
    {
      apy: string;
      icon: string;
      total: string;
    }
  >;
  emissionEnabled: boolean;
  collaterals: { name: string; icon: string; id: Address }[];
  zone: number;
  utilization: string;
  chain: string;
  fee?: string;
  totalAPY: number;
}

/**
 * Vault extra information from chain
 */
export interface VaultExtraInfo {
  fee: bigint;
  feeRecipient: Address;
  curator?: Address;
  owner?: Address;
  guardian?: Address;
  allocators: Address[];
}
