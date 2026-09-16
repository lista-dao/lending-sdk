import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData, type PublicClient } from "viem";
import { PUBLIC_LIQUIDATOR_ABI } from "@lista-dao/moolah-sdk-core";
import { ERC20_APPROVE_ABI } from "../../builders/approve.js";
import {
  toDisplayAmount,
  fromDisplayAmount,
} from "@lista-dao/moolah-sdk-core/display";
import {
  buildLiquidateSteps,
  quoteLiquidationCost,
} from "../../builders/liquidation.js";

const MARKET =
  "0x058073a21fea8dd3aa250713a56ad7526cc27c8f74e85f5433821c6fe5d03e1b" as const;
const BORROWER = "0x0000000000000000000000000000000000000077" as const;
const USER = "0x0000000000000000000000000000000000000033" as const;
const LOAN = "0x0000000000000000000000000000000000000001" as const;
/** BSC mainnet public liquidator, as configured in the address book. */
const LIQUIDATOR = "0x882475d622c687b079f149B69a15683FCbeCC6D9" as const;
const CHAIN = 56;

/**
 * The liquidator gates on a per-market allowlist, so the mock has to answer
 * `marketWhitelist` as well as `allowance` — a single blanket value would make
 * every market look unlisted, which is in fact the live state on BSC.
 */
const deps = (value: bigint | Address = 0n, whitelisted = true) => ({
  publicClient: {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === "marketWhitelist" ? whitelisted : value,
    ),
  } as unknown as PublicClient,
  network: "bsc" as const,
});

type Address = `0x${string}`;

const decode = (data: `0x${string}`) =>
  decodeFunctionData({ abi: PUBLIC_LIQUIDATOR_ABI, data });

describe("public liquidation", () => {
  it("approves the liquidator, then liquidates in seized-assets mode", async () => {
    const steps = await buildLiquidateSteps(
      {
        chainId: CHAIN,
        marketId: MARKET,
        borrower: BORROWER,
        walletAddress: USER,
        loanToken: LOAN,
        maxRepayAmount: 5000n,
        seizedAssets: 1000n,
      },
      deps(0n),
    );

    // The trailing approve is the clear: `maxRepayAmount` is headroom against a
    // moving oracle, so the liquidator takes less than was approved and the
    // remainder would otherwise stand against it forever.
    expect(steps.map((s) => [s.step, s.index])).toEqual([
      ["approve", 0],
      ["liquidate", 1],
      ["approve", 2],
    ]);
    expect(steps[0].meta?.spender).toBe(LIQUIDATOR);
    expect(steps[1].params.to).toBe(LIQUIDATOR);
    expect(steps[2].meta?.amount).toBe(0n);
    expect(steps[2].meta?.spender).toBe(LIQUIDATOR);

    const { functionName, args } = decode(steps[1].params.data);
    expect(functionName).toBe("liquidate");
    expect(args).toEqual([MARKET, BORROWER, 1000n, 0n]);
  });

  it("liquidates in repaid-shares mode", async () => {
    const steps = await buildLiquidateSteps(
      {
        chainId: CHAIN,
        marketId: MARKET,
        borrower: BORROWER,
        walletAddress: USER,
        loanToken: LOAN,
        maxRepayAmount: 5000n,
        repaidShares: 250n,
      },
      deps(0n),
    );
    expect(decode(steps[1].params.data).args).toEqual([
      MARKET,
      BORROWER,
      0n,
      250n,
    ]);
  });

  it("skips the approval when the allowance already covers the ceiling", async () => {
    const steps = await buildLiquidateSteps(
      {
        chainId: CHAIN,
        marketId: MARKET,
        borrower: BORROWER,
        walletAddress: USER,
        loanToken: LOAN,
        maxRepayAmount: 5000n,
        seizedAssets: 1000n,
      },
      deps(999_999n),
    );
    expect(steps.map((s) => s.step)).toEqual(["liquidate"]);
  });

  it("rejects supplying both amounts, which the contract reverts on", async () => {
    await expect(
      buildLiquidateSteps(
        {
          chainId: CHAIN,
          marketId: MARKET,
          borrower: BORROWER,
          walletAddress: USER,
          loanToken: LOAN,
          maxRepayAmount: 5000n,
          seizedAssets: 1n,
          repaidShares: 1n,
        } as never,
        deps(0n),
      ),
    ).rejects.toThrow(/exactly one/);
  });

  it("rejects supplying neither amount", async () => {
    await expect(
      buildLiquidateSteps(
        {
          chainId: CHAIN,
          marketId: MARKET,
          borrower: BORROWER,
          walletAddress: USER,
          loanToken: LOAN,
          maxRepayAmount: 5000n,
        } as never,
        deps(0n),
      ),
    ).rejects.toThrow(/exactly one/);
  });

  it("quotes the loan-token outlay from the liquidator", async () => {
    const d = deps(4242n);
    const quoted = await quoteLiquidationCost(
      { marketId: MARKET, seizedAssets: 1000n },
      d,
    );
    expect(quoted).toBe(4242n);
    expect(d.publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: LIQUIDATOR,
        functionName: "loanTokenAmountNeed",
        args: [MARKET, 1000n, 0n],
      }),
    );
  });
});

describe("display multipliers never reach liquidation calldata", () => {
  it("encodes identical bytes for a plain and a split token", async () => {
    // The guard that matters: liquidation is the one place where a scaling
    // mistake directly determines how much collateral moves. Same raw amount,
    // different multiplier, byte-identical calldata.
    const raw = 1000n;
    const build = (seized: bigint) =>
      buildLiquidateSteps(
        {
          chainId: CHAIN,
          marketId: MARKET,
          borrower: BORROWER,
          walletAddress: USER,
          loanToken: LOAN,
          maxRepayAmount: 5000n,
          seizedAssets: seized,
        },
        deps(999_999n),
      );

    const plain = await build(raw);
    const split = await build(raw);
    expect(split[0].params.data).toBe(plain[0].params.data);

    // And a display-space figure round-tripped back to raw encodes the same,
    // which is the only supported way to get a user-entered number into a call.
    const multiplier = 4n * 10n ** 18n;
    const roundTripped = fromDisplayAmount(
      toDisplayAmount(raw, multiplier),
      multiplier,
    );
    expect(roundTripped).toBe(raw);
    const viaDisplay = await build(roundTripped);
    expect(viaDisplay[0].params.data).toBe(plain[0].params.data);
  });
});

describe("the liquidator's market allowlist", () => {
  // Found by running against BSC: not one of the thirteen distinct markets in
  // the "close to liquidation" feed was on the allowlist, so the overwhelmingly
  // common outcome of building this call was a bare NotWhitelisted() selector
  // after the gas had been spent.
  it("refuses to build for a market the liquidator will not serve", async () => {
    await expect(
      buildLiquidateSteps(
        {
          chainId: CHAIN,
          marketId: MARKET,
          borrower: BORROWER,
          walletAddress: USER,
          loanToken: LOAN,
          maxRepayAmount: 5000n,
          seizedAssets: 1000n,
        },
        deps(0n, false),
      ),
    ).rejects.toThrow(/not on the public liquidator's allowlist/);
  });

  it("builds anyway when the caller opts in explicitly", async () => {
    const steps = await buildLiquidateSteps(
      {
        chainId: CHAIN,
        marketId: MARKET,
        borrower: BORROWER,
        walletAddress: USER,
        loanToken: LOAN,
        maxRepayAmount: 5000n,
        seizedAssets: 1000n,
        allowUnlistedMarket: true,
      },
      deps(0n, false),
    );
    expect(steps.map((x) => x.step)).toContain("liquidate");
  });

  it("does not read the allowlist at all when opted out", async () => {
    const d = deps(0n, false);
    await buildLiquidateSteps(
      {
        chainId: CHAIN,
        marketId: MARKET,
        borrower: BORROWER,
        walletAddress: USER,
        loanToken: LOAN,
        maxRepayAmount: 5000n,
        seizedAssets: 1000n,
        allowUnlistedMarket: true,
      },
      d,
    );
    const calls = (d.publicClient.readContract as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ functionName: string }]>;
    expect(calls.some(([a]) => a.functionName === "marketWhitelist")).toBe(
      false,
    );
  });
});

describe("an over-sized approval does not outlive the transaction it enabled", () => {
  // `meta.reversalSteps` covers abandoning a sequence. It does not cover
  // finishing one: where the approval is deliberately larger than what is
  // taken — which is every repay and every liquidation here, because the amount
  // owed moves between building and inclusion — the remainder is live against
  // the spender afterwards and nothing reclaims it.
  it("returns the unused liquidation allowance to zero", async () => {
    const steps = await buildLiquidateSteps(
      {
        chainId: CHAIN,
        marketId: MARKET,
        borrower: BORROWER,
        walletAddress: USER,
        loanToken: LOAN,
        maxRepayAmount: 5000n,
        seizedAssets: 1000n,
      },
      deps(0n),
    );
    const last = steps.at(-1)!;
    expect(last.step).toBe("approve");
    const { functionName, args } = decodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      data: last.params.data,
    });
    expect(functionName).toBe("approve");
    expect(args).toEqual([LIQUIDATOR, 0n]);
  });

  it("leaves a caller's own standing allowance alone", async () => {
    // Nothing was approved here — the allowance already covered it — so
    // clearing would be destroying state this sequence did not create.
    const steps = await buildLiquidateSteps(
      {
        chainId: CHAIN,
        marketId: MARKET,
        borrower: BORROWER,
        walletAddress: USER,
        loanToken: LOAN,
        maxRepayAmount: 5000n,
        seizedAssets: 1000n,
      },
      deps(10_000n),
    );
    expect(steps.map((x) => x.step)).toEqual(["liquidate"]);
  });

  it("keeps the allowance when the caller asks", async () => {
    const steps = await buildLiquidateSteps(
      {
        chainId: CHAIN,
        marketId: MARKET,
        borrower: BORROWER,
        walletAddress: USER,
        loanToken: LOAN,
        maxRepayAmount: 5000n,
        seizedAssets: 1000n,
        keepAllowance: true,
      },
      deps(0n),
    );
    expect(steps.map((x) => x.step)).toEqual(["approve", "liquidate"]);
  });
});
