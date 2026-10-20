import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData, type PublicClient } from "viem";
import {
  Decimal,
  MOOLAH_ABI,
  MOOLAH_VAULT_ABI,
  type VaultInfo,
  type WriteMarketConfig,
} from "@lista-dao/moolah-sdk-core";
import {
  buildMoolahSupplySteps,
  buildMoolahWithdrawSteps,
  buildFlashLoanSteps,
} from "../../builders/market.js";
import { buildVaultMintSteps } from "../../builders/vault.js";

const USER = "0x0000000000000000000000000000000000000033" as const;
const RECEIVER = "0x0000000000000000000000000000000000000044" as const;
const LOAN = "0x0000000000000000000000000000000000000001" as const;
const VAULT = "0x0000000000000000000000000000000000000055" as const;
const CHAIN = 56;

const marketInfo = {
  params: {
    loanToken: LOAN,
    collateralToken: "0x0000000000000000000000000000000000000002",
    oracle: "0x0000000000000000000000000000000000000003",
    irm: "0x0000000000000000000000000000000000000004",
    lltv: 800000000000000000n,
  },
} as unknown as WriteMarketConfig;

const deps = (allowance: bigint) => ({
  publicClient: {
    readContract: vi.fn().mockResolvedValue(allowance),
  } as unknown as PublicClient,
  network: "bsc" as const,
});

const decodeMoolah = (data: `0x${string}`) =>
  decodeFunctionData({ abi: MOOLAH_ABI, data });

describe("direct-to-market lending", () => {
  it("approves Moolah then supplies, in assets mode", async () => {
    const steps = await buildMoolahSupplySteps(
      { chainId: CHAIN, assets: 1000n, walletAddress: USER },
      marketInfo,
      deps(0n),
    );
    expect(steps.map((s) => [s.step, s.index])).toEqual([
      ["approve", 0],
      ["moolahSupply", 1],
    ]);
    const { functionName, args } = decodeMoolah(steps[1].params.data);
    expect(functionName).toBe("supply");
    expect(args?.slice(1)).toEqual([1000n, 0n, USER, "0x"]);
  });

  /** `market()` returns six words; `lastUpdate` is the fifth. */
  const marketState = (
    totalSupplyAssets: bigint,
    totalSupplyShares: bigint,
    lastUpdate = 1n,
  ) =>
    ({
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "market"
          ? [totalSupplyAssets, totalSupplyShares, 0n, 0n, lastUpdate, 0n]
          : 0n,
      ),
    }) as unknown as PublicClient;

  it("approves in shares mode too, because the protocol still pulls tokens", async () => {
    // `supply(0, shares)` converts to assets and calls `transferFrom`, so
    // leaving the approval to the caller meant this builder returned a single
    // step that always reverted. The conversion read that supposedly made
    // pricing impossible is one call.
    const steps = await buildMoolahSupplySteps(
      { chainId: CHAIN, shares: 500_000_000n, walletAddress: USER },
      marketInfo,
      {
        publicClient: marketState(1_000_000n, 2_000_000_000_000n),
        network: "bsc",
      },
    );
    // The trailing approve is the reclaim: the ceiling carries headroom the
    // supply does not take.
    expect(steps.map((s) => s.step)).toEqual([
      "approve",
      "moolahSupply",
      "approve",
    ]);
    expect(steps[0].meta?.amount).toBe(253n);
    expect(steps[2].meta?.amount).toBe(0n);
    expect(decodeMoolah(steps[1].params.data).args?.slice(1)).toEqual([
      0n,
      500_000_000n,
      USER,
      "0x",
    ]);
  });

  it("prices through the protocol's virtual shares, not a bare ratio", async () => {
    // Morpho-Blue seeds every conversion with one virtual asset and a million
    // virtual shares. Omitting them under-approves a thin market — with
    // totals (1, 2_000_000) a request for 1e9 shares costs 667 assets and the
    // bare ratio says 500, so the transfer reverts on an approval that looked
    // deliberate.
    const steps = await buildMoolahSupplySteps(
      { chainId: CHAIN, shares: 1_000_000_000n, walletAddress: USER },
      marketInfo,
      { publicClient: marketState(1n, 2_000_000n), network: "bsc" },
    );
    expect(steps[0].meta?.amount).toBe(673n);
    expect(steps[0].meta!.amount as bigint).toBeGreaterThanOrEqual(667n);
  });

  it("prices an empty market at the virtual rate", async () => {
    // A million shares cost one raw asset in an empty market, not a million.
    const steps = await buildMoolahSupplySteps(
      { chainId: CHAIN, shares: 500n, walletAddress: USER },
      marketInfo,
      { publicClient: marketState(0n, 0n), network: "bsc" },
    );
    expect(steps[0].meta?.amount).toBe(2n);
  });

  it("refuses a market that was never created", async () => {
    // All-zero state reads back identically for "empty" and "does not exist".
    // `lastUpdate` is what separates them, and without it a non-existent market
    // priced as an empty one and the supply reverted after the approval.
    await expect(
      buildMoolahSupplySteps(
        { chainId: CHAIN, shares: 500n, walletAddress: USER },
        marketInfo,
        { publicClient: marketState(0n, 0n, 0n), network: "bsc" },
      ),
    ).rejects.toThrow(/never been created/);
  });

  it("gives at least one unit of headroom, where 1% floors to nothing", async () => {
    // A 1% margin on a ceiling below 100 raw units is zero, so the approval
    // goes stale the moment a single wei accrues.
    const steps = await buildMoolahSupplySteps(
      { chainId: CHAIN, shares: 1n, walletAddress: USER },
      marketInfo,
      { publicClient: marketState(1n, 1n), network: "bsc" },
    );
    expect(steps[0].meta?.amount).toBe(2n);
  });

  it("rejects both assets and shares, which the contract reverts on", async () => {
    await expect(
      buildMoolahSupplySteps(
        {
          chainId: CHAIN,
          assets: 1n,
          shares: 1n,
          walletAddress: USER,
        } as never,
        marketInfo,
        deps(0n),
      ),
    ).rejects.toThrow(/exactly one/);
  });

  it("rejects neither assets nor shares", async () => {
    await expect(
      buildMoolahSupplySteps(
        { chainId: CHAIN, walletAddress: USER } as never,
        marketInfo,
        deps(0n),
      ),
    ).rejects.toThrow(/exactly one/);
  });

  it("withdraws in shares mode with an explicit receiver", () => {
    const steps = buildMoolahWithdrawSteps(
      {
        chainId: CHAIN,
        shares: 250n,
        walletAddress: USER,
        receiver: RECEIVER,
      },
      marketInfo,
      "bsc",
    );
    expect(steps.map((s) => s.step)).toEqual(["moolahWithdraw"]);
    const { functionName, args } = decodeMoolah(steps[0].params.data);
    expect(functionName).toBe("withdraw");
    expect(args?.slice(1)).toEqual([0n, 250n, USER, RECEIVER]);
  });
});

describe("flash loan", () => {
  it("forwards the callback payload untouched", () => {
    const steps = buildFlashLoanSteps({
      chainId: CHAIN,
      token: LOAN,
      assets: 10n ** 18n,
      data: "0xdeadbeef",
      network: "bsc",
    });
    const { functionName, args } = decodeMoolah(steps[0].params.data);
    expect(functionName).toBe("flashLoan");
    expect(args).toEqual([LOAN, 10n ** 18n, "0xdeadbeef"]);
  });

  it("rejects a zero loan", () => {
    expect(() =>
      buildFlashLoanSteps({
        chainId: CHAIN,
        token: LOAN,
        assets: 0n,
        data: "0x",
        network: "bsc",
      }),
    ).toThrow(/greater than zero/);
  });
});

describe("share-denominated vault deposit", () => {
  const vaultInfo = {
    assetInfo: { address: LOAN, symbol: "L", decimals: 18 },
    totalAssets: Decimal.ZERO,
    totalSupply: Decimal.ZERO,
    isNative: false,
    isProvider: false,
    provider: "0x0000000000000000000000000000000000000000",
  } as unknown as VaultInfo;

  it("sizes the approval from previewMint plus headroom", async () => {
    // An exact quote is stale the moment a block is mined: an interest-bearing
    // vault reprices, `mint` pulls more than the allowance, and the step
    // reverts with `ERC20: insufficient allowance`. Seen on a mainnet fork,
    // where the same sequence passed or failed depending only on whether a
    // block boundary fell between building and sending.
    const publicClient = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "provider"
          ? "0x0000000000000000000000000000000000000000"
          : functionName === "previewMint"
            ? 2000n
            : 0n,
      ),
    } as unknown as PublicClient;

    const steps = await buildVaultMintSteps(
      {
        chainId: CHAIN,
        vaultAddress: VAULT,
        shares: 100n,
        walletAddress: USER,
      },
      vaultInfo,
      { publicClient, network: "bsc" },
    );

    expect(steps.map((s) => [s.step, s.index])).toEqual([
      ["approve", 0],
      ["vaultMint", 1],
      ["approve", 2],
    ]);
    // 2000 + 1%, not 2000 — and the 1% goes back afterwards rather than
    // standing as allowance against the vault.
    expect(steps[0].meta?.amount).toBe(2020n);
    expect(steps[2].meta?.amount).toBe(0n);
    const { functionName, args } = decodeFunctionData({
      abi: MOOLAH_VAULT_ABI,
      data: steps[1].params.data,
    });
    expect(functionName).toBe("mint");
    expect(args).toEqual([100n, USER]);
  });

  it("lets the caller tune the headroom", async () => {
    const publicClient = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "provider"
          ? "0x0000000000000000000000000000000000000000"
          : functionName === "previewMint"
            ? 2000n
            : 0n,
      ),
    } as unknown as PublicClient;

    const steps = await buildVaultMintSteps(
      {
        chainId: CHAIN,
        vaultAddress: VAULT,
        shares: 100n,
        walletAddress: USER,
        approvalBufferBps: 0n,
      },
      vaultInfo,
      { publicClient, network: "bsc" },
    );
    expect(steps[0].meta?.amount).toBe(2000n);
  });

  it("skips the preview read when the caller supplies a ceiling", async () => {
    const publicClient = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "provider"
          ? "0x0000000000000000000000000000000000000000"
          : 9999n,
      ),
    } as unknown as PublicClient;

    const steps = await buildVaultMintSteps(
      {
        chainId: CHAIN,
        vaultAddress: VAULT,
        shares: 100n,
        walletAddress: USER,
        maxAssets: 5000n,
      },
      vaultInfo,
      { publicClient, network: "bsc" },
    );
    // The provider resolve and the allowance read — previewMint was not
    // called, and the asset still comes from vaultInfo rather than a read.
    const called = (
      (publicClient.readContract as ReturnType<typeof vi.fn>).mock
        .calls as Array<[{ functionName: string }]>
    ).map(([a]) => a.functionName);
    expect(called).toEqual(["provider", "allowance"]);
    expect(steps.map((s) => s.step)).toEqual(["vaultMint"]);
  });

  it("refuses a vault that deposits through a provider", async () => {
    // The NativeProvider has deposit, withdraw and redeem but no mint, so there
    // is no share-denominated entry point at all. Routing around it would
    // approve the wrong spender and call a contract that never sees the value.
    await expect(
      buildVaultMintSteps(
        {
          chainId: CHAIN,
          vaultAddress: VAULT,
          shares: 100n,
          walletAddress: USER,
        },
        {
          ...vaultInfo,
          isNative: true,
          provider: "0x367384C54756a25340c63057D87eA22d47Fd5701",
        } as unknown as VaultInfo,
        // The provider is resolved from the vault now, so the refusal hinges on
        // what the chain says rather than on the config — which is the point:
        // a config claiming no provider cannot route around it.
        {
          publicClient: {
            readContract: vi.fn(
              async () => "0x367384C54756a25340c63057D87eA22d47Fd5701",
            ),
          } as unknown as PublicClient,
          network: "bsc",
        },
      ),
    ).rejects.toThrow(/no mint entry point/);
  });

  it("rejects a zero share target", async () => {
    await expect(
      buildVaultMintSteps(
        {
          chainId: CHAIN,
          vaultAddress: VAULT,
          shares: 0n,
          walletAddress: USER,
        },
        vaultInfo,
        deps(0n),
      ),
    ).rejects.toThrow(/greater than zero/);
  });
});
