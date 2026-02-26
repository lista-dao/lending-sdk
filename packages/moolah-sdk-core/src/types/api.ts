import type { Address } from "viem";

/**
 * Lista API base response format
 */
export interface ApiBaseResponse<T> {
  code: string;
  msg: string;
  data: T;
  timestamp?: number;
}

/**
 * Table params for paginated API calls
 */
export interface ApiTableParams {
  page: number;
  pageSize: number;
  sort?: string;
  order?: "asc" | "desc";
  zone?: string;
  keyword?: string;
}

/**
 * Vault item from API (getVaultList)
 */
export interface ApiVaultItem {
  address: Address;
  name: string;
  icon: string;
  deposits: string;
  depositsUsd: string;
  asset: Address;
  assetSymbol: string;
  assetIcon?: string;
  displayDecimal: number;
  curator: string;
  curatorIcon: string;
  apy: string;
  emissionApy?: string;
  emissionDetail: Record<string, { apy: string; icon: string; total: string }>;
  emissionEnabled: number;
  collaterals: { name: string; icon: string; id: Address }[];
  zone: number;
  utilization: string;
  chain: string;
  fee?: string;
}

/**
 * Vault list from API
 */
export interface ApiVaultList {
  total: number;
  list: ApiVaultItem[];
}

/**
 * Vault info from API (getVaultInfo - extended metadata)
 */
export interface ApiVaultInfo extends ApiVaultItem {
  description: string;
  descriptionZh?: string;
  curatorX: string;
  curatorUrl: string;
  curatorDesc: string;
  curatorDescZh?: string;
  createAt: number;
  liquidity: string;
  assetPrice: string;
  status: 0 | 1;
  styleType?: number;
}

/**
 * Market item from API (getMarketList)
 */
export interface ApiMarketItem {
  id: string;
  collateral: string;
  icon: string;
  lltv: string;
  liquidity: string;
  liquidityUsd: string;
  loan: string;
  loanIcon: string;
  rate: string;
  supplyApy?: string;
  vaults: { address: Address; name: string; icon: string }[];
  rewards?: { name: string; icon: string; points: string }[];
  zone: number;
  chain: string;
  termType: number;
  terms?: Array<{ id: string; duration: string; apr: string }>;
}

/**
 * Market list from API
 */
export interface ApiMarketList {
  total: number;
  list: ApiMarketItem[];
}

/**
 * Market vault from API (getMarketVaultDetails)
 */
export interface ApiMarketVault {
  address: Address;
  name: string;
  icon: string;
  [key: string]: unknown;
}

/**
 * Market vault list response
 */
export interface ApiMarketVaultList {
  total: number;
  list: ApiMarketVault[];
}
