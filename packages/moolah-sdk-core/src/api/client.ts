import type { Address } from "viem";
import type {
  ApiBaseResponse,
  ApiTableParams,
  ApiVaultList,
  ApiVaultInfo,
  ApiMarketList,
  ApiMarketVaultList,
} from "../types/api";
import type { MarketInfo } from "../types/market";
import { LISTA_API_URLS } from "../utils/apiChain";

const SUCCESS_CODE = "000000000";
const API_PREFIX = "/api/moolah";

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
    this.baseUrl = (config.baseUrl ?? LISTA_API_URLS.prod).replace(/\/$/, "");
    this.fetchFn = config.fetch ?? fetch;
  }

  private async request<T>(
    path: string,
    params?: Record<string, unknown> | undefined,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      });
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
  async getMarketInfo(marketId: Address): Promise<MarketInfo> {
    return this.request<MarketInfo>(`${API_PREFIX}/market/${marketId}`);
  }

  /**
   * Get vault list from API
   */
  async getVaultList(
    params: ApiTableParams & {
      assets?: string[];
      curators?: string[];
      chain: string;
    },
  ): Promise<ApiVaultList> {
    const searchParams: Record<string, unknown> = {
      page: params.page,
      pageSize: params.pageSize,
      chain: params.chain,
    };
    if (params.sort) searchParams.sort = params.sort;
    if (params.order) searchParams.order = params.order;
    if (params.zone !== undefined) searchParams.zone = params.zone;
    if (params.keyword) searchParams.keyword = params.keyword;
    if (params.assets?.length) searchParams.assets = params.assets.join(",");
    if (params.curators?.length)
      searchParams.curators = params.curators.join(",");

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
  async getMarketList(
    params: ApiTableParams & {
      loans?: string[];
      collaterals?: string[];
      termType?: number;
      chain: string;
    },
  ): Promise<ApiMarketList> {
    const searchParams: Record<string, unknown> = {
      page: params.page,
      pageSize: params.pageSize,
      chain: params.chain,
    };
    if (params.sort) searchParams.sort = params.sort;
    if (params.order) searchParams.order = params.order;
    if (params.zone !== undefined) searchParams.zone = params.zone;
    if (params.keyword) searchParams.keyword = params.keyword;
    if (params.loans?.length) searchParams.loans = params.loans.join(",");
    if (params.collaterals?.length)
      searchParams.collaterals = params.collaterals.join(",");
    if (params.termType !== undefined) searchParams.termType = params.termType;

    return this.request<ApiMarketList>(
      `${API_PREFIX}/borrow/markets`,
      searchParams,
    );
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
}
