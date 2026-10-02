import { describe, it, expect, beforeEach, vi } from "vitest";

const constructedWith: string[] = [];

vi.mock("@lista-dao/moolah-sdk-core", async () => {
  const actual = await vi.importActual<
    typeof import("@lista-dao/moolah-sdk-core")
  >("@lista-dao/moolah-sdk-core");
  return {
    ...actual,
    MoolahApiClient: class {
      constructor(config: { baseUrl?: string }) {
        constructedWith.push(config.baseUrl ?? "");
      }
      async getMarketList() {
        return { list: [], total: 0 };
      }
      async getVaultList() {
        return { list: [], total: 0 };
      }
      async getVaultInfo() {
        return {};
      }
      async getHoldings() {
        return {};
      }
      async getLiquidationList() {
        return { list: [], total: 0 };
      }
      async getCloseToLiquidate() {
        return { list: [], total: 0 };
      }
      async getMarketVaultDetails() {
        return { list: [], total: 0 };
      }
    },
  };
});

const { MoolahSDK } = await import("../MoolahSDK.js");
const { LISTA_API_URL } = await import("@lista-dao/moolah-sdk-core");

const rpcUrls = { "1": "https://eth.example", "56": "https://bsc.example" };
const ADDR = "0x0000000000000000000000000000000000000001" as const;

describe("production REST host routing", () => {
  beforeEach(() => {
    constructedWith.length = 0;
  });

  it("uses the default host for a chain-scoped request", async () => {
    const sdk = new MoolahSDK({ rpcUrls });
    await sdk.getMarketList({
      page: 1,
      pageSize: 10,
      chain: ["bsc", "ethereum"],
    });
    await sdk.getVaultMetadata(ADDR);
    expect(constructedWith).toEqual([LISTA_API_URL]);
  });

  it("uses one explicit override for every REST endpoint", async () => {
    const sdk = new MoolahSDK({ rpcUrls, apiBaseUrl: "https://proxy.example" });
    await sdk.getVaultList({ page: 1, pageSize: 10, chain: "bsc" });
    await sdk.getHoldings({ userAddress: ADDR, type: "vault" });
    await sdk.getLiquidationList({});
    await sdk.getCloseToLiquidate({});
    await sdk.getMarketVaultDetails(ADDR);
    expect(constructedWith).toEqual(["https://proxy.example"]);
  });

  it("rejects an unknown API chain", async () => {
    const sdk = new MoolahSDK({ rpcUrls });
    await expect(
      sdk.getMarketList({
        page: 1,
        pageSize: 10,
        chain: "bscTest" as never,
      }),
    ).rejects.toThrow(/Unsupported API chain/);
  });

  it("rejects inherited property names as API chains", async () => {
    const sdk = new MoolahSDK({ rpcUrls });
    await expect(
      sdk.getMarketList({
        page: 1,
        pageSize: 10,
        chain: "constructor" as never,
      }),
    ).rejects.toThrow(/Unsupported API chain/);
  });

  it("rejects an unknown chain id", () => {
    const sdk = new MoolahSDK({ rpcUrls });
    expect(() => sdk.getApiChain(97)).toThrow(/Unsupported chainId/);
  });
});
