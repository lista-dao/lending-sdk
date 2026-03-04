import type { Address, Chain, PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { bsc, mainnet } from "viem/chains";
import {
  getContractAddress,
  getContractAddressOptional,
  getApiChain,
  LISTA_API_URLS,
  toWriteConfig,
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
  ApiMarketListParams,
  NetworkName,
  NetworkContracts,
  WriteMarketConfig,
} from "@lista-dao/moolah-sdk-core";

import { MoolahApiClient } from "@lista-dao/moolah-sdk-core";
import { getMarketExtraInfo } from "./read/market/getMarketExtraInfo";
import { getMarketUserData } from "./read/market/getMarketUserData";
import { getVaultInfo } from "./read/vault/getVaultInfo";
import { getVaultUserData } from "./read/vault/getVaultUserData";
import { getSmartMarketExtraInfo } from "./read/smart/getSmartMarketExtraInfo";
import { getSmartMarketUserData } from "./read/smart/getSmartMarketUserData";
import { getBrokerFixedTerms } from "./read/broker/getBrokerFixedTerms";
import { getBrokerUserPositions } from "./read/broker/getBrokerUserPositions";

import {
  buildSupplySteps,
  buildBorrowSteps,
  buildRepaySteps,
  buildWithdrawSteps,
} from "./builders/market";
import {
  buildVaultDepositSteps,
  buildVaultWithdrawSteps,
} from "./builders/vault";
import {
  buildSmartSupplyDexLpSteps,
  buildSmartSupplyCollateralSteps,
  buildSmartWithdrawDexLpSteps,
  buildSmartWithdrawCollateralSteps,
  buildSmartWithdrawCollateralFixedSteps,
  buildSmartRepaySteps,
} from "./builders/smart";
import {
  buildBrokerBorrowSteps,
  buildBrokerRepaySteps,
} from "./builders/broker";

import type {
  MoolahSDKConfig,
  ChainId,
  BuildSupplyParams,
  BuildBorrowParams,
  BuildRepayParams,
  BuildWithdrawParams,
  BuildVaultDepositParams,
  BuildVaultWithdrawParams,
  BuildSmartSupplyDexLpParams,
  BuildSmartSupplyCollateralParams,
  BuildSmartWithdrawDexLpParams,
  BuildSmartWithdrawCollateralParams,
  BuildSmartWithdrawCollateralFixedParams,
  BuildSmartRepayParams,
  BuildBrokerBorrowParams,
  BuildBrokerRepayParams,
  StepParam,
} from "./types";

const CHAIN_ID_TO_NETWORK: Record<string, NetworkName> = {
  "1": "ethereum",
  "56": "bsc",
  // '97': 'bscTestnet',
  // '11155111': 'sepolia',
};

const CHAIN_BY_NETWORK: Record<NetworkName, Chain> = {
  ethereum: mainnet,
  bsc: bsc,
  // bscTestnet: bscTestnet,
  // sepolia: sepolia,
};

export class MoolahSDK {
  private config: MoolahSDKConfig;
  private publicClients = new Map<string, PublicClient>();
  private apiClient: MoolahApiClient;
  private contracts = new Map<string, Record<string, Address>>();

  constructor(config: MoolahSDKConfig) {
    this.config = config;

    const apiBaseUrl = config.apiBaseUrl ?? LISTA_API_URLS.prod;
    this.apiClient = new MoolahApiClient({ baseUrl: apiBaseUrl });
  }

  private getNetwork(chainId: ChainId): NetworkName {
    const id = String(chainId);
    const network = CHAIN_ID_TO_NETWORK[id];
    if (!network) {
      throw new Error(`Unsupported chainId: ${chainId}`);
    }
    return network;
  }

  private getRpcUrl(chainId: ChainId): string {
    const id = String(chainId);
    const rpcUrl = this.config.rpcUrls[id];
    if (!rpcUrl) {
      throw new Error(`RPC URL not configured for chainId ${chainId}`);
    }
    return rpcUrl;
  }

  private getPublicClient(chainId: ChainId): PublicClient {
    const id = String(chainId);
    const cached = this.publicClients.get(id);
    if (cached) return cached;

    const network = this.getNetwork(chainId);
    const rpcUrl = this.getRpcUrl(chainId);
    const chain = CHAIN_BY_NETWORK[network];

    const client = createPublicClient({
      chain,
      transport: http(rpcUrl),
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

  async getWriteConfig(
    chainId: ChainId,
    marketId: Address,
  ): Promise<WriteMarketConfig> {
    const extraInfo = await this.getMarketExtraInfo(chainId, marketId);
    return toWriteConfig(extraInfo);
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
    return this.apiClient.getMarketInfo(marketId);
  }

  async getVaultList(params: ApiVaultListParams): Promise<ApiVaultList> {
    return this.apiClient.getVaultList(params);
  }

  async getVaultMetadata(address: Address): Promise<ApiVaultInfo> {
    return this.apiClient.getVaultInfo(address);
  }

  async getMarketList(params: ApiMarketListParams): Promise<ApiMarketList> {
    return this.apiClient.getMarketList(params);
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
      return this.apiClient.getHoldings({
        userAddress: params.userAddress,
        type: "vault",
      });
    }
    return this.apiClient.getHoldings({
      userAddress: params.userAddress,
      type: "market",
    });
  }

  async getMarketVaultDetails(
    marketId: Address,
    params?: Omit<ApiTableParams, "zone">,
  ): Promise<ApiMarketVaultList> {
    return this.apiClient.getMarketVaultDetails(marketId, params);
  }

  // ===== Build Methods (Market) =====

  async buildSupplyParams(params: BuildSupplyParams): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const marketInfo =
      params.marketInfo ??
      (await this.getWriteConfig(params.chainId, params.marketId));

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
    const marketInfo =
      params.marketInfo ??
      (await this.getWriteConfig(params.chainId, params.marketId));

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
    );
  }

  async buildRepayParams(params: BuildRepayParams): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const marketInfo =
      params.marketInfo ??
      (await this.getWriteConfig(params.chainId, params.marketId));

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
    const marketInfo =
      params.marketInfo ??
      (await this.getWriteConfig(params.chainId, params.marketId));

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
    );
  }

  // ===== Build Methods (Vault) =====

  async buildVaultDepositParams(
    params: BuildVaultDepositParams,
  ): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const vaultInfo =
      params.vaultInfo ??
      (await this.getVaultInfo(params.chainId, params.vaultAddress));

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
    const vaultInfo =
      params.vaultInfo ??
      (await this.getVaultInfo(params.chainId, params.vaultAddress));

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
      network,
      userData,
    );
  }

  // ===== Build Methods (Smart Market) =====

  async buildSmartSupplyDexLpParams(
    params: BuildSmartSupplyDexLpParams,
  ): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const smartConfig =
      params.smartConfig ??
      (await this.getSmartMarketExtraInfo(params.chainId, params.marketId));

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
    const smartConfig =
      params.smartConfig ??
      (await this.getSmartMarketExtraInfo(params.chainId, params.marketId));

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
    const smartConfig =
      params.smartConfig ??
      (await this.getSmartMarketExtraInfo(params.chainId, params.marketId));

    return buildSmartWithdrawDexLpSteps(
      {
        chainId: params.chainId,
        lpAmount: params.lpAmount,
        walletAddress: params.walletAddress,
        onBehalf: params.onBehalf,
        receiver: params.receiver,
      },
      smartConfig,
    );
  }

  async buildSmartWithdrawCollateralParams(
    params: BuildSmartWithdrawCollateralParams,
  ): Promise<StepParam[]> {
    const smartConfig =
      params.smartConfig ??
      (await this.getSmartMarketExtraInfo(params.chainId, params.marketId));

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
    );
  }

  async buildSmartWithdrawCollateralFixedParams(
    params: BuildSmartWithdrawCollateralFixedParams,
  ): Promise<StepParam[]> {
    const smartConfig =
      params.smartConfig ??
      (await this.getSmartMarketExtraInfo(params.chainId, params.marketId));

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
    );
  }

  async buildSmartRepayParams(
    params: BuildSmartRepayParams,
  ): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);
    const smartConfig =
      params.smartConfig ??
      (await this.getSmartMarketExtraInfo(params.chainId, params.marketId));

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
      },
      smartConfig,
      { publicClient, network },
      userData,
    );
  }

  // ===== Build Methods (Broker) =====

  async buildBrokerBorrowParams(
    params: BuildBrokerBorrowParams,
  ): Promise<StepParam[]> {
    return buildBrokerBorrowSteps({
      chainId: params.chainId,
      brokerAddress: params.brokerAddress,
      amount: params.amount,
      termId: params.termId,
    });
  }

  async buildBrokerRepayParams(
    params: BuildBrokerRepayParams,
  ): Promise<StepParam[]> {
    const network = this.getNetwork(params.chainId);
    const publicClient = this.getPublicClient(params.chainId);

    return buildBrokerRepaySteps(
      {
        chainId: params.chainId,
        brokerAddress: params.brokerAddress,
        amount: params.amount,
        posId: params.posId,
        onBehalf: params.onBehalf,
        loanToken: params.loanToken,
        walletAddress: params.walletAddress,
      },
      publicClient,
      network,
    );
  }
}
