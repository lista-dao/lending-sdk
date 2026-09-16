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
  zone?: string | number;
  keyword?: string;
}

/**
 * Chain filter for list APIs.
 * - a chain
 * - chains (serialized as a comma-separated list)
 */
export type ApiChainFilter = "bsc" | "ethereum" | ("bsc" | "ethereum")[];

/**
 * Query params for getVaultList
 */
export interface ApiVaultListParams extends ApiTableParams {
  assets?: string[];
  curators?: string[];
  chain: ApiChainFilter;
}

/**
 * Query params for getMarketList
 */
export interface ApiMarketListParams extends ApiTableParams {
  loans?: string[];
  collaterals?: string[];
  termType?: number;
  smartLendingChecked?: boolean;
  chain: ApiChainFilter;
}

/**
 * Holdings API type filter (/one/holding)
 */
export type ApiHoldingType = "vault" | "market";

/**
 * Query params for getHoldings
 */
export interface ApiHoldingsParams {
  userAddress: Address;
  type: ApiHoldingType;
}

/**
 * Holding item for type=vault
 */
export interface ApiVaultHoldingItem {
  address: Address;
  name: string;
  icon: string;
  assetPrice: string;
  curator: string;
  curatorIcon: string;
  apy: string;
  emissionApy: string;
  chain: string;
  [key: string]: unknown;
}

/**
 * Holding item for type=market (objs)
 */
export interface ApiMarketHoldingItem {
  marketId: string;
  loanToken: string;
  loanIcon: string;
  loanSymbol: string;
  collateralToken: string;
  collateralIcon: string;
  collateralSymbol: string;
  loanPrice: string;
  collateralPrice: string;
  supplyApy: string;
  chain: string;
  zone: number;
  broker: string;
  termType: number;
  emissionDetail: unknown[];
  [key: string]: unknown;
}

/**
 * Holding item for type=market (cdps)
 */
export interface ApiMarketCdpHoldingItem {
  ilk: string;
  collateralType: string;
  collateralToken: string;
  collateralTokenSymbol: string;
  collateralIcon: string;
  lpAddress: string;
  lpSymbol: string;
  lpIcon: string;
  loanToken: string;
  loanTokenSymbol: string;
  loanTokenIcon: string;
  ceCollateralToken: string;
  ceCollateralTokenSymbol: string;
  lltv: string;
  oracle: string;
  provider: string;
  borrowDistributor: string;
  collateralDistributor: string;
  minBorrow: string;
  minDeposit: string;
  borrowRate: string;
  liquidity: string;
  [key: string]: unknown;
}

/**
 * Holdings response data for type=vault
 */
export interface ApiVaultHoldingsData {
  objs: ApiVaultHoldingItem[];
  cdps: unknown[];
  type: "vault";
}

/**
 * Holdings response data for type=market
 */
export interface ApiMarketHoldingsData {
  objs: ApiMarketHoldingItem[];
  cdps: ApiMarketCdpHoldingItem[];
  type: "market";
}

/**
 * Holdings response data (/one/holding)
 */
export type ApiHoldingsData = ApiVaultHoldingsData | ApiMarketHoldingsData;

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

/**
 * A market as returned by the grouped catalogue.
 *
 * The grouped endpoint returns every zone in one response; the flat market
 * list returns one zone per call and defaults to zone 0. Both reach the same
 * markets. `collateralUiMultiplier` appears only here, on the group.
 */
export interface ApiGroupedMarketItem {
  id: string;
  chain: string;
  loanToken?: string;
  collateralToken?: string;
  loan?: string;
  collateral?: string;
  lltv?: string;
  termType?: number;
  zone?: number;
  /**
   * Present on Smart Lending markets. Carries the per-market SmartProvider,
   * which has no address-book entry and cannot be resolved any other way.
   */
  smartCollateralConfig?: {
    provider?: string;
    dexInfo?: string;
    swapPool?: string;
    token0?: string;
    token1?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * One collateral group in the grouped catalogue.
 *
 * The display multiplier lives here, on the collateral, rather than on each
 * market — which is correct, since a split is a property of the token.
 */
export interface ApiMarketGroup {
  collateralToken?: string;
  collateralTokenSymbol?: string;
  collateralPrice?: string;
  /**
   * Decimal string; `"1"` means no split applied. Display only — parse with
   * `parseUiMultiplier` from the `/display` subpath and never let the result
   * near calldata.
   */
  collateralUiMultiplier?: string;
  marketCount?: number;
  chain?: string;
  markets?: ApiGroupedMarketItem[];
  [key: string]: unknown;
}

export interface ApiGroupedMarketList {
  totalGroups?: number;
  totalMarkets?: number;
  groups: ApiMarketGroup[];
  [key: string]: unknown;
}

export interface ApiGroupedMarketListParams {
  page?: number;
  pageSize?: number;
  chain?: ApiChainFilter;
  zone?: number;
  sort?: string;
  order?: "asc" | "desc";
  keyword?: string;
}

/** A position at or past the liquidation threshold. */
export interface ApiLiquidationItem {
  marketId: string;
  user: string;
  collateral: string;
  borrowed: string;
  collateralToken: string;
  collateralSymbol?: string;
  collateralDecimal?: number;
  /** Decimal string. Display only — never scale calldata by this. */
  collateralUiMultiplier?: string;
  loanToken?: string;
  oracle?: string;
  lltv?: string;
  [key: string]: unknown;
}

export interface ApiLiquidationList {
  total: number;
  list: ApiLiquidationItem[];
}

export interface ApiLiquidationListParams {
  page?: number;
  pageSize?: number;
  /** Defaults to "discountRate" — the most profitable targets first. */
  sort?: string;
  order?: "asc" | "desc";
}

export interface ApiCloseToLiquidateParams {
  page?: number;
  pageSize?: number;
  /** Restrict to these collateral token addresses. */
  collaterals?: string[];
  /** Restrict to one borrower. */
  userAddress?: string;
  /** Minimum outstanding debt in USD. */
  loanInUsd?: number;
}
