import type { Address, Chain, PublicClient } from "viem";
import {
  assertMarketConfigMatchesMarket,
  assertSmartConfigTokens,
  assertVaultConfigAsset,
} from "./configTrust.js";
import { marketIdOf } from "./builders/sharePricing.js";
import { createPublicClient, fallback, http } from "viem";
import { bsc, mainnet } from "viem/chains";
import {
  getContractAddress,
  getContractAddressOptional,
  getApiChain,
  LISTA_API_URL,
  Decimal,
  simulateMarketBorrow,
  simulateMarketRepay,
  toWriteConfig,
  brokerPositionsToUserFixedTermData,
} from "@lista-dao/moolah-sdk-core";
import type {
  MarketExtraInfo,
  MarketInfo,
  MarketUserData,
  UserFixedTermData,
  SmartMarketExtraInfo,
  SmartMarketUserData,
  VaultInfo,
  VaultUserData,
  BrokerUserPositionsData,
  FixedTermAndRate,
  ApiVaultList,
  ApiVaultInfo,
  ApiMarketList,
  ApiMarketVaultList,
  ApiHoldingsParams,
  ApiHoldingsData,
  ApiVaultHoldingsData,
  ApiMarketHoldingsData,
  ApiTableParams,
  ApiVaultListParams,
  ApiGroupedMarketList,
  ApiGroupedMarketListParams,
  ApiLiquidationList,
  ApiLiquidationListParams,
  ApiCloseToLiquidateParams,
  ApiMarketListParams,
  ApiChain,
  NetworkName,
  NetworkContracts,
  SimulateMarketState,
  WriteMarketConfig,
  WriteSmartMarketConfig,
} from "@lista-dao/moolah-sdk-core";

import { MoolahApiClient } from "@lista-dao/moolah-sdk-core";
import { getMarketExtraInfo } from "./read/market/getMarketExtraInfo.js";
import { getMarketUserData } from "./read/market/getMarketUserData.js";
import { getVaultInfo } from "./read/vault/getVaultInfo.js";
import { getVaultUserData } from "./read/vault/getVaultUserData.js";
import { getSmartMarketExtraInfo } from "./read/smart/getSmartMarketExtraInfo.js";
import { getSmartMarketUserData } from "./read/smart/getSmartMarketUserData.js";
import { getBrokerFixedTerms } from "./read/broker/getBrokerFixedTerms.js";
import { getBrokerUserPositions } from "./read/broker/getBrokerUserPositions.js";

import { buildApproveSteps } from "./builders/approve.js";
import {
  buildSupplySteps,
  buildBorrowSteps,
  buildRepaySteps,
  buildWithdrawSteps,
  buildMoolahSupplySteps,
  buildMoolahWithdrawSteps,
  buildFlashLoanSteps,
} from "./builders/market.js";
import {
  buildVaultDepositSteps,
  buildVaultWithdrawSteps,
  buildVaultMintSteps,
} from "./builders/vault.js";
import {
  buildSmartSupplyDexLpSteps,
  buildSmartSupplyCollateralSteps,
  buildSmartWithdrawDexLpSteps,
  buildSmartWithdrawCollateralSteps,
  buildSmartWithdrawCollateralFixedSteps,
  buildSmartRepaySteps,
  buildSmartWithdrawCollateralOneCoinSteps,
  buildRedeemSmartLpCollateralSteps,
} from "./builders/smart.js";
import {
  buildBrokerBorrowSteps,
  buildBrokerRepaySteps,
  buildBrokerRepayAllSteps,
  buildBrokerRefinanceMaturedSteps,
  buildConvertDynamicToFixedSteps,
} from "./builders/broker.js";
import {
  buildLiquidateSteps,
  isLiquidationMarketEnabled,
  quoteLiquidationCost,
} from "./builders/liquidation.js";
import {
  buildSetAuthorizationSteps,
  buildRevokeAuthorizationSteps,
  buildMigrateToFixedTermSteps,
} from "./builders/authorization.js";
import {
  buildAuthorizationTypedData,
  buildCancelSignedAuthorizationTypedData,
  buildSetAuthorizationWithSigSteps,
  getAuthorizationNonce,
  type MoolahAuthorization,
  type AuthorizationSignature,
} from "./builders/authorizationSig.js";

import type {
  MoolahSDKConfig,
  ChainId,
  BuildSupplyParams,
  BuildBorrowParams,
  BuildRepayParams,
  BuildWithdrawParams,
  BuildVaultDepositParams,
  BuildVaultWithdrawParams,
  BuildVaultMintParams,
  BuildMoolahSupplyParams,
  BuildMoolahWithdrawParams,
  BuildFlashLoanParams,
  BuildSmartSupplyDexLpParams,
  BuildSmartSupplyCollateralParams,
  BuildSmartWithdrawDexLpParams,
  BuildSmartWithdrawCollateralParams,
  BuildSmartWithdrawCollateralFixedParams,
  BuildSmartRepayParams,
  BuildSmartWithdrawCollateralOneCoinParams,
  BuildRedeemSmartLpCollateralParams,
  BuildBrokerBorrowParams,
  BuildBrokerRepayParams,
  BuildBrokerRepayAllParams,
  BuildBrokerRefinanceMaturedParams,
  BuildConvertDynamicToFixedParams,
  BuildAuthorizationParams,
  BuildMigrateToFixedTermParams,
  BuildLiquidateParams,
  QuoteLiquidationCostParams,
  MarketRuntimeData,
  SimulateBorrowPositionParams,
  SimulateBorrowPositionResult,
  SimulateRepayPositionParams,
  SimulateRepayPositionResult,
  SdkTransportConfig,
  StepParam,
} from "./types.js";

const CHAIN_ID_TO_NETWORK: Record<string, NetworkName> = {
  "1": "ethereum",
  "56": "bsc",
};

const CHAIN_BY_NETWORK: Record<NetworkName, Chain> = {
  ethereum: mainnet,
  bsc: bsc,
};

const API_CHAIN_TO_NETWORK: Record<ApiChain, NetworkName> = {
  bsc: "bsc",
  ethereum: "ethereum",
};

const EMPTY_TRANSPORT_CONFIG: SdkTransportConfig = {};

function toMarketSimulationState(
  extraInfo: MarketExtraInfo,
): SimulateMarketState {
  return {
    totalSupply: extraInfo.totalSupply,
    totalBorrow: extraInfo.totalBorrow,
    LLTV: extraInfo.LLTV,
    priceRate: extraInfo.priceRate,
    loanDecimals: extraInfo.loanInfo.decimals,
    collateralDecimals: extraInfo.collateralInfo.decimals,
  };
}

export class MoolahSDK {
  private config: MoolahSDKConfig;
  private publicClients = new Map<string, PublicClient>();
  private apiClients = new Map<string, MoolahApiClient>();
  private contracts = new Map<string, Record<string, Address>>();

  constructor(config: MoolahSDKConfig) {
    // Both are optional individually and one of them is required. A config
    // with neither cannot serve any chain, and finding that out on the first
    // read — several calls into an integration — is worse than finding it out
    // here.
    const hasRpc = Object.keys(config.rpcUrls ?? {}).length > 0;
    const hasClients = Object.keys(config.publicClients ?? {}).length > 0;
    if (!hasRpc && !hasClients) {
      throw new Error(
        "MoolahSDK: give it somewhere to read from — either rpcUrls keyed by " +
          "chain id, or publicClients with your own viem clients. Both were " +
          "empty.",
      );
    }

    this.config = config;

    for (const [chainId, client] of Object.entries(
      config.publicClients ?? {},
    )) {
      this.publicClients.set(chainId, client);
    }
  }

  /** Resolve the single production REST host. */
  private getApiBaseUrl(): string {
    return this.config.apiBaseUrl ?? LISTA_API_URL;
  }

  private getApiClient(): MoolahApiClient {
    const baseUrl = this.getApiBaseUrl();
    let client = this.apiClients.get(baseUrl);
    if (!client) {
      client = new MoolahApiClient({ baseUrl });
      this.apiClients.set(baseUrl, client);
    }
    return client;
  }

  /** Reject API chain filters outside the published production surface. */
  private getApiClientForApiChains(
    chain: string | string[] | undefined,
  ): MoolahApiClient {
    const chains = (Array.isArray(chain) ? chain : [chain]).filter(
      (c): c is string => Boolean(c),
    );

    for (const c of chains) {
      if (!Object.prototype.hasOwnProperty.call(API_CHAIN_TO_NETWORK, c)) {
        throw new Error(
          `Unsupported API chain: ${c}. Expected one of ${Object.keys(API_CHAIN_TO_NETWORK).join(", ")}.`,
        );
      }
    }
    return this.getApiClient();
  }

  private getNetwork(chainId: ChainId): NetworkName {
    const id = String(chainId);
    const network = CHAIN_ID_TO_NETWORK[id];
    if (!network) {
      throw new Error(`Unsupported chainId: ${chainId}`);
    }
    return network;
  }

  private getRpcUrls(chainId: ChainId): string[] {
    const id = String(chainId);
    const value = this.config.rpcUrls?.[id];

    const rpcUrls = (Array.isArray(value) ? value : [value]).filter(
      (url): url is string => typeof url === "string" && url.trim().length > 0,
    );
    if (rpcUrls.length === 0) {
      // Name both ways out. This fires per chain, and the usual cause is a
      // caller who supplied `publicClients` for the chains they had in mind
      // and then touched one they did not.
      const known = [
        ...new Set([
          ...Object.keys(this.config.rpcUrls ?? {}),
          ...Object.keys(this.config.publicClients ?? {}),
        ]),
      ].sort();
      throw new Error(
        `No RPC configured for chainId ${chainId}. Add it to rpcUrls, or pass ` +
          `a viem client for it in publicClients. Configured so far: ` +
          `${known.length > 0 ? known.join(", ") : "nothing"}.`,
      );
    }

    return rpcUrls;
  }

  private getTransportConfig(chainId: ChainId): SdkTransportConfig {
    const id = String(chainId);
    return {
      ...EMPTY_TRANSPORT_CONFIG,
      ...(this.config.transport ?? EMPTY_TRANSPORT_CONFIG),
      ...(this.config.transportByChainId?.[id] ?? EMPTY_TRANSPORT_CONFIG),
    };
  }

  /**
   * A market config: derived on-chain, or checked if the caller supplied one.
   *
   * The override is a caching hook and a good one — re-reading a market costs
   * ten calls. What is checked is what resolution cannot recover: that the
   * config describes the market the caller named, and that its token metadata
   * agrees with its own params. The providers are not checked, because the
   * builders no longer read them from here — see `configTrust.ts`.
   */
  private async resolveMarketConfig(params: {
    chainId: ChainId;
    marketId: Address;
    marketInfo?: WriteMarketConfig;
    trustedConfig?: boolean;
  }): Promise<WriteMarketConfig> {
    if (!params.marketInfo) {
      return this.getWriteConfig(params.chainId, params.marketId);
    }
    if (!params.trustedConfig) {
      assertMarketConfigMatchesMarket(params.marketId, params.marketInfo);
    }
    return params.marketInfo;
  }

  /** As {@link resolveMarketConfig}, for a Smart Lending market. */
  private async resolveSmartConfig(params: {
    chainId: ChainId;
    marketId: Address;
    smartConfig?: WriteSmartMarketConfig;
    trustedConfig?: boolean;
  }): Promise<WriteSmartMarketConfig> {
    if (!params.smartConfig) {
      return this.getSmartMarketExtraInfo(params.chainId, params.marketId);
    }
    if (!params.trustedConfig) {
      const publicClient = this.getPublicClient(params.chainId);
      assertMarketConfigMatchesMarket(params.marketId, params.smartConfig);
      // The pool tokens are approval subjects and appear in no market params,
      // so the market-level check cannot see them.
      await assertSmartConfigTokens(
        params.smartConfig,
        publicClient,
        this.getNetwork(params.chainId),
      );
    }
    return params.smartConfig;
  }

  /** As {@link resolveMarketConfig}, for a vault. */
  private async resolveVaultConfig(params: {
    chainId: ChainId;
    vaultAddress: Address;
    vaultInfo?: VaultInfo;
    trustedConfig?: boolean;
  }): Promise<VaultInfo> {
    if (!params.vaultInfo) {
      return this.getVaultInfo(params.chainId, params.vaultAddress);
    }
    if (!params.trustedConfig) {
      await assertVaultConfigAsset(
        params.vaultAddress,
        params.vaultInfo,
        this.getPublicClient(params.chainId),
      );
    }
    return params.vaultInfo;
  }

  private getPublicClient(chainId: ChainId): PublicClient {
    const id = String(chainId);
    const cached = this.publicClients.get(id);
    if (cached) return cached;

    const network = this.getNetwork(chainId);
    const chain = CHAIN_BY_NETWORK[network];
    const rpcUrls = this.getRpcUrls(chainId);
    const transportConfig = this.getTransportConfig(chainId);

    const transports = rpcUrls.map((rpcUrl) =>
      http(rpcUrl, {
        timeout: transportConfig.timeout,
        retryCount: transportConfig.retryCount,
        retryDelay: transportConfig.retryDelay,
      }),
    );

    const client = createPublicClient({
      chain,
      transport: transports.length === 1 ? transports[0] : fallback(transports),
    });

    this.publicClients.set(id, client);
    return client;
  }

  private getContracts(chainId: ChainId): Record<string, Address> {
    const id = String(chainId);
    const cached = this.contracts.get(id);
    if (cached) return cached;

    const network = this.getNetwork(chainId);
    const contracts = {
      moolah: getContractAddress(network, "moolah"),
      interestRateModel: getContractAddress(network, "interestRateModel"),
      fixedRateIrm: getContractAddress(network, "fixedRateIrm"),
      nativeProvider: getContractAddress(network, "nativeProvider"),
      wbnb: getContractAddressOptional(network, "wbnb"),
    };

    this.contracts.set(id, contracts);
    return contracts;
  }

  // ===== Read Methods (Chain) =====

  getApiChain(chainId: ChainId): string {
    const network = this.getNetwork(chainId);
    return getApiChain(network);
  }

  async getMarketExtraInfo(
    chainId: ChainId,
    marketId: Address,
  ): Promise<MarketExtraInfo> {
    const publicClient = this.getPublicClient(chainId);
    const contracts = this.getContracts(chainId);
    const network = this.getNetwork(chainId);
    return getMarketExtraInfo(
      publicClient,
      contracts as unknown as NetworkContracts,
      network,
      marketId,
    );
  }

  async getMarketUserData(
    chainId: ChainId,
    marketId: Address,
    userAddress: Address,
    fixedTermData?: UserFixedTermData,
    marketExtraInfo?: MarketExtraInfo,
  ): Promise<MarketUserData> {
    const publicClient = this.getPublicClient(chainId);
    const contracts = this.getContracts(chainId);
    const extraInfo =
      marketExtraInfo ?? (await this.getMarketExtraInfo(chainId, marketId));
    return getMarketUserData(
      publicClient,
      contracts as unknown as NetworkContracts,
      marketId,
      userAddress,
      extraInfo,
      fixedTermData,
    );
  }

  async getMarketUserDataWithBroker(
    chainId: ChainId,
    marketId: Address,
    userAddress: Address,
    brokerAddress: Address,
    options?: { loanDecimals?: number; marketExtraInfo?: MarketExtraInfo },
  ): Promise<MarketUserData> {
    const [brokerPositions, extraInfo] = await Promise.all([
      this.getBrokerUserPositions(
        chainId,
        brokerAddress,
        userAddress,
        options?.loanDecimals,
      ),
      options?.marketExtraInfo ?? this.getMarketExtraInfo(chainId, marketId),
    ]);
    const fixedTermData = brokerPositionsToUserFixedTermData(brokerPositions);
    return this.getMarketUserData(
      chainId,
      marketId,
      userAddress,
      fixedTermData,
      extraInfo,
    );
  }

  async getWriteConfig(
    chainId: ChainId,
    marketId: Address,
  ): Promise<WriteMarketConfig> {
    const extraInfo = await this.getMarketExtraInfo(chainId, marketId);
    return toWriteConfig(extraInfo);
  }

  async getMarketRuntimeData(
    chainId: ChainId,
    marketId: Address,
    walletAddress: Address,
  ): Promise<MarketRuntimeData> {
    const marketExtraInfo = await this.getMarketExtraInfo(chainId, marketId);
    return {
      marketExtraInfo,
      marketInfo: toWriteConfig(marketExtraInfo),
      userData: await this.getMarketUserData(
        chainId,
        marketId,
        walletAddress,
        undefined,
        marketExtraInfo,
      ),
    };
  }

  async getVaultInfo(
    chainId: ChainId,
    vaultAddress: Address,
  ): Promise<VaultInfo> {
    const publicClient = this.getPublicClient(chainId);
    const contracts = this.getContracts(chainId);
    const network = this.getNetwork(chainId);
    return getVaultInfo(
      publicClient,
      contracts as unknown as NetworkContracts,
      network,
      vaultAddress,
    );
  }

  async getVaultUserData(
    chainId: ChainId,
    vaultAddress: Address,
    userAddress: Address,
    vaultInfo?: VaultInfo,
  ): Promise<VaultUserData> {
    const publicClient = this.getPublicClient(chainId);
    const info = vaultInfo ?? (await this.getVaultInfo(chainId, vaultAddress));
    return getVaultUserData(publicClient, vaultAddress, userAddress, info);
  }

  async getSmartMarketExtraInfo(
    chainId: ChainId,
    marketId: Address,
  ): Promise<SmartMarketExtraInfo> {
    const publicClient = this.getPublicClient(chainId);
    const contracts = this.getContracts(chainId);
    const network = this.getNetwork(chainId);
    return getSmartMarketExtraInfo(
      publicClient,
      contracts as unknown as NetworkContracts,
      network,
      marketId,
    );
  }

  async getSmartMarketUserData(
    chainId: ChainId,
    marketId: Address,
    userAddress: Address,
    extraInfo?: SmartMarketExtraInfo,
  ): Promise<SmartMarketUserData> {
    const publicClient = this.getPublicClient(chainId);
    const contracts = this.getContracts(chainId);
    const info =
      extraInfo ?? (await this.getSmartMarketExtraInfo(chainId, marketId));
    return getSmartMarketUserData(
      publicClient,
      contracts as unknown as NetworkContracts,
      marketId,
      userAddress,
      info,
    );
  }

  async getBrokerFixedTerms(
    chainId: ChainId,
    brokerAddress: Address,
  ): Promise<FixedTermAndRate[]> {
    const publicClient = this.getPublicClient(chainId);
    return getBrokerFixedTerms(publicClient, brokerAddress);
  }

  async getBrokerUserPositions(
    chainId: ChainId,
    brokerAddress: Address,
    userAddress: Address,
    loanDecimals: number = 18,
  ): Promise<BrokerUserPositionsData> {
    const publicClient = this.getPublicClient(chainId);
    const network = this.getNetwork(chainId);
    const rateCalculatorAddress = getContractAddressOptional(
      network,
      "brokerRateCalculator",
    );
    return getBrokerUserPositions(
      publicClient,
      brokerAddress,
      rateCalculatorAddress,
      userAddress,
      loanDecimals,
    );
  }

  // ===== Read Methods (API) =====

  async getMarketInfo(
    chainId: ChainId,
    marketId: Address,
  ): Promise<MarketInfo> {
    return this.getApiClient().getMarketInfo(
      marketId,
      this.getApiChain(chainId),
    );
  }

  async getVaultList(params: ApiVaultListParams): Promise<ApiVaultList> {
    return this.getApiClientForApiChains(params.chain).getVaultList(params);
  }

  async getVaultMetadata(address: Address): Promise<ApiVaultInfo> {
    return this.getApiClient().getVaultInfo(address);
  }

  async getMarketList(params: ApiMarketListParams): Promise<ApiMarketList> {
    return this.getApiClientForApiChains(params.chain).getMarketList(params);
  }

  async getHoldings(
    params: Omit<ApiHoldingsParams, "type"> & { type: "vault" },
  ): Promise<ApiVaultHoldingsData>;
  async getHoldings(
    params: Omit<ApiHoldingsParams, "type"> & { type: "market" },
  ): Promise<ApiMarketHoldingsData>;
  async getHoldings(params: ApiHoldingsParams): Promise<ApiHoldingsData>;
  async getHoldings(params: ApiHoldingsParams): Promise<ApiHoldingsData> {
    if (params.type === "vault") {
      return this.getApiClient().getHoldings({
        userAddress: params.userAddress,
        type: "vault",
      });
    }
    return this.getApiClient().getHoldings({
      userAddress: params.userAddress,
      type: "market",
    });
  }

  /**
   * Get the complete market catalogue, grouped by collateral.
   *
   * One response for every zone. `getMarketList` covers the same markets but
   * one zone per call, defaulting to zone 0 — nothing is missing from it, it
   * just has to be asked seven times. This is the only endpoint carrying
   * `collateralUiMultiplier`, which hangs off the group.
   */
  async getGroupedMarkets(
    params: ApiGroupedMarketListParams = {},
  ): Promise<ApiGroupedMarketList> {
    return this.getApiClientForApiChains(params.chain).getGroupedMarkets(
      params,
    );
  }

  /**
   * Get positions that are currently liquidatable.
   * Empty whenever the protocol is healthy — not an error.
   */
  async getLiquidationList(
    params: ApiLiquidationListParams = {},
  ): Promise<ApiLiquidationList> {
    return this.getApiClient().getLiquidationList(params);
  }

  /** Get positions approaching the liquidation threshold. */
  async getCloseToLiquidate(
    params: ApiCloseToLiquidateParams = {},
  ): Promise<ApiLiquidationList> {
    return this.getApiClient().getCloseToLiquidate(params);
  }

  async getMarketVaultDetails(
    marketId: Address,
    params?: Omit<ApiTableParams, "zone">,
  ): Promise<ApiMarketVaultList> {
    return this.getApiClient().getMarketVaultDetails(marketId, params);
  }

  // ===== Simulate Methods (Market) =====

  async simulateBorrowPosition(
    params: SimulateBorrowPositionParams,
  ): Promise<SimulateBorrowPositionResult> {
    const marketExtraInfo =
      params.marketExtraInfo ??
      (await this.getMarketExtraInfo(params.chainId, params.marketId));
    const userData =
      params.userData ??
      (await this.getMarketUserData(
        params.chainId,
        params.marketId,
        params.walletAddress,
        undefined,
        marketExtraInfo,
      ));

    const simulation = simulateMarketBorrow({
      supplyAmount: new Decimal(
        params.supplyAssets ?? 0n,
        marketExtraInfo.collateralInfo.decimals,
      ),
      borrowAmount: new Decimal(
        params.borrowAssets ?? 0n,
        marketExtraInfo.loanInfo.decimals,
      ),
      userPosition: {
        collateral: userData.collateral,
        borrowed: userData.borrowed,
      },
      marketState: toMarketSimulationState(marketExtraInfo),
    });

    return {
      marketExtraInfo,
      userData,
      simulation,
    };
  }

  async simulateRepayPosition(
    params: SimulateRepayPositionParams,
  ): Promise<SimulateRepayPositionResult> {
    const marketExtraInfo =
      params.marketExtraInfo ??
      (await this.getMarketExtraInfo(params.chainId, params.marketId));
    const userData =
      params.userData ??
      (await this.getMarketUserData(
        params.chainId,
        params.marketId,
        params.walletAddress,
        undefined,
        marketExtraInfo,
      ));

    const simulation = simulateMarketRepay({
      repayAmount: new Decimal(
        params.repayAssets ?? 0n,
        marketExtraInfo.loanInfo.decimals,
      ),
      withdrawAmount: new Decimal(
        params.withdrawAssets ?? 0n,
        marketExtraInfo.collateralInfo.decimals,
      ),
      isRepayAll: Boolean(params.repayAll),
      userPosition: {
        collateral: userData.collateral,
        borrowed: userData.borrowed,
      },
      marketState: toMarketSimulationState(marketExtraInfo),
    });

    return {
      marketExtraInfo,
      userData,
      simulation,
    };
  }

  // ===== Build Methods (Market) =====

  /**
   * Build a standalone ERC-20 approval.
   *
   * The action builders emit their own approvals, so this is for the cases
   * they cannot cover: pre-approving with headroom, or clearing an allowance.
   * Emits nothing when the existing allowance already suffices.
   */
  async buildApproveParams(params: {
    chainId: ChainId;
    owner: Address;
    token: Address;
    spender: Address;
    amount: bigint;
  }): Promise<StepParam[]> {
    return buildApproveSteps(
      params,
      this.getPublicClient(params.chainId),
      this.getNetwork(params.chainId),
    );
  }

  async buildSupplyParams(params: BuildSupplyParams): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const marketInfo = await this.resolveMarketConfig(params);

    return buildSupplySteps(
      {
        chainId: params.chainId,
        assets: params.assets,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
      },
      marketInfo,
      { publicClient, network },
    );
  }

  async buildBorrowParams(params: BuildBorrowParams): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const marketInfo = await this.resolveMarketConfig(params);

    return buildBorrowSteps(
      {
        chainId: params.chainId,
        assets: params.assets,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        receiver: params.receiver,
      },
      marketInfo,
      network,
      this.getPublicClient(params.chainId),
    );
  }

  async buildRepayParams(params: BuildRepayParams): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const marketInfo = await this.resolveMarketConfig(params);

    let userData = params.userData;
    if (params.repayAll && !userData) {
      userData = await this.getMarketUserData(
        params.chainId,
        params.marketId,
        params.walletAddress,
      );
    }

    return buildRepaySteps(
      {
        chainId: params.chainId,
        assets: params.assets,
        shares: params.shares,
        repayAll: params.repayAll,
        keepAllowance: params.keepAllowance,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        nativeValue: params.nativeValue,
      },
      marketInfo,
      { publicClient, network },
      userData,
    );
  }

  async buildWithdrawParams(params: BuildWithdrawParams): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const marketInfo = await this.resolveMarketConfig(params);

    let assets = params.assets ?? 0n;
    if (params.withdrawAll) {
      const userData =
        params.userData ??
        (await this.getMarketUserData(
          params.chainId,
          params.marketId,
          params.walletAddress,
        ));
      assets = userData.withdrawable.roundDown(userData.decimals.c).numerator;
    }

    return buildWithdrawSteps(
      {
        chainId: params.chainId,
        assets,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        receiver: params.receiver,
      },
      marketInfo,
      network,
      this.getPublicClient(params.chainId),
    );
  }

  // ===== Build Methods (Vault) =====

  /**
   * Lend directly to a market, bypassing vaults.
   *
   * `buildSupplyParams` supplies collateral; this is the lending side, earning
   * the market's supply rate with no curator in between.
   */
  async buildMoolahSupplyParams(
    params: BuildMoolahSupplyParams,
  ): Promise<StepParam[]> {
    const marketInfo = await this.resolveMarketConfig(params);

    return buildMoolahSupplySteps(
      {
        chainId: params.chainId,
        assets: params.assets,
        shares: params.shares,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        keepAllowance: params.keepAllowance,
      },
      marketInfo,
      {
        publicClient: this.getPublicClient(params.chainId),
        network: this.getNetwork(params.chainId),
      },
    );
  }

  /** Withdraw a direct-to-market supply position. */
  async buildMoolahWithdrawParams(
    params: BuildMoolahWithdrawParams,
  ): Promise<StepParam[]> {
    const marketInfo = await this.resolveMarketConfig(params);

    return buildMoolahWithdrawSteps(
      {
        chainId: params.chainId,
        assets: params.assets,
        shares: params.shares,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        receiver: params.receiver,
      },
      marketInfo,
      this.getNetwork(params.chainId),
    );
  }

  /**
   * Take a Moolah flash loan. The caller must be a contract implementing
   * `onMoolahFlashLoan` that repays before returning.
   */
  async buildFlashLoanParams(
    params: BuildFlashLoanParams,
  ): Promise<StepParam[]> {
    return buildFlashLoanSteps({
      ...params,
      network: this.getNetwork(params.chainId),
    });
  }

  /** Deposit into a vault for an exact number of shares (ERC-4626 `mint`). */
  /**
   * Mint an exact number of vault shares.
   *
   * The assets-denominated counterpart is {@link buildVaultDepositParams}.
   * Vaults that deposit through a NativeProvider have no mint entry point and
   * are rejected here rather than encoded into a call that cannot work.
   */
  async buildVaultMintParams(
    params: BuildVaultMintParams,
  ): Promise<StepParam[]> {
    const vaultInfo = await this.resolveVaultConfig(params);
    return buildVaultMintSteps(params, vaultInfo, {
      publicClient: this.getPublicClient(params.chainId),
      network: this.getNetwork(params.chainId),
    });
  }

  async buildVaultDepositParams(
    params: BuildVaultDepositParams,
  ): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const vaultInfo = await this.resolveVaultConfig(params);

    return buildVaultDepositSteps(
      {
        chainId: params.chainId,
        vaultAddress: params.vaultAddress,
        assets: params.assets,
        walletAddress: params.walletAddress,
        receiver: params.receiver,
      },
      vaultInfo,
      { publicClient, network },
    );
  }

  async buildVaultWithdrawParams(
    params: BuildVaultWithdrawParams,
  ): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const vaultInfo = await this.resolveVaultConfig(params);

    let userData = params.userData;
    if (params.withdrawAll && !userData) {
      userData = await this.getVaultUserData(
        params.chainId,
        params.vaultAddress,
        params.walletAddress,
        vaultInfo,
      );
    }

    return buildVaultWithdrawSteps(
      {
        chainId: params.chainId,
        vaultAddress: params.vaultAddress,
        assets: params.assets,
        shares: params.shares,
        withdrawAll: params.withdrawAll,
        walletAddress: params.walletAddress,
        receiver: params.receiver,
      },
      vaultInfo,
      { publicClient: this.getPublicClient(params.chainId), network },
      userData,
    );
  }

  // ===== Build Methods (Smart Market) =====

  async buildSmartSupplyDexLpParams(
    params: BuildSmartSupplyDexLpParams,
  ): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const smartConfig = await this.resolveSmartConfig(params);

    return buildSmartSupplyDexLpSteps(
      {
        chainId: params.chainId,
        lpAmount: params.lpAmount,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
      },
      smartConfig,
      { publicClient, network },
    );
  }

  async buildSmartSupplyCollateralParams(
    params: BuildSmartSupplyCollateralParams,
  ): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const smartConfig = await this.resolveSmartConfig(params);

    return buildSmartSupplyCollateralSteps(
      {
        chainId: params.chainId,
        tokenAAmount: params.tokenAAmount,
        tokenBAmount: params.tokenBAmount,
        minLpAmount: params.minLpAmount,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
      },
      smartConfig,
      { publicClient, network },
    );
  }

  async buildSmartWithdrawDexLpParams(
    params: BuildSmartWithdrawDexLpParams,
  ): Promise<StepParam[]> {
    const smartConfig = await this.resolveSmartConfig(params);

    return buildSmartWithdrawDexLpSteps(
      {
        chainId: params.chainId,
        lpAmount: params.lpAmount,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        receiver: params.receiver,
      },
      smartConfig,
      {
        publicClient: this.getPublicClient(params.chainId),
        network: this.getNetwork(params.chainId),
      },
    );
  }

  async buildSmartWithdrawCollateralParams(
    params: BuildSmartWithdrawCollateralParams,
  ): Promise<StepParam[]> {
    const smartConfig = await this.resolveSmartConfig(params);

    return buildSmartWithdrawCollateralSteps(
      {
        chainId: params.chainId,
        tokenAAmount: params.tokenAAmount,
        tokenBAmount: params.tokenBAmount,
        maxLpBurn: params.maxLpBurn,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        receiver: params.receiver,
      },
      smartConfig,
      {
        publicClient: this.getPublicClient(params.chainId),
        network: this.getNetwork(params.chainId),
      },
    );
  }

  async buildSmartWithdrawCollateralFixedParams(
    params: BuildSmartWithdrawCollateralFixedParams,
  ): Promise<StepParam[]> {
    const smartConfig = await this.resolveSmartConfig(params);

    return buildSmartWithdrawCollateralFixedSteps(
      {
        chainId: params.chainId,
        lpAmount: params.lpAmount,
        minTokenAAmount: params.minTokenAAmount,
        minTokenBAmount: params.minTokenBAmount,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        receiver: params.receiver,
      },
      smartConfig,
      {
        publicClient: this.getPublicClient(params.chainId),
        network: this.getNetwork(params.chainId),
      },
    );
  }

  /**
   * Withdraw LP collateral as a single one of the pool's two tokens.
   * The caller absorbs the pool's imbalance cost; `minTokenAmount` bounds it.
   */
  async buildSmartWithdrawCollateralOneCoinParams(
    params: BuildSmartWithdrawCollateralOneCoinParams,
  ): Promise<StepParam[]> {
    const smartConfig = await this.resolveSmartConfig(params);

    return buildSmartWithdrawCollateralOneCoinSteps(
      {
        chainId: params.chainId,
        collateralAmount: params.collateralAmount,
        tokenIndex: params.tokenIndex,
        minTokenAmount: params.minTokenAmount,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        receiver: params.receiver,
      },
      smartConfig,
      {
        publicClient: this.getPublicClient(params.chainId),
        network: this.getNetwork(params.chainId),
      },
    );
  }

  /** Redeem seized LP collateral into the underlying pair. */
  async buildRedeemSmartLpCollateralParams(
    params: BuildRedeemSmartLpCollateralParams,
  ): Promise<StepParam[]> {
    const smartConfig = await this.resolveSmartConfig(params);

    return buildRedeemSmartLpCollateralSteps(
      {
        chainId: params.chainId,
        lpAmount: params.lpAmount,
        minAmount0: params.minAmount0,
        minAmount1: params.minAmount1,
      },
      smartConfig,
      {
        publicClient: this.getPublicClient(params.chainId),
        network: this.getNetwork(params.chainId),
      },
    );
  }

  async buildSmartRepayParams(
    params: BuildSmartRepayParams,
  ): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const smartConfig = await this.resolveSmartConfig(params);

    let userData = params.userData;
    if (params.repayAll && !userData) {
      userData = await this.getSmartMarketUserData(
        params.chainId,
        params.marketId,
        params.walletAddress,
      );
    }

    return buildSmartRepaySteps(
      {
        chainId: params.chainId,
        assets: params.assets,
        shares: params.shares,
        repayAll: params.repayAll,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        nativeValue: params.nativeValue,
        keepAllowance: params.keepAllowance,
      },
      smartConfig,
      { publicClient, network },
      userData,
    );
  }

  // ===== Build Methods (Broker) =====

  /**
   * Quote the loan-token outlay for a liquidation.
   * Moves with the oracle — an approval size, not a settled cost.
   */
  async quoteLiquidationCost(
    params: QuoteLiquidationCostParams,
  ): Promise<bigint> {
    return quoteLiquidationCost(params, {
      publicClient: this.getPublicClient(params.chainId),
      network: this.getNetwork(params.chainId),
    });
  }

  /**
   * Is this market enabled on the public liquidator?
   *
   * The liquidator serves an admin-curated allowlist and refuses everything
   * else with `NotWhitelisted()`. Check this before offering the action.
   */
  async isLiquidationMarketEnabled(
    chainId: ChainId,
    marketId: `0x${string}`,
  ): Promise<boolean> {
    return isLiquidationMarketEnabled(marketId, {
      publicClient: this.getPublicClient(chainId),
      network: this.getNetwork(chainId),
    });
  }

  /**
   * Liquidate an unhealthy position through the public liquidator.
   * Supply exactly one of `seizedAssets` or `repaidShares`.
   * Refuses markets that are not on the liquidator's allowlist.
   */
  async buildLiquidateParams(
    params: BuildLiquidateParams,
  ): Promise<StepParam[]> {
    return buildLiquidateSteps(params, {
      publicClient: this.getPublicClient(params.chainId),
      network: this.getNetwork(params.chainId),
    });
  }

  /**
   * Grant a contract permission to act on your Moolah positions.
   * The grant is standing until revoked.
   */
  async buildSetAuthorizationParams(
    params: BuildAuthorizationParams,
  ): Promise<StepParam[]> {
    return buildSetAuthorizationSteps(params, this.getNetwork(params.chainId));
  }

  /** Withdraw a previously granted authorization. */
  async buildRevokeAuthorizationParams(
    params: BuildAuthorizationParams,
  ): Promise<StepParam[]> {
    return buildRevokeAuthorizationSteps(
      params,
      this.getNetwork(params.chainId),
    );
  }

  /**
   * Move a variable-rate position into a fixed-term market.
   *
   * Emits the authorization step only when it is actually missing, and
   * attaches its revoke as `meta.reversalSteps` so abandoning the sequence
   * after step 0 does not leave a standing grant behind.
   */
  async buildMigrateToFixedTermParams(
    params: BuildMigrateToFixedTermParams,
  ): Promise<StepParam[]> {
    const [outMarket, inMarket] = await Promise.all([
      params.outMarket ??
        this.getWriteConfig(params.chainId, params.outMarketId),
      params.inMarket ?? this.getWriteConfig(params.chainId, params.inMarketId),
    ]);

    // Neither market id appears in the encoded call — the contract takes the
    // params — so a supplied config silently decides which markets are migrated
    // between, while the caller named two others. This one also grants the
    // PositionManager standing control first, so the authorization is given
    // against markets the user was never shown. Binding is pure and free.
    for (const [label, id, config] of [
      ["outMarketId", params.outMarketId, outMarket],
      ["inMarketId", params.inMarketId, inMarket],
    ] as const) {
      const derived = marketIdOf(config.params);
      if (derived.toLowerCase() !== id.toLowerCase()) {
        throw new Error(
          `buildMigrateToFixedTermParams: the config supplied for ${label} ` +
            `describes market ${derived}, not ${id}.`,
        );
      }
    }

    return buildMigrateToFixedTermSteps(
      {
        chainId: params.chainId,
        outMarket,
        inMarket,
        collateralAmount: params.collateralAmount,
        borrowAmount: params.borrowAmount,
        borrowShares: params.borrowShares,
        termId: params.termId,
        walletAddress: params.walletAddress,
      },
      {
        publicClient: this.getPublicClient(params.chainId),
        network: this.getNetwork(params.chainId),
      },
    );
  }

  /**
   * Build the typed data a wallet signs to authorize without a transaction.
   *
   * Moolah's EIP-712 domain carries only chainId and verifyingContract — no
   * name, no version — so the domain here is deliberately minimal.
   */
  buildAuthorizationTypedData(
    chainId: ChainId,
    authorization: MoolahAuthorization,
    options?: { allowUnknownTarget?: boolean; maxTtlSeconds?: bigint },
  ) {
    return buildAuthorizationTypedData(authorization, {
      chainId: Number(chainId),
      network: this.getNetwork(chainId),
      allowUnknownTarget: options?.allowUnknownTarget,
      maxTtlSeconds: options?.maxTtlSeconds,
    });
  }

  /**
   * Cancel a signed authorization that has not landed yet.
   *
   * A plain revoke cannot do this — it does not consume the nonce. This signs a
   * competing authorization at the same nonce; whichever lands first wins. It
   * is a race against whoever holds the outstanding signature.
   */
  async buildCancelSignedAuthorizationTypedData(params: {
    chainId: ChainId;
    authorizer: Address;
    nonce: bigint;
    ttlSeconds?: bigint;
  }) {
    return buildCancelSignedAuthorizationTypedData(
      {
        authorizer: params.authorizer,
        nonce: params.nonce,
        chainId: Number(params.chainId),
        network: this.getNetwork(params.chainId),
        ttlSeconds: params.ttlSeconds,
      },
      { publicClient: this.getPublicClient(params.chainId) },
    );
  }

  /** Read the signer's current authorization nonce. Single use, in order. */
  async getAuthorizationNonce(
    chainId: ChainId,
    authorizer: Address,
  ): Promise<bigint> {
    return getAuthorizationNonce(authorizer, {
      publicClient: this.getPublicClient(chainId),
      network: this.getNetwork(chainId),
    });
  }

  /**
   * Submit a signed authorization. Any account may send it, so the authorizer
   * pays no gas and no standing grant is left waiting on a second transaction.
   */
  async buildSetAuthorizationWithSigParams(params: {
    chainId: ChainId;
    authorization: MoolahAuthorization;
    signature: `0x${string}` | AuthorizationSignature;
    /** Submit a grant to a target the address book does not name. */
    allowUnknownTarget?: boolean;
  }): Promise<StepParam[]> {
    return buildSetAuthorizationWithSigSteps(
      params,
      this.getNetwork(params.chainId),
    );
  }

  async buildBrokerBorrowParams(
    params: BuildBrokerBorrowParams,
  ): Promise<StepParam[]> {
    return buildBrokerBorrowSteps(
      params,
      this.getPublicClient(params.chainId),
      this.getNetwork(params.chainId),
    );
  }

  /**
   * Move part of the flexible leg into a fixed term, inside one broker.
   * One transaction: no authorization, no approval.
   */
  async buildConvertDynamicToFixedParams(
    params: BuildConvertDynamicToFixedParams,
  ): Promise<StepParam[]> {
    return buildConvertDynamicToFixedSteps(
      params,
      this.getPublicClient(params.chainId),
      this.getNetwork(params.chainId),
    );
  }

  /** Roll matured fixed-term positions into fresh terms. */
  async buildBrokerRefinanceMaturedParams(
    params: BuildBrokerRefinanceMaturedParams,
  ): Promise<StepParam[]> {
    return buildBrokerRefinanceMaturedSteps(
      params,
      this.getPublicClient(params.chainId),
      this.getNetwork(params.chainId),
    );
  }

  /** Repay everything owed to a broker — flexible leg and every fixed leg. */
  async buildBrokerRepayAllParams(
    params: BuildBrokerRepayAllParams,
  ): Promise<StepParam[]> {
    return buildBrokerRepayAllSteps(
      params,
      this.getPublicClient(params.chainId),
      this.getNetwork(params.chainId),
    );
  }

  /**
   * Repay one fixed position (`posId`) or the flexible leg (no `posId`).
   *
   * `posId` is the position's own id from `userFixedPositions`, not its index.
   * Size `amount` with headroom — the broker pulls only what is owed, and an
   * exact quote goes stale as interest accrues. See
   * {@link buildBrokerRepaySteps} for the detail.
   */
  async buildBrokerRepayParams(
    params: BuildBrokerRepayParams,
  ): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);

    // Forwarded whole rather than copied field by field: the copy silently
    // dropped `keepAllowance` and `marketId`, so options that exist on the
    // builder were unreachable from the class API.
    return buildBrokerRepaySteps(params, publicClient, network);
  }
}
