import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData, zeroAddress } from "viem";
import type { PublicClient } from "viem";
import {
  SMART_PROVIDER_ABI,
  type WriteSmartMarketConfig,
} from "@lista-dao/moolah-sdk-core";
import {
  buildSmartWithdrawCollateralOneCoinSteps,
  buildRedeemSmartLpCollateralSteps,
} from "../../builders/smart.js";

const PROVIDER = "0x3953b325b5ad068e74d1fc58fc66ce4440f1e2ff" as const;
const USER = "0x0000000000000000000000000000000000000033" as const;
const RECEIVER = "0x0000000000000000000000000000000000000044" as const;
const CHAIN = 56;

/**
 * The config deliberately names a provider the chain does not.
 *
 * These two builders resolve `collateralProvider` from `Moolah.providers`, so
 * a fixture whose config already holds the right address proves nothing —
 * deleting the resolution would leave every assertion green. The stale value
 * is the test: every `params.to` below must come out as `PROVIDER`, which only
 * the resolver can supply.
 */
const STALE_PROVIDER = "0x000000000000000000000000000000000000dead" as const;

const smartConfig = {
  collateralProvider: STALE_PROVIDER,
  loanProvider: "0x0000000000000000000000000000000000000000",
  params: {
    loanToken: "0x0000000000000000000000000000000000000001",
    collateralToken: "0x0000000000000000000000000000000000000002",
    oracle: "0x0000000000000000000000000000000000000003",
    irm: "0x0000000000000000000000000000000000000004",
    lltv: 800000000000000000n,
  },
} as unknown as WriteSmartMarketConfig;

const decode = (data: `0x${string}`) =>
  decodeFunctionData({ abi: SMART_PROVIDER_ABI, data });

/**
 * These exits resolve their provider now, so they need a client that answers
 * `providers` with an address rather than one blanket value.
 */
const deps = {
  publicClient: {
    readContract: vi.fn(
      async ({
        functionName,
        args,
      }: {
        functionName: string;
        args?: readonly unknown[];
      }) =>
        functionName === "providers" &&
        args?.[1] === smartConfig.params.collateralToken
          ? PROVIDER
          : zeroAddress,
    ),
  } as unknown as PublicClient,
  network: "bsc" as const,
};

describe("single-sided LP collateral withdrawal", () => {
  it("encodes the chosen token index and slippage floor", async () => {
    const steps = await buildSmartWithdrawCollateralOneCoinSteps(
      {
        chainId: CHAIN,
        collateralAmount: 1000n,
        tokenIndex: 1,
        minTokenAmount: 950n,
        walletAddress: USER,
      },
      smartConfig,
      deps,
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("withdrawSmartCollateralOneCoin");
    expect(steps[0].index).toBe(0);
    expect(steps[0].params.to).toBe(PROVIDER);

    const { functionName, args } = decode(steps[0].params.data);
    expect(functionName).toBe("withdrawCollateralOneCoin");
    expect(args?.slice(1)).toEqual([1000n, 1n, 950n, USER, USER]);
  });

  it("defaults onBehalf and receiver to the wallet, and honours overrides", async () => {
    const [defaulted] = await buildSmartWithdrawCollateralOneCoinSteps(
      {
        chainId: CHAIN,
        collateralAmount: 1n,
        tokenIndex: 0,
        minTokenAmount: 0n,
        walletAddress: USER,
      },
      smartConfig,
      deps,
    );
    expect(defaulted.params.to).toBe(PROVIDER);
    expect(decode(defaulted.params.data).args?.slice(4)).toEqual([USER, USER]);

    const [overridden] = await buildSmartWithdrawCollateralOneCoinSteps(
      {
        chainId: CHAIN,
        collateralAmount: 1n,
        tokenIndex: 0,
        minTokenAmount: 0n,
        walletAddress: USER,
        onBehalf: RECEIVER,
        receiver: RECEIVER,
      },
      smartConfig,
      deps,
    );
    expect(decode(overridden.params.data).args?.slice(4)).toEqual([
      RECEIVER,
      RECEIVER,
    ]);
  });

  it("rejects a token index the contract would revert on", async () => {
    await expect(
      buildSmartWithdrawCollateralOneCoinSteps(
        {
          chainId: CHAIN,
          collateralAmount: 1n,
          // Deliberately outside the union to cover a JS caller.
          tokenIndex: 2 as unknown as 0 | 1,
          minTokenAmount: 0n,
          walletAddress: USER,
        },
        smartConfig,
        deps,
      ),
    ).rejects.toThrow(/tokenIndex must be 0 or 1/);
  });

  it("rejects a zero withdrawal", async () => {
    await expect(
      buildSmartWithdrawCollateralOneCoinSteps(
        {
          chainId: CHAIN,
          collateralAmount: 0n,
          tokenIndex: 0,
          minTokenAmount: 0n,
          walletAddress: USER,
        },
        smartConfig,
        deps,
      ),
    ).rejects.toThrow(/greater than zero/);
  });
});

describe("redeeming seized LP collateral", () => {
  it("encodes the amount and both slippage floors, with no approval step", async () => {
    const steps = await buildRedeemSmartLpCollateralSteps(
      { chainId: CHAIN, lpAmount: 500n, minAmount0: 100n, minAmount1: 200n },
      smartConfig,
      deps,
    );
    expect(steps.map((s) => s.step)).toEqual(["redeemSmartLpCollateral"]);
    expect(steps[0].params.to).toBe(PROVIDER);
    const { functionName, args } = decode(steps[0].params.data);
    expect(functionName).toBe("redeemLpCollateral");
    expect(args).toEqual([500n, 100n, 200n]);
  });

  it("rejects a zero redemption", async () => {
    await expect(
      buildRedeemSmartLpCollateralSteps(
        { chainId: CHAIN, lpAmount: 0n, minAmount0: 0n, minAmount1: 0n },
        smartConfig,
        deps,
      ),
    ).rejects.toThrow(/greater than zero/);
  });
});
