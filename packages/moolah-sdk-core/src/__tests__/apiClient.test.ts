import { beforeEach, describe, expect, it, vi } from "vitest";
import { MoolahApiClient } from "../api/client.js";

function makeSuccessResponse<T>(data: T): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ code: "000000000", msg: "ok", data }),
  } as unknown as Response;
}

describe("MoolahApiClient list query serialization", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: MoolahApiClient;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(makeSuccessResponse({ total: 0, list: [] }));
    client = new MoolahApiClient({
      baseUrl: "https://api.lista.org",
      fetch: fetchMock as unknown as typeof fetch,
    });
  });

  it("should serialize vault filters using bracket array params", async () => {
    await client.getVaultList({
      page: 1,
      pageSize: 10,
      sort: "depositsUsd",
      order: "desc",
      zone: 0,
      keyword: "123",
      chain: ["bsc", "ethereum"],
      assets: ["USDT", "BTCB"],
      curators: ["Pangolins", "MEV Capital"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));

    expect(url.pathname).toBe("/api/moolah/vault/list");
    expect(url.searchParams.get("chain")).toBe("bsc,ethereum");
    expect(url.searchParams.getAll("assets[]")).toEqual(["USDT", "BTCB"]);
    expect(url.searchParams.getAll("curators[]")).toEqual([
      "Pangolins",
      "MEV Capital",
    ]);
    expect(url.searchParams.get("assets")).toBeNull();
    expect(url.searchParams.get("curators")).toBeNull();
  });

  it("should serialize market filters with smartLendingChecked", async () => {
    await client.getMarketList({
      page: 1,
      pageSize: 10,
      sort: "liquidity",
      order: "desc",
      zone: 3,
      keyword: "",
      chain: ["bsc", "ethereum"],
      loans: ["BTCB", "USDT"],
      collaterals: ["BTCB", "SolvBTC"],
      smartLendingChecked: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));

    expect(url.pathname).toBe("/api/moolah/borrow/markets");
    expect(url.searchParams.get("chain")).toBe("bsc,ethereum");
    expect(url.searchParams.getAll("loans[]")).toEqual(["BTCB", "USDT"]);
    expect(url.searchParams.getAll("collaterals[]")).toEqual([
      "BTCB",
      "SolvBTC",
    ]);
    expect(url.searchParams.get("smartLendingChecked")).toBe("true");
    expect(url.searchParams.get("loans")).toBeNull();
    expect(url.searchParams.get("collaterals")).toBeNull();
  });

  it("should serialize holdings params for vault and market types", async () => {
    await client.getHoldings({
      userAddress: "0x05e3a7a66945ca9af73f66660f22ffb36332fa54",
      type: "vault",
    });
    await client.getHoldings({
      userAddress: "0x05e3a7a66945ca9af73f66660f22ffb36332fa54",
      type: "market",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const vaultUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(vaultUrl.pathname).toBe("/api/moolah/one/holding");
    expect(vaultUrl.searchParams.get("userAddress")).toBe(
      "0x05e3a7a66945ca9af73f66660f22ffb36332fa54",
    );
    expect(vaultUrl.searchParams.get("type")).toBe("vault");

    const marketUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(marketUrl.pathname).toBe("/api/moolah/one/holding");
    expect(marketUrl.searchParams.get("userAddress")).toBe(
      "0x05e3a7a66945ca9af73f66660f22ffb36332fa54",
    );
    expect(marketUrl.searchParams.get("type")).toBe("market");
  });

  it("should serialize chain for market info", async () => {
    await client.getMarketInfo(
      "0x05e3a7a66945ca9af73f66660f22ffb36332fa54",
      "bsc",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe(
      "/api/moolah/market/0x05e3a7a66945ca9af73f66660f22ffb36332fa54",
    );
    expect(url.searchParams.get("chain")).toBe("bsc");
  });
});
