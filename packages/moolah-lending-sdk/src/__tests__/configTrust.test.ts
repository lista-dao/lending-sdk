import { describe, it, expect, vi } from "vitest";
import type { PublicClient, Address } from "viem";
import { assertSmartConfigTokens } from "../configTrust.js";

const LOAN_TOKEN = "0x1111111111111111111111111111111111111111" as Address;
const COLLATERAL_TOKEN =
  "0x2222222222222222222222222222222222222222" as Address;
const TOKEN_A = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN_B = "0x4444444444444444444444444444444444444444" as Address;
const LP_TOKEN = "0x5555555555555555555555555555555555555555" as Address;
const PROVIDER = "0x6666666666666666666666666666666666666666" as Address;

const baseConfig = {
  params: {
    loanToken: LOAN_TOKEN,
    collateralToken: COLLATERAL_TOKEN,
    oracle: "0x7777777777777777777777777777777777777777" as Address,
    irm: "0x8888888888888888888888888888888888888888" as Address,
    lltv: 800000000000000000n,
  },
  tokenAInfo: { address: TOKEN_A, decimals: 18, symbol: "TOKA" },
  tokenBInfo: { address: TOKEN_B, decimals: 18, symbol: "TOKB" },
  lpInfo: { address: LP_TOKEN, decimals: 18, symbol: "LP" },
};

describe("assertSmartConfigTokens", () => {
  it("refuses to check tokens against an unregistered (zero-address) provider", async () => {
    // Same hazard withResolvedProviders guards against: `token(0)` /
    // `token(1)` / `dexLP()` against the zero address have no bytecode to
    // call, and a real node would surface an opaque
    // ContractFunctionZeroDataError instead of this domain-specific reason.
    const mockReadContract = vi
      .fn()
      .mockResolvedValue("0x0000000000000000000000000000000000000000");
    const publicClient = {
      readContract: mockReadContract,
    } as unknown as PublicClient;

    await expect(
      assertSmartConfigTokens(baseConfig, publicClient, "bsc"),
    ).rejects.toThrow(/no collateral provider registered/);

    // Refused before any token/dexLP read was attempted, not after one failed.
    expect(mockReadContract).toHaveBeenCalledTimes(1);
  });

  it("passes when the config's tokens agree with the resolved provider's", async () => {
    const mockReadContract = vi.fn(
      async ({
        functionName,
        args,
      }: {
        functionName: string;
        args?: readonly unknown[];
      }) => {
        if (functionName === "providers") return PROVIDER;
        if (functionName === "token")
          return args?.[0] === 0n ? TOKEN_A : TOKEN_B;
        if (functionName === "dexLP") return LP_TOKEN;
        return undefined;
      },
    );
    const publicClient = {
      readContract: mockReadContract,
    } as unknown as PublicClient;

    await expect(
      assertSmartConfigTokens(baseConfig, publicClient, "bsc"),
    ).resolves.toBeUndefined();
  });
});
