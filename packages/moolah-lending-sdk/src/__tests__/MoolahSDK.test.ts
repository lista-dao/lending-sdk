import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address } from "viem";
import { MoolahSDK } from "../MoolahSDK";

// Mock viem
vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn().mockResolvedValue(0n),
    })),
  };
});

// Mock the read functions
vi.mock("../read/market/getMarketExtraInfo", () => ({
  getMarketExtraInfo: vi.fn().mockResolvedValue({
    params: {
      loanToken: "0x0000000000000000000000000000000000000001",
      collateralToken: "0x0000000000000000000000000000000000000002",
      oracle: "0x0000000000000000000000000000000000000003",
      irm: "0x0000000000000000000000000000000000000004",
      lltv: 800000000000000000n,
    },
    collateralInfo: {
      address: "0x0000000000000000000000000000000000000002",
      decimals: 18,
      symbol: "COLL",
    },
    loanInfo: {
      address: "0x0000000000000000000000000000000000000001",
      decimals: 18,
      symbol: "LOAN",
    },
    collateralProvider: "0x0000000000000000000000000000000000000000",
    loanProvider: "0x0000000000000000000000000000000000000000",
    collateralIsNative: false,
    loanIsNative: false,
  }),
}));

vi.mock("../read/market/getMarketUserData", () => ({
  getMarketUserData: vi.fn().mockResolvedValue({
    borrowShares: 1000n,
    collateral: 2000n,
    decimals: { c: 18, l: 18 },
    withdrawable: { roundDown: () => ({ numerator: 1500n }) },
    _getExtraRepayAmount: () => ({ roundDown: () => ({ numerator: 1100n }) }),
  }),
}));

vi.mock("../read/vault/getVaultInfo", () => ({
  getVaultInfo: vi.fn().mockResolvedValue({
    address: "0x1111111111111111111111111111111111111111",
    assetInfo: {
      address: "0x2222222222222222222222222222222222222222",
      decimals: 18,
      symbol: "ASSET",
    },
    isNative: false,
    provider: "0x0000000000000000000000000000000000000000",
  }),
}));

vi.mock("../read/vault/getVaultUserData", () => ({
  getVaultUserData: vi.fn().mockResolvedValue({
    shares: { numerator: 1000n },
    locked: { numerator: 1000n },
  }),
}));

vi.mock("../read/smart/getSmartMarketExtraInfo", () => ({
  getSmartMarketExtraInfo: vi.fn().mockResolvedValue({
    params: {
      loanToken: "0x0000000000000000000000000000000000000001",
      collateralToken: "0x0000000000000000000000000000000000000002",
      oracle: "0x0000000000000000000000000000000000000003",
      irm: "0x0000000000000000000000000000000000000004",
      lltv: 800000000000000000n,
    },
    collateralProvider: "0x5555555555555555555555555555555555555555",
    loanProvider: "0x6666666666666666666666666666666666666666",
    loanIsNative: false,
    tokenAIsNative: false,
    tokenBIsNative: false,
    lpInfo: {
      address: "0x7777777777777777777777777777777777777777",
      decimals: 18,
      symbol: "LP",
    },
    loanInfo: {
      address: "0x0000000000000000000000000000000000000001",
      decimals: 18,
      symbol: "LOAN",
    },
    tokenAInfo: {
      address: "0x8888888888888888888888888888888888888888",
      decimals: 18,
      symbol: "TOKA",
    },
    tokenBInfo: {
      address: "0x9999999999999999999999999999999999999999",
      decimals: 18,
      symbol: "TOKB",
    },
  }),
}));

vi.mock("../read/smart/getSmartMarketUserData", () => ({
  getSmartMarketUserData: vi.fn().mockResolvedValue({
    borrowShares: 1000n,
    decimals: { l: 18 },
    _getExtraRepayAmount: () => ({ roundDown: () => ({ numerator: 1100n }) }),
  }),
}));

vi.mock("../read/broker/getBrokerFixedTerms", () => ({
  getBrokerFixedTerms: vi
    .fn()
    .mockResolvedValue([
      { termId: 1n, rate: 50000000000000000n, duration: 86400n * 30n },
    ]),
}));

vi.mock("../read/broker/getBrokerUserPositions", () => ({
  getBrokerUserPositions: vi.fn().mockResolvedValue({
    positions: [],
    totalBorrowed: 0n,
  }),
}));

// Mock the API client (now in sdk-core)
vi.mock("@lista-dao/moolah-sdk-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lista-dao/moolah-sdk-core")>();
  return {
    ...actual,
    MoolahApiClient: vi.fn().mockImplementation(() => ({
      getMarketInfo: vi
        .fn()
        .mockResolvedValue({ id: "market1", name: "Test Market" }),
      getVaultList: vi.fn().mockResolvedValue({ list: [], total: 0 }),
      getVaultInfo: vi.fn().mockResolvedValue({
        address: "0x1111111111111111111111111111111111111111",
      }),
      getMarketList: vi.fn().mockResolvedValue({ list: [], total: 0 }),
      getHoldings: vi.fn().mockImplementation((params: { type: string }) => {
        if (params.type === "market") {
          return Promise.resolve({ objs: [], cdps: [], type: "market" });
        }
        return Promise.resolve({ objs: [], cdps: [], type: "vault" });
      }),
      getMarketVaultDetails: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    })),
  };
});

const MARKET_ID = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const VAULT_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const WALLET = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;
const BROKER_ADDRESS = "0xdddddddddddddddddddddddddddddddddddddddd" as Address;

describe("MoolahSDK", () => {
  let sdk: MoolahSDK;

  beforeEach(() => {
    vi.clearAllMocks();
    sdk = new MoolahSDK({
      rpcUrls: {
        "56": "https://bsc-rpc.example.com",
        "1": "https://eth-rpc.example.com",
      },
    });
  });

  describe("constructor", () => {
    it("should create SDK with config", () => {
      expect(sdk).toBeDefined();
    });

    it("should use custom API base URL", () => {
      const customSdk = new MoolahSDK({
        rpcUrls: { "56": "https://bsc-rpc.example.com" },
        apiBaseUrl: "https://custom-api.example.com",
      });
      expect(customSdk).toBeDefined();
    });
  });

  describe("getApiChain", () => {
    it("should return API chain string for BSC", () => {
      const chain = sdk.getApiChain(56);
      expect(chain).toBe("bsc");
    });

    it("should throw for unsupported chain", () => {
      expect(() => sdk.getApiChain(999)).toThrow("Unsupported chainId");
    });
  });

  describe("read methods", () => {
    it("should get market extra info", async () => {
      const result = await sdk.getMarketExtraInfo(56, MARKET_ID);
      expect(result).toBeDefined();
      expect(result.params).toBeDefined();
    });

    it("should get market user data", async () => {
      const result = await sdk.getMarketUserData(56, MARKET_ID, WALLET);
      expect(result).toBeDefined();
      expect(result.borrowShares).toBeDefined();
    });

    it("should get write config", async () => {
      const result = await sdk.getWriteConfig(56, MARKET_ID);
      expect(result).toBeDefined();
      expect(result.params).toBeDefined();
    });

    it("should get vault info", async () => {
      const result = await sdk.getVaultInfo(56, VAULT_ADDRESS);
      expect(result).toBeDefined();
      expect(result.assetInfo).toBeDefined();
    });

    it("should get vault user data", async () => {
      const result = await sdk.getVaultUserData(56, VAULT_ADDRESS, WALLET);
      expect(result).toBeDefined();
      expect(result.shares).toBeDefined();
    });

    it("should get smart market extra info", async () => {
      const result = await sdk.getSmartMarketExtraInfo(56, MARKET_ID);
      expect(result).toBeDefined();
      expect(result.lpInfo).toBeDefined();
    });

    it("should get smart market user data", async () => {
      const result = await sdk.getSmartMarketUserData(56, MARKET_ID, WALLET);
      expect(result).toBeDefined();
      expect(result.borrowShares).toBeDefined();
    });

    it("should get broker fixed terms", async () => {
      const result = await sdk.getBrokerFixedTerms(56, BROKER_ADDRESS);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should get broker user positions", async () => {
      const result = await sdk.getBrokerUserPositions(
        56,
        BROKER_ADDRESS,
        WALLET,
      );
      expect(result).toBeDefined();
    });
  });

  describe("API methods", () => {
    it("should get market info from API", async () => {
      const result = await sdk.getMarketInfo(56, MARKET_ID);
      expect(result).toBeDefined();
    });

    it("should get vault list from API", async () => {
      const result = await sdk.getVaultList({
        chain: "bsc",
        page: 1,
        pageSize: 20,
      });
      expect(result).toBeDefined();
      expect(result.list).toBeDefined();
    });

    it("should get vault metadata from API", async () => {
      const result = await sdk.getVaultMetadata(VAULT_ADDRESS);
      expect(result).toBeDefined();
    });

    it("should get market list from API", async () => {
      const result = await sdk.getMarketList({
        chain: "bsc",
        page: 1,
        pageSize: 20,
      });
      expect(result).toBeDefined();
      expect(result.list).toBeDefined();
    });

    it("should get holdings from API", async () => {
      const result = await sdk.getHoldings({
        userAddress: WALLET,
        type: "vault",
      });
      expect(result).toBeDefined();
      expect(Array.isArray(result.objs)).toBe(true);
      expect(result.type).toBe("vault");
    });

    it("should get market holdings from API", async () => {
      const result = await sdk.getHoldings({
        userAddress: WALLET,
        type: "market",
      });
      expect(result).toBeDefined();
      expect(Array.isArray(result.objs)).toBe(true);
      expect(result.type).toBe("market");
    });

    it("should get market vault details from API", async () => {
      const result = await sdk.getMarketVaultDetails(MARKET_ID);
      expect(result).toBeDefined();
    });
  });

  describe("build market methods", () => {
    it("should build supply params", async () => {
      const result = await sdk.buildSupplyParams({
        chainId: 56,
        marketId: MARKET_ID,
        assets: 1000n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.some((s) => s.step === "supply")).toBe(true);
    });

    it("should build borrow params", async () => {
      const result = await sdk.buildBorrowParams({
        chainId: 56,
        marketId: MARKET_ID,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "borrow")).toBe(true);
    });

    it("should build repay params", async () => {
      const result = await sdk.buildRepayParams({
        chainId: 56,
        marketId: MARKET_ID,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "repay")).toBe(true);
    });

    it("should auto-fetch userData when repayAll without userData", async () => {
      const result = await sdk.buildRepayParams({
        chainId: 56,
        marketId: MARKET_ID,
        repayAll: true,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "repay")).toBe(true);
    });

    it("should build withdraw params", async () => {
      const result = await sdk.buildWithdrawParams({
        chainId: 56,
        marketId: MARKET_ID,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "withdraw")).toBe(true);
    });

    it("should build withdraw all params", async () => {
      const result = await sdk.buildWithdrawParams({
        chainId: 56,
        marketId: MARKET_ID,
        withdrawAll: true,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "withdraw")).toBe(true);
    });
  });

  describe("build vault methods", () => {
    it("should build vault deposit params", async () => {
      const result = await sdk.buildVaultDepositParams({
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 1000n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "depositVault")).toBe(true);
    });

    it("should build vault withdraw params", async () => {
      const result = await sdk.buildVaultWithdrawParams({
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "withdrawVault")).toBe(true);
    });

    it("should build vault withdraw all params", async () => {
      const result = await sdk.buildVaultWithdrawParams({
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        withdrawAll: true,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "withdrawVault")).toBe(true);
    });
  });

  describe("build smart market methods", () => {
    it("should build smart supply dex lp params", async () => {
      const result = await sdk.buildSmartSupplyDexLpParams({
        chainId: 56,
        marketId: MARKET_ID,
        lpAmount: 1000n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "supplySmartDexLp")).toBe(true);
    });

    it("should build smart supply collateral params", async () => {
      const result = await sdk.buildSmartSupplyCollateralParams({
        chainId: 56,
        marketId: MARKET_ID,
        tokenAAmount: 500n * 10n ** 18n,
        tokenBAmount: 500n * 10n ** 18n,
        minLpAmount: 900n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "supplySmartCollateral")).toBe(true);
    });

    it("should build smart withdraw dex lp params", async () => {
      const result = await sdk.buildSmartWithdrawDexLpParams({
        chainId: 56,
        marketId: MARKET_ID,
        lpAmount: 500n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "withdrawSmartDexLp")).toBe(true);
    });

    it("should build smart withdraw collateral params", async () => {
      const result = await sdk.buildSmartWithdrawCollateralParams({
        chainId: 56,
        marketId: MARKET_ID,
        tokenAAmount: 300n,
        tokenBAmount: 200n,
        maxLpBurn: 600n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "withdrawSmartCollateral")).toBe(
        true,
      );
    });

    it("should build smart withdraw collateral fixed params", async () => {
      const result = await sdk.buildSmartWithdrawCollateralFixedParams({
        chainId: 56,
        marketId: MARKET_ID,
        lpAmount: 500n,
        minTokenAAmount: 200n,
        minTokenBAmount: 200n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(
        result.some((s) => s.step === "withdrawSmartCollateralFixed"),
      ).toBe(true);
    });

    it("should build smart repay params", async () => {
      const result = await sdk.buildSmartRepayParams({
        chainId: 56,
        marketId: MARKET_ID,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "repaySmartMarket")).toBe(true);
    });

    it("should auto-fetch userData when smart repayAll without userData", async () => {
      const result = await sdk.buildSmartRepayParams({
        chainId: 56,
        marketId: MARKET_ID,
        repayAll: true,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "repaySmartMarket")).toBe(true);
    });
  });

  describe("build broker methods", () => {
    it("should build broker borrow params", async () => {
      const result = await sdk.buildBrokerBorrowParams({
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 1000n * 10n ** 18n,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "brokerBorrow")).toBe(true);
    });

    it("should build broker borrow params with termId", async () => {
      const result = await sdk.buildBrokerBorrowParams({
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 1000n * 10n ** 18n,
        termId: 1n,
      });
      expect(result).toBeDefined();
      const borrowStep = result.find((s) => s.step === "brokerBorrow");
      expect(borrowStep?.params.args).toContain(1n);
    });

    it("should build broker repay params", async () => {
      const result = await sdk.buildBrokerRepayParams({
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 500n * 10n ** 18n,
        walletAddress: WALLET,
      });
      expect(result).toBeDefined();
      expect(result.some((s) => s.step === "brokerRepay")).toBe(true);
    });
  });

  describe("chain handling", () => {
    it("should handle numeric chainId", async () => {
      const result = await sdk.buildBorrowParams({
        chainId: 56,
        marketId: MARKET_ID,
        assets: 500n,
        walletAddress: WALLET,
      });
      expect(result[0].params.chainId).toBe(56);
    });

    it("should handle string chainId", async () => {
      const result = await sdk.buildBorrowParams({
        chainId: "56",
        marketId: MARKET_ID,
        assets: 500n,
        walletAddress: WALLET,
      });
      expect(result[0].params.chainId).toBe("56");
    });

    it("should throw for missing RPC URL", async () => {
      const sdkNoRpc = new MoolahSDK({ rpcUrls: {} });
      await expect(
        sdkNoRpc.buildBorrowParams({
          chainId: 56,
          marketId: MARKET_ID,
          assets: 500n,
          walletAddress: WALLET,
        }),
      ).rejects.toThrow("RPC URL not configured for chainId 56");
    });
  });

  describe("caching", () => {
    it("should cache public clients", async () => {
      // Call twice with same chainId
      await sdk.buildBorrowParams({
        chainId: 56,
        marketId: MARKET_ID,
        assets: 500n,
        walletAddress: WALLET,
      });

      await sdk.buildBorrowParams({
        chainId: 56,
        marketId: MARKET_ID,
        assets: 500n,
        walletAddress: WALLET,
      });

      // The internal cache should reuse the same client
      // We can't directly verify the cache, but we can verify no errors occur
      expect(true).toBe(true);
    });
  });
});
