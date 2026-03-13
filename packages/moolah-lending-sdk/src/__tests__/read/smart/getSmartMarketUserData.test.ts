import { describe, it, expect, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import {
  Decimal,
  type SmartMarketExtraInfo,
} from "@lista-dao/moolah-sdk-core";

import { getSmartMarketUserData } from "../../../read/smart/getSmartMarketUserData.js";

const MOOLAH = "0x1111111111111111111111111111111111111111" as Address;
const MARKET_ID =
  "0xe20b1f2a32a83b51ec4357fdf4eb5a18c0dc790d2f33dc2d244cd4b1ceb99c50" as Address;
const USER = "0x05E3A7a66945ca9aF73f66660f22ffB36332FA54" as Address;

const LP_TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const USD1 = "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d" as Address;
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address;

describe("getSmartMarketUserData", () => {
  it("uses token-specific decimals when reading ERC20 balances", async () => {
    const mockReadContract = vi.fn(
      async ({
        functionName,
        address,
      }: {
        functionName: string;
        address: Address;
      }) => {
        if (functionName === "position") return [0n, 0n, 0n];
        if (functionName === "isWhiteList") return false;
        if (functionName === "balanceOf" && address === LP_TOKEN) {
          return 1000000000000000000n;
        }
        if (functionName === "balanceOf" && address === USD1) {
          return 20450713159115803238n;
        }
        if (functionName === "balanceOf" && address === USDT) {
          return 13834453n;
        }
        throw new Error(`Unexpected call: ${functionName} @ ${address}`);
      },
    );

    const mockPublicClient = {
      readContract: mockReadContract,
      getBalance: vi.fn().mockResolvedValue(0n),
    } as unknown as PublicClient;

    const extraInfo = {
      loanInfo: { address: USD1, decimals: 18, symbol: "USD1" },
      lpInfo: { address: LP_TOKEN, decimals: 18, symbol: "LP" },
      tokenAInfo: { address: USD1, decimals: 18, symbol: "USD1" },
      tokenBInfo: { address: USDT, decimals: 6, symbol: "USDT" },
      LLTV: new Decimal(8n, 1),
      loanIsNative: false,
      tokenAIsNative: false,
      tokenBIsNative: false,
      rateView: 0n,
      borrowRate: Decimal.ZERO,
      priceRate: Decimal.ONE,
      balances: [Decimal.ZERO, Decimal.ZERO] as [Decimal, Decimal],
      totalLp: Decimal.ONE,
      lastUpdate: 0n,
      totalBorrowShares: 0n,
      totalBorrowAssets: 0n,
    } as unknown as SmartMarketExtraInfo;

    const result = await getSmartMarketUserData(
      mockPublicClient,
      { moolah: MOOLAH },
      MARKET_ID,
      USER,
      extraInfo,
    );

    expect(result.balances.tokenA.decimal).toBe(18);
    expect(result.balances.tokenA.toString(8)).toBe("20.45071315");

    expect(result.balances.tokenB.decimal).toBe(6);
    expect(result.balances.tokenB.toString(6)).toBe("13.834453");
  });
});
