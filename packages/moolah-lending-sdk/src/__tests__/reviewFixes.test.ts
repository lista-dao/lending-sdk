/**
 * Regression tests for defects found in pre-release review.
 *
 * Each case here is something that previously produced a well-formed, valid
 * looking step that was wrong — the failure mode with no signal.
 */
import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData, type PublicClient } from "viem";
import type {
  WriteMarketConfig,
  WriteSmartMarketConfig,
} from "@lista-dao/moolah-sdk-core";
import { buildRepaySteps } from "../builders/market.js";
import { buildSmartRepaySteps } from "../builders/smart.js";
import { buildApproveSteps, ERC20_APPROVE_ABI } from "../builders/approve.js";
import {
  buildBrokerBorrowSteps,
  buildConvertDynamicToFixedSteps,
} from "../builders/broker.js";
import { buildSetAuthorizationSteps } from "../builders/authorization.js";

const USER = "0x0000000000000000000000000000000000000033" as const;
const TOKEN = "0x0000000000000000000000000000000000000011" as const;
const SPENDER = "0x0000000000000000000000000000000000000022" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const CHAIN = 56;

const client = (v: unknown = 0n) =>
  ({ readContract: vi.fn().mockResolvedValue(v) }) as unknown as PublicClient;

const marketInfo = {
  params: {
    loanToken: TOKEN,
    collateralToken: "0x0000000000000000000000000000000000000002",
    oracle: "0x0000000000000000000000000000000000000003",
    irm: "0x0000000000000000000000000000000000000004",
    lltv: 800000000000000000n,
  },
  loanInfo: { address: TOKEN, decimals: 18, symbol: "T" },
  collateralInfo: {
    address: "0x0000000000000000000000000000000000000002",
    decimals: 18,
    symbol: "C",
  },
  loanProvider: ZERO,
  collateralProvider: ZERO,
  loanIsNative: false,
  collateralIsNative: false,
} as unknown as WriteMarketConfig;

const smartConfig = {
  ...marketInfo,
  collateralProvider: "0x3953b325b5ad068e74d1fc58fc66ce4440f1e2ff",
} as unknown as WriteSmartMarketConfig;

const deps = { publicClient: client(0n), network: "bsc" as const };

describe("repay builders enforce the contract's exactly-one-of rule", () => {
  // The union on the params type guards the MoolahSDK door, but `./builders`
  // is a public subpath export, so a caller reaching past the facade got no
  // guard at all — and the repay path is the highest-traffic write.
  it("rejects both assets and shares on a market repay", async () => {
    await expect(
      buildRepaySteps(
        { chainId: CHAIN, assets: 100n, shares: 50n, walletAddress: USER },
        marketInfo,
        deps,
      ),
    ).rejects.toThrow(/exactly one/);
  });

  it("rejects neither assets nor shares on a market repay", async () => {
    await expect(
      buildRepaySteps(
        { chainId: CHAIN, walletAddress: USER },
        marketInfo,
        deps,
      ),
    ).rejects.toThrow(/exactly one/);
  });

  it("rejects repayAll with no position data instead of emitting a reverting step", async () => {
    // Previously this produced assets=0, shares=0 — a step that looks correct,
    // encodes cleanly, and always reverts.
    await expect(
      buildRepaySteps(
        { chainId: CHAIN, repayAll: true, walletAddress: USER },
        marketInfo,
        deps,
      ),
    ).rejects.toThrow(/requires userData/);
  });

  it("applies the same rules to a Smart Lending repay", async () => {
    await expect(
      buildSmartRepaySteps(
        { chainId: CHAIN, assets: 1n, shares: 1n, walletAddress: USER },
        smartConfig,
        deps,
      ),
    ).rejects.toThrow(/exactly one/);
    await expect(
      buildSmartRepaySteps(
        { chainId: CHAIN, repayAll: true, walletAddress: USER },
        smartConfig,
        deps,
      ),
    ).rejects.toThrow(/requires userData/);
  });
});

describe("an approve step carries its own undo", () => {
  it("attaches a zero-allowance reversal", async () => {
    // An allowance is durable state: abandoning the sequence after the approve
    // leaves the spender able to pull the full amount indefinitely.
    const steps = await buildApproveSteps(
      {
        chainId: CHAIN,
        owner: USER,
        token: TOKEN,
        spender: SPENDER,
        amount: 1000n,
      },
      client(0n),
      "bsc",
    );

    const reversal = steps.at(-1)?.meta?.reversalSteps;
    expect(reversal).toHaveLength(1);
    const { functionName, args } = decodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      data: reversal![0].params.data,
    });
    expect(functionName).toBe("approve");
    expect(args?.[1]).toBe(0n);
  });
});

describe("broker addresses are validated before they are approved to", () => {
  // The broker is both a call target and an approval spender, and unlike the
  // market providers it has no on-chain default — it comes from the API. Every
  // path checks it now, not only the one that approves: an impostor cannot pull
  // tokens without an allowance, but it still receives a signed transaction.
  const anyClient = {
    readContract: vi.fn().mockResolvedValue(0n),
  } as unknown as PublicClient;

  it("rejects the zero address", async () => {
    await expect(
      buildConvertDynamicToFixedSteps(
        { chainId: CHAIN, brokerAddress: ZERO, amount: 1n, termId: 600n },
        anyClient,
        "bsc",
      ),
    ).rejects.toThrow(/Invalid broker address/);
  });

  it("rejects a malformed address", async () => {
    await expect(
      buildBrokerBorrowSteps(
        {
          chainId: CHAIN,
          brokerAddress: "0xnot-an-address" as `0x${string}`,
          amount: 1n,
        },
        anyClient,
        "bsc",
      ),
    ).rejects.toThrow(/Invalid broker address/);
  });

  it("rejects a well-formed address that Moolah does not name as a broker", async () => {
    const impostor = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "MARKET_ID"
          ? `0x${"11".repeat(32)}`
          : functionName === "MOOLAH"
            ? "0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C"
            : "0x00000000000000000000000000000000deadbeef",
      ),
    } as unknown as PublicClient;

    await expect(
      buildBrokerBorrowSteps(
        {
          chainId: CHAIN,
          brokerAddress: "0x0659063d10e05aa0d3d52d79e71a5a9d6d1b283a",
          amount: 1n,
        },
        impostor,
        "bsc",
      ),
    ).rejects.toThrow(/Moolah\.brokers\(\) says/);
  });
});

describe("authorization targets default to the address book", () => {
  it("refuses to authorize an address that is not a known contract", () => {
    // An authorization hands standing control of every position the signer
    // holds; a target arriving from a URL or an API field must not be granted
    // by accident.
    expect(() =>
      buildSetAuthorizationSteps(
        { chainId: CHAIN, authorized: SPENDER },
        "bsc",
      ),
    ).toThrow(/not a known authorizable contract/);
  });

  it("allows the PositionManager", () => {
    expect(() =>
      buildSetAuthorizationSteps(
        {
          chainId: CHAIN,
          authorized: "0x8eBFa9e687aF71EC2e87A0380F73b9f57FDf3ec0",
        },
        "bsc",
      ),
    ).not.toThrow();
  });

  it("allows an unknown target only when opted into explicitly", () => {
    expect(() =>
      buildSetAuthorizationSteps(
        { chainId: CHAIN, authorized: SPENDER, allowUnknownTarget: true },
        "bsc",
      ),
    ).not.toThrow();
  });
});
