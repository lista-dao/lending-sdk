import { describe, it, expect } from "vitest";
import {
  liquidationIncentiveFactor,
  liquidationDiscountPrice,
  liquidationDiscountRate,
  positionHealthFactor,
  MAX_LIQUIDATION_INCENTIVE_FACTOR,
  LIQUIDATION_CURSOR,
} from "../calculations/liquidation.js";

const WAD = 10n ** 18n;
const pct = (n: number) => BigInt(Math.round(n * 1e18));

describe("protocol constants", () => {
  it("matches ConstantsLib", () => {
    // Asserted against the deployed contracts by the conformance job, so a
    // protocol-side change surfaces as a red test rather than wrong sizing.
    expect(MAX_LIQUIDATION_INCENTIVE_FACTOR).toBe(1_150_000_000_000_000_000n);
    expect(LIQUIDATION_CURSOR).toBe(300_000_000_000_000_000n);
  });
});

describe("liquidationIncentiveFactor", () => {
  it("is 1 at an LLTV of 100%, where there is no shortfall", () => {
    expect(liquidationIncentiveFactor(WAD)).toBe(WAD);
  });

  it("rises as LLTV falls, until the cap binds", () => {
    const factors = [pct(0.98), pct(0.915), pct(0.86), pct(0.8), pct(0.5)].map(
      liquidationIncentiveFactor,
    );
    for (let i = 1; i < factors.length; i += 1) {
      expect(factors[i]).toBeGreaterThanOrEqual(factors[i - 1]);
    }
    expect(factors.at(-1)).toBe(MAX_LIQUIDATION_INCENTIVE_FACTOR);
  });

  it("clamps rather than growing without bound at low LLTV", () => {
    expect(liquidationIncentiveFactor(0n)).toBe(
      MAX_LIQUIDATION_INCENTIVE_FACTOR,
    );
    expect(liquidationIncentiveFactor(pct(0.1))).toBe(
      MAX_LIQUIDATION_INCENTIVE_FACTOR,
    );
  });

  it("computes the uncapped formula where the cap does not bind", () => {
    // lltv 0.8 -> 1 / (1 - 0.3 * 0.2) = 1 / 0.94
    const expected =
      (WAD * WAD) / (WAD - (LIQUIDATION_CURSOR * pct(0.2)) / WAD);
    expect(liquidationIncentiveFactor(pct(0.8))).toBe(expected);
    expect(expected).toBeLessThan(MAX_LIQUIDATION_INCENTIVE_FACTOR);
  });

  it("locates the LLTV where the cap starts binding", () => {
    // The cap engages somewhere between 0.5 and 0.8.
    expect(liquidationIncentiveFactor(pct(0.5))).toBe(
      MAX_LIQUIDATION_INCENTIVE_FACTOR,
    );
    expect(liquidationIncentiveFactor(pct(0.8))).toBeLessThan(
      MAX_LIQUIDATION_INCENTIVE_FACTOR,
    );
  });

  it("rejects an LLTV outside [0, 1e18]", () => {
    expect(() => liquidationIncentiveFactor(-1n)).toThrow(/between 0 and 1e18/);
    expect(() => liquidationIncentiveFactor(WAD + 1n)).toThrow(
      /between 0 and 1e18/,
    );
  });
});

describe("discount pricing", () => {
  it("prices collateral below the oracle, by the incentive factor", () => {
    const price = 1000n * WAD;
    const discounted = liquidationDiscountPrice(price, pct(0.8));
    expect(discounted).toBeLessThan(price);
    expect(discounted).toBe(
      (price * WAD) / liquidationIncentiveFactor(pct(0.8)),
    );
  });

  it("leaves the price alone when there is no incentive", () => {
    expect(liquidationDiscountPrice(1000n, WAD)).toBe(1000n);
  });

  it("reports the discount as a fraction, zero when the factor is one", () => {
    expect(liquidationDiscountRate(WAD)).toBe(0n);
    const capped = liquidationDiscountRate(pct(0.5));
    // 1 - 1/1.15 is about 13%.
    expect(capped).toBeGreaterThan(pct(0.12));
    expect(capped).toBeLessThan(pct(0.14));
  });
});

describe("positionHealthFactor", () => {
  const scale = 10n ** 36n;

  it("returns null for a position with no debt", () => {
    expect(
      positionHealthFactor({
        collateral: 100n,
        collateralPrice: scale,
        borrowed: 0n,
        lltv: pct(0.8),
      }),
    ).toBeNull();
  });

  it("is exactly 1 at the liquidation threshold", () => {
    const collateral = 1000n * WAD;
    const lltv = pct(0.8);
    const borrowed = (collateral * lltv) / WAD;
    expect(
      positionHealthFactor({
        collateral,
        collateralPrice: scale,
        borrowed,
        lltv,
      }),
    ).toBe(WAD);
  });

  it("drops below 1 once debt passes the threshold", () => {
    const collateral = 1000n * WAD;
    const lltv = pct(0.8);
    const hf = positionHealthFactor({
      collateral,
      collateralPrice: scale,
      borrowed: (collateral * lltv) / WAD + 1n,
      lltv,
    });
    expect(hf).not.toBeNull();
    expect(hf!).toBeLessThan(WAD);
  });

  it("rises with collateral price", () => {
    const base = {
      collateral: 1000n * WAD,
      borrowed: 500n * WAD,
      lltv: pct(0.8),
    };
    const low = positionHealthFactor({ ...base, collateralPrice: scale })!;
    const high = positionHealthFactor({
      ...base,
      collateralPrice: scale * 2n,
    })!;
    expect(high).toBeGreaterThan(low);
  });
});
