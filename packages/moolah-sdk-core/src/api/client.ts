import type { Address } from "viem";
import type {
  ApiBaseResponse,
  ApiVaultListParams,
  ApiVaultList,
  ApiVaultInfo,
  ApiMarketListParams,
  ApiMarketList,
  ApiMarketVaultList,
  ApiHoldingsParams,
  ApiHoldingsData,
  ApiVaultHoldingsData,
  ApiMarketHoldingsData,
  ApiTableParams,
  ApiGroupedMarketList,
  ApiGroupedMarketListParams,
  ApiLiquidationList,
  ApiLiquidationListParams,
  ApiCloseToLiquidateParams,
} from "../types/api.js";
import type { MarketInfo } from "../types/market.js";
import { LISTA_API_URL } from "../utils/apiChain.js";

const SUCCESS_CODE = "000000000";
const API_PREFIX = "/api/moolah";
const LIQUIDATION_PREFIX = "/api/liquidation/zone";

export type FetchFn = typeof fetch;

export interface MoolahApiClientConfig {
  /** API base URL. Defaults to Lista production API (https://api.lista.org) */
  baseUrl?: string;
  fetch?: FetchFn;
}

/**
 * API client for Lista Moolah backend.
 * Uses standard Lista API paths and response format.
 * For internal: Uses lista-mono API paths and response format.
 */
export class MoolahApiClient {
  private baseUrl: string;
  private fetchFn: FetchFn;

  constructor(config: MoolahApiClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? LISTA_API_URL).replace(/\/$/, "");
    this.fetchFn = config.fetch ?? fetch;
  }

  private async request<T>(
    path: string,
    params?: Record<string, unknown> | URLSearchParams | undefined,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      if (params instanceof URLSearchParams) {
        url.search = params.toString();
      } else {
        Object.entries(params).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== "") {
            url.searchParams.set(k, String(v));
          }
        });
      }
    }

    const res = await this.fetchFn(url.toString(), {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as ApiBaseResponse<T>;
    if (json.code !== SUCCESS_CODE) {
      throw new Error(json.msg ?? `API error: ${json.code}`);
    }

    return json.data as T;
  }

  /**
   * Get market metadata from API
   */
  async getMarketInfo(marketId: Address, chain?: string): Promise<MarketInfo> {
    return this.request<MarketInfo>(`${API_PREFIX}/market/${marketId}`, {
      chain,
    });
  }

  /**
   * Get vault list from API
   */
  async getVaultList(params: ApiVaultListParams): Promise<ApiVaultList> {
    const searchParams = new URLSearchParams();
    searchParams.set("page", String(params.page));
    searchParams.set("pageSize", String(params.pageSize));

    if (Array.isArray(params.chain)) {
      const chains = params.chain.filter(Boolean);
      if (chains.length > 0) searchParams.set("chain", chains.join(","));
    } else if (params.chain) {
      searchParams.set("chain", params.chain);
    }

    if (params.sort) searchParams.set("sort", params.sort);
    if (params.order) searchParams.set("order", params.order);
    if (params.zone !== undefined)
      searchParams.set("zone", String(params.zone));
    if (params.keyword) searchParams.set("keyword", params.keyword);
    for (const asset of params.assets ?? []) {
      if (asset) searchParams.append("assets[]", asset);
    }
    for (const curator of params.curators ?? []) {
      if (curator) searchParams.append("curators[]", curator);
    }

    return this.request<ApiVaultList>(`${API_PREFIX}/vault/list`, searchParams);
  }

  /**
   * Get vault metadata from API
   */
  async getVaultInfo(address: Address): Promise<ApiVaultInfo> {
    return this.request<ApiVaultInfo>(`${API_PREFIX}/vault/info`, { address });
  }

  /**
   * Get market list from API
   */
  async getMarketList(params: ApiMarketListParams): Promise<ApiMarketList> {
    const searchParams = new URLSearchParams();
    searchParams.set("page", String(params.page));
    searchParams.set("pageSize", String(params.pageSize));

    if (Array.isArray(params.chain)) {
      const chains = params.chain.filter(Boolean);
      if (chains.length > 0) searchParams.set("chain", chains.join(","));
    } else if (params.chain) {
      searchParams.set("chain", params.chain);
    }

    if (params.sort) searchParams.set("sort", params.sort);
    if (params.order) searchParams.set("order", params.order);
    if (params.zone !== undefined)
      searchParams.set("zone", String(params.zone));
    if (params.keyword) searchParams.set("keyword", params.keyword);
    for (const loan of params.loans ?? []) {
      if (loan) searchParams.append("loans[]", loan);
    }
    for (const collateral of params.collaterals ?? []) {
      if (collateral) searchParams.append("collaterals[]", collateral);
    }
    if (params.termType !== undefined) {
      searchParams.set("termType", String(params.termType));
    }
    if (params.smartLendingChecked !== undefined) {
      searchParams.set(
        "smartLendingChecked",
        String(params.smartLendingChecked),
      );
    }

    return this.request<ApiMarketList>(
      `${API_PREFIX}/borrow/markets`,
      searchParams,
    );
  }

  /**
   * Get user holdings from API.
   * Supports both vault and market holdings via `type`.
   */
  async getHoldings(
    params: Omit<ApiHoldingsParams, "type"> & { type: "vault" },
  ): Promise<ApiVaultHoldingsData>;
  async getHoldings(
    params: Omit<ApiHoldingsParams, "type"> & { type: "market" },
  ): Promise<ApiMarketHoldingsData>;
  async getHoldings(params: ApiHoldingsParams): Promise<ApiHoldingsData>;
  async getHoldings(params: ApiHoldingsParams): Promise<ApiHoldingsData> {
    return this.request<ApiHoldingsData>(`${API_PREFIX}/one/holding`, {
      userAddress: params.userAddress,
      type: params.type,
    });
  }

  /**
   * Get vaults for a market from API
   */
  async getMarketVaultDetails(
    marketId: Address,
    params?: Omit<ApiTableParams, "zone">,
  ): Promise<ApiMarketVaultList> {
    const searchParams: Record<string, unknown> = {};
    if (params) {
      searchParams.page = params.page;
      searchParams.pageSize = params.pageSize;
      if (params.sort != null) searchParams.sort = params.sort;
      if (params.order != null) searchParams.order = params.order;
      if (params.keyword != null) searchParams.keyword = params.keyword;
    }

    return this.request<ApiMarketVaultList>(
      `${API_PREFIX}/market/vault/${marketId}`,
      Object.keys(searchParams).length > 0 ? searchParams : undefined,
    );
  }

  /**
   * Get the complete market catalogue, grouped by collateral.
   *
   * The difference from {@link getMarketList} is scope, not completeness. The
   * flat endpoint is one zone at a time and defaults to zone 0, so a single
   * call reports 193 of 461 markets on BSC and 11 of 26 on Ethereum — but
   * summing its zones reaches exactly the grouped total on both chains.
   * Nothing is missing from it; it just has to be asked seven times.
   *
   * Prefer this when you want the catalogue in one response, when you need a
   * market's `loanToken` / `collateralToken` addresses or its
   * `totalCollateral`, or when you need `collateralUiMultiplier` — that one
   * hangs off the group, which the flat endpoint has no equivalent of. The
   * flat list carries `smartCollateralConfig` too, and adds `vaults` and
   * `loanIcon`, which the grouped one does not.
   */
  async getGroupedMarkets(
    params: ApiGroupedMarketListParams = {},
  ): Promise<ApiGroupedMarketList> {
    const searchParams = new URLSearchParams();
    if (params.page !== undefined)
      searchParams.set("page", String(params.page));
    if (params.pageSize !== undefined)
      searchParams.set("pageSize", String(params.pageSize));
    if (Array.isArray(params.chain)) {
      const chains = params.chain.filter(Boolean);
      if (chains.length > 0) searchParams.set("chain", chains.join(","));
    } else if (params.chain) {
      searchParams.set("chain", params.chain);
    }
    if (params.zone !== undefined)
      searchParams.set("zone", String(params.zone));
    if (params.sort) searchParams.set("sort", params.sort);
    if (params.order) searchParams.set("order", params.order);
    if (params.keyword) searchParams.set("keyword", params.keyword);

    return this.request<ApiGroupedMarketList>(
      `${API_PREFIX}/borrow/markets/grouped`,
      searchParams,
    );
  }

  /**
   * Get positions that are currently liquidatable.
   *
   * Returns an empty list whenever the protocol is healthy, which is most of
   * the time — an empty result is not an error. For a working set to monitor,
   * use {@link getCloseToLiquidate}.
   */
  async getLiquidationList(
    params: ApiLiquidationListParams = {},
  ): Promise<ApiLiquidationList> {
    return this.request<ApiLiquidationList>(`${LIQUIDATION_PREFIX}/list`, {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      sort: params.sort ?? "discountRate",
      order: params.order ?? "desc",
    });
  }

  /** Get positions approaching the liquidation threshold. */
  async getCloseToLiquidate(
    params: ApiCloseToLiquidateParams = {},
  ): Promise<ApiLiquidationList> {
    const searchParams = new URLSearchParams();
    searchParams.set("page", String(params.page ?? 1));
    searchParams.set("pageSize", String(params.pageSize ?? 20));
    if (params.userAddress) searchParams.set("userAddress", params.userAddress);
    if (params.loanInUsd !== undefined)
      searchParams.set("loanInUsd", String(params.loanInUsd));
    for (const collateral of params.collaterals ?? []) {
      if (collateral) searchParams.append("collaterals[]", collateral);
    }

    return this.request<ApiLiquidationList>(
      `${LIQUIDATION_PREFIX}/closeToLiquidate`,
      searchParams,
    );
  }
}
