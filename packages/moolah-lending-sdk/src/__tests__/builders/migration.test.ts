import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData, type PublicClient } from "viem";
import {
  MOOLAH_ABI,
  POSITION_MANAGER_ABI,
  type WriteMarketConfig,
} from "@lista-dao/moolah-sdk-core";
import {
  buildMigrateToFixedTermSteps,
  buildSetAuthorizationSteps,
  buildRevokeAuthorizationSteps,
} from "../../builders/authorization.js";
import { marketIdOf } from "../../builders/sharePricing.js";

const USER = "0x0000000000000000000000000000000000000033" as const;
/** BSC PositionManager, as configured in the address book (EIP-55). */
const PM = "0x8eBFa9e687aF71EC2e87A0380F73b9f57FDf3ec0" as const;
const CHAIN = 56;

/** viem returns checksummed addresses from decode; compare case-insensitively. */
const sameAddress = (a: unknown, b: string) =>
  String(a).toLowerCase() === b.toLowerCase();

const market = (over: Partial<WriteMarketConfig["params"]> = {}) =>
  ({
    params: {
      loanToken: "0x0000000000000000000000000000000000000001",
      collateralToken: "0x0000000000000000000000000000000000000002",
      oracle: "0x0000000000000000000000000000000000000003",
      irm: "0x0000000000000000000000000000000000000004",
      lltv: 800000000000000000n,
      ...over,
    },
  }) as unknown as WriteMarketConfig;

/** BSC fixed-term broker address, arbitrary but non-zero. */
const BROKER = "0x00000000000000000000000000000000000000b1" as const;

/**
 * Market state as Moolah returns it: `[totalSupplyAssets, totalSupplyShares,
 * totalBorrowAssets, totalBorrowShares, lastUpdate, fee]`.
 *
 * The borrow side carries the virtual offsets `toAssetsUp` adds
 * (`VIRTUAL_ASSETS = 1`, `VIRTUAL_SHARES = 1_000_000`), so `borrowShares` of
 * 500_000_000 prices to exactly 500 assets rather than to the 1 that a naive
 * 1:1 fixture produces. Pricing has to land on a figure big enough to tell the
 * liquidity comparison apart from a rounding artefact.
 */
const SOURCE_STATE = [0n, 0n, 1_000n, 1_000_000_000n, 1n, 0n] as const;
/** Target: 900 available (1_000 supplied, 100 borrowed) against a need of 500. */
const TARGET_STATE = [1_000n, 1_000n, 100n, 100n, 1n, 0n] as const;
/** What `SOURCE_STATE` prices `base.borrowShares` at. */
const BORROW_SIZE = 500n;

/**
 * Keyed on the market id in `args[0]`, not just on `functionName` — the whole
 * point of the pre-flight is that it reads the *target* market's liquidity
 * while pricing the debt against the *source*, and a mock that answers both
 * with one tuple cannot tell a correct implementation from one that has them
 * the wrong way round.
 */
const deps = (
  isAuthorized: boolean,
  over: {
    target?: readonly bigint[];
    source?: readonly bigint[];
    broker?: string;
  } = {},
) => {
  const readContract = vi.fn(
    ({
      functionName,
      args,
    }: {
      functionName: string;
      args?: readonly unknown[];
    }) => {
      if (functionName === "brokers")
        return Promise.resolve(over.broker ?? BROKER);
      if (functionName === "market") {
        const id = String(args?.[0]).toLowerCase();
        if (id === IN_ID) return Promise.resolve(over.target ?? TARGET_STATE);
        if (id === OUT_ID) return Promise.resolve(over.source ?? SOURCE_STATE);
        throw new Error(`unexpected market id ${id}`);
      }
      return Promise.resolve(isAuthorized);
    },
  );
  return {
    publicClient: { readContract } as unknown as PublicClient,
    network: "bsc" as const,
    readContract,
  };
};

const base = {
  chainId: CHAIN,
  outMarket: market(),
  // A distinct lltv gives the target its own market id, so reading the wrong
  // one is detectable rather than silently identical.
  inMarket: market({ lltv: 900000000000000000n }),
  collateralAmount: 1000n,
  borrowShares: 500_000_000n,
  termId: 600n,
  walletAddress: USER,
};

const OUT_ID = marketIdOf(base.outMarket.params).toLowerCase();
const IN_ID = marketIdOf(base.inMarket.params).toLowerCase();

describe("authorization steps", () => {
  it("encodes a grant and a revoke against Moolah", () => {
    const [grant] = buildSetAuthorizationSteps(
      { chainId: CHAIN, authorized: PM },
      "bsc",
    );
    const [revoke] = buildRevokeAuthorizationSteps(
      { chainId: CHAIN, authorized: PM },
      "bsc",
    );

    expect(grant.step).toBe("setAuthorization");
    expect(revoke.step).toBe("revokeAuthorization");
    const grantArgs = decodeFunctionData({
      abi: MOOLAH_ABI,
      data: grant.params.data,
    }).args;
    expect(sameAddress(grantArgs?.[0], PM)).toBe(true);
    expect(grantArgs?.[1]).toBe(true);

    const revokeArgs = decodeFunctionData({
      abi: MOOLAH_ABI,
      data: revoke.params.data,
    }).args;
    expect(sameAddress(revokeArgs?.[0], PM)).toBe(true);
    expect(revokeArgs?.[1]).toBe(false);
  });
});

describe("migration to a fixed-term market", () => {
  it("is a single step when the PositionManager is already authorized", async () => {
    const steps = await buildMigrateToFixedTermSteps(base, deps(true));
    expect(steps.map((s) => [s.step, s.index])).toEqual([
      ["migrateToFixedTerm", 0],
    ]);
  });

  it("prepends the authorization when it is missing", async () => {
    const steps = await buildMigrateToFixedTermSteps(base, deps(false));
    expect(steps.map((s) => [s.step, s.index])).toEqual([
      ["setAuthorization", 0],
      ["migrateToFixedTerm", 1],
    ]);
    expect(steps[0].meta?.observedState).toEqual({ isAuthorized: false });
    expect(steps[0].meta?.precondition).toMatch(/not yet authorized/);
  });

  it("attaches the undo to the step that creates the standing grant", async () => {
    // Executing step 0 and stopping leaves a standing authorization. The undo
    // travels with the step that creates it, so recovery does not depend on
    // the caller knowing a separate builder exists.
    const steps = await buildMigrateToFixedTermSteps(base, deps(false));
    const reversal = steps[0].meta?.reversalSteps;
    expect(reversal).toHaveLength(1);
    expect(reversal?.[0].step).toBe("revokeAuthorization");
    const revokeArgs = decodeFunctionData({
      abi: MOOLAH_ABI,
      data: reversal![0].params.data,
    }).args;
    expect(sameAddress(revokeArgs?.[0], PM)).toBe(true);
    expect(revokeArgs?.[1]).toBe(false);
  });

  it("carries no reversal on the migration itself, which leaves nothing standing", async () => {
    const steps = await buildMigrateToFixedTermSteps(base, deps(false));
    expect(steps[1].meta?.reversalSteps).toBeUndefined();
  });

  // The two steps are not atomic with each other: the grant lands, then the
  // migration reverts `insufficient liquidity`, and the caller is left with a
  // standing authorization they got nothing out of. Refusing before step 0 is
  // built is the only way not to reach that state at all.
  it("refuses before the authorization when the target market is dry", async () => {
    // Fully lent out: 1,000 supplied, 1,000 borrowed, nothing available.
    const dry = [1_000n, 1_000n, 1_000n, 1_000n, 1n, 0n] as const;
    await expect(
      buildMigrateToFixedTermSteps(base, deps(false, { target: dry })),
    ).rejects.toThrow(
      new RegExp(
        `has 0 loan tokens available and this migration needs ${BORROW_SIZE}`,
      ),
    );
  });

  // The comparison has to be against the TARGET market's liquidity and the
  // debt has to be priced against the SOURCE. Swapping them, or reading one
  // tuple for both, passes a fixture where the two markets look alike.
  it("prices the debt on the source market and the liquidity on the target", async () => {
    const d = deps(true);
    await buildMigrateToFixedTermSteps(base, d);

    const marketReads = d.readContract.mock.calls
      .map(
        ([call]) => call as { functionName: string; args?: readonly unknown[] },
      )
      .filter((call) => call.functionName === "market")
      .map((call) => String(call.args?.[0]).toLowerCase());

    expect(marketReads).toContain(IN_ID);
    expect(marketReads).toContain(OUT_ID);

    // Exactly 500 available on the target would be enough; one less is not.
    const tight = [600n, 600n, 100n, 100n, 1n, 0n] as const;
    await expect(
      buildMigrateToFixedTermSteps(base, deps(true, { target: tight })),
    ).resolves.toBeDefined();

    const short = [599n, 599n, 100n, 100n, 1n, 0n] as const;
    await expect(
      buildMigrateToFixedTermSteps(base, deps(true, { target: short })),
    ).rejects.toThrow(/has 499 loan tokens available/);
  });

  it("refuses a target market that was never created", async () => {
    const uncreated = [0n, 0n, 0n, 0n, 0n, 0n] as const;
    await expect(
      buildMigrateToFixedTermSteps(base, deps(true, { target: uncreated })),
    ).rejects.toThrow(/has never been created/);
  });

  // `PositionManager` borrows the new fixed-term debt through
  // `MOOLAH.brokers(inMarket.id())` and reverts `no-broker-for-market` on the
  // zero address — after the grant has landed.
  it("refuses a target market with no broker registered", async () => {
    await expect(
      buildMigrateToFixedTermSteps(
        base,
        deps(false, { broker: "0x0000000000000000000000000000000000000000" }),
      ),
    ).rejects.toThrow(/has no broker registered/);
  });

  it("encodes both market tuples, the amounts and the term", async () => {
    const steps = await buildMigrateToFixedTermSteps(base, deps(true));
    const { functionName, args } = decodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      data: steps[0].params.data,
    });
    expect(functionName).toBe("migrateCommonMarketToFixedTermMarket");
    expect(args?.slice(2)).toEqual([1000n, 0n, base.borrowShares, 600n]);
    expect(steps[0].params.to).toBe(PM);
  });

  it("supports a partial migration by amount", async () => {
    const steps = await buildMigrateToFixedTermSteps(
      { ...base, borrowShares: undefined, borrowAmount: 250n },
      deps(true),
    );
    const { args } = decodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      data: steps[0].params.data,
    });
    expect(args?.slice(3, 5)).toEqual([250n, 0n]);
  });

  it("rejects both debt amounts, which the contract reverts on", async () => {
    await expect(
      buildMigrateToFixedTermSteps(
        { ...base, borrowAmount: 1n, borrowShares: 1n } as never,
        deps(true),
      ),
    ).rejects.toThrow(/exactly one/);
  });

  it("rejects neither debt amount", async () => {
    await expect(
      buildMigrateToFixedTermSteps(
        { ...base, borrowShares: undefined } as never,
        deps(true),
      ),
    ).rejects.toThrow(/exactly one/);
  });

  describe("preconditions the contract enforces are checked before any step is emitted", () => {
    // The first transaction is the authorization. Discovering a mismatch
    // afterwards means the user has paid gas for a grant they cannot use.
    it("rejects mismatched loan tokens", async () => {
      await expect(
        buildMigrateToFixedTermSteps(
          {
            ...base,
            inMarket: market({
              loanToken: "0x00000000000000000000000000000000000000ff",
            }),
          },
          deps(false),
        ),
      ).rejects.toThrow(/share a loan token/);
    });

    it("rejects mismatched collateral tokens", async () => {
      await expect(
        buildMigrateToFixedTermSteps(
          {
            ...base,
            inMarket: market({
              collateralToken: "0x00000000000000000000000000000000000000ff",
            }),
          },
          deps(false),
        ),
      ).rejects.toThrow(/share a collateral token/);
    });

    it("rejects a target market with a lower LLTV", async () => {
      await expect(
        buildMigrateToFixedTermSteps(
          { ...base, inMarket: market({ lltv: 700000000000000000n }) },
          deps(false),
        ),
      ).rejects.toThrow(/LLTV must be at least/);
    });

    it("rejects a zero collateral amount", async () => {
      await expect(
        buildMigrateToFixedTermSteps(
          { ...base, collateralAmount: 0n },
          deps(false),
        ),
      ).rejects.toThrow(/greater than zero/);
    });

    it("emits nothing at all when a precondition fails", async () => {
      const d = deps(false);
      await expect(
        buildMigrateToFixedTermSteps({ ...base, collateralAmount: 0n }, d),
      ).rejects.toThrow();
      // Not even the authorization read was reached.
      expect(d.publicClient.readContract).not.toHaveBeenCalled();
    });
  });
});
