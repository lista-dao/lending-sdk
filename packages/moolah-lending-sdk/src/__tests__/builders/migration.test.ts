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

const deps = (isAuthorized: boolean) => ({
  publicClient: {
    readContract: vi.fn().mockResolvedValue(isAuthorized),
  } as unknown as PublicClient,
  network: "bsc" as const,
});

const base = {
  chainId: CHAIN,
  outMarket: market(),
  inMarket: market(),
  collateralAmount: 1000n,
  borrowShares: 500n,
  termId: 600n,
  walletAddress: USER,
};

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

  it("encodes both market tuples, the amounts and the term", async () => {
    const steps = await buildMigrateToFixedTermSteps(base, deps(true));
    const { functionName, args } = decodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      data: steps[0].params.data,
    });
    expect(functionName).toBe("migrateCommonMarketToFixedTermMarket");
    expect(args?.slice(2)).toEqual([1000n, 0n, 500n, 600n]);
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
