import { describe, it, expect } from "vitest";
import { parseUnits } from "viem";
import { Decimal } from "../index.js";

/**
 * `Decimal.parse` against the frontend's, value for value.
 *
 * The SDK's copy had drifted: it converted a number with
 * `value.toFixed(decimal)`, which at 18 decimal places expands the double
 * rather than formatting the number — 1234.56 became 1234.559999999999945430,
 * and the truncating formatters carried the loss to the screen. The reference
 * frontend has never done that; it has a `parseNumber` helper that goes
 * through the shortest round-tripping representation.
 *
 * So the fix was to port theirs, not to invent a third behaviour. This file is
 * what keeps them the same: an amount the SDK and the frontend disagree about
 * is a bug neither side can see on its own, because each one is
 * self-consistent.
 *
 * Reference: lista-mono `packages/shared/src/utils/fraction.ts`, `parseNumber`.
 * Reproduced verbatim below. If upstream changes, this fails and the port has
 * to follow.
 */
function parseNumberUpstream(value: number, decimals = 18): bigint {
  if (value.toString().includes("e")) {
    const [integer, fraction] = value.toString().split("e");
    const integerValue = parseUnits(integer, decimals);
    const exponentValue = Math.round(Number(fraction));

    if (exponentValue > 0) {
      return integerValue * 10n ** BigInt(exponentValue);
    }
    return integerValue / 10n ** BigInt(-exponentValue);
  }

  return parseUnits(value.toString(), decimals);
}

const VALUES = [
  // Ordinary amounts, where the old `toFixed` path was wrong.
  1234.56,
  0.3,
  99.99,
  0.1,
  1.005,
  123456.789,
  0.007,
  3.14159265358979,
  // Values that need no conversion at all.
  100,
  0,
  2 ** 53,
  // Signed.
  -0.5,
  -1234.56,
  // Exponential notation, which `parseUnits` refuses and the helper expands.
  1e21,
  7.77e12,
  1e-7,
  2.5e-8,
  1.5e-10,
  1e-15,
  // At and below the smallest unit 18 decimals can express. 5e-19 is exactly
  // half of one unit — the case where rounding and truncating disagree, and
  // the reason this port keeps upstream's truncation.
  1e-18,
  5e-19,
  1e-30,
  // The canonical float-addition artefact: 0.30000000000000004.
  0.1 + 0.2,
];

describe("Decimal.parse(number) matches the reference frontend", () => {
  it.each(VALUES)("%p", (value) => {
    expect(Decimal.parse(value, 18).numerator).toBe(
      parseNumberUpstream(value, 18),
    );
  });

  it("agrees at other decimal scales too", () => {
    for (const decimals of [0, 2, 6, 8, 18]) {
      for (const value of [1234.56, 0.3, 100, 0.007]) {
        expect(Decimal.parse(value, decimals).numerator).toBe(
          parseNumberUpstream(value, decimals),
        );
      }
    }
  });

  it("agrees with the string overload wherever a double is exact", () => {
    for (const value of [1234.56, 0.3, 99.99, 0.1, 1.005, 100, 0, -0.5]) {
      expect(Decimal.parse(value, 18).numerator).toBe(
        Decimal.parse(String(value), 18).numerator,
      );
    }
  });

  it("covers arithmetic, not only construction", () => {
    // Every arithmetic method funnels its argument through `getFraction`,
    // which had the same `toFixed` drift. `Decimal extends Fraction`, so this
    // reached further than parsing did.
    const one = new Decimal(1n, 0);
    expect(one.add(1234.56).toFixed(4)).toBe("1235.5600");
    expect(one.sub(99.99).toFixed(4)).toBe("-98.9900");
    expect(one.mul(0.3).toFixed(4)).toBe("0.3000");
    expect(new Decimal(2n, 0).div(0.1).toFixed(4)).toBe("20.0000");
  });

  it("rejects a non-finite number before it reaches parseUnits", () => {
    // The one deliberate divergence: upstream reaches viem and throws
    // "Number `NaN` is not a valid decimal number". Same outcome, further from
    // the caller. No finite value behaves differently.
    expect(() => Decimal.parse(NaN, 18)).toThrow(/not a finite number/);
    expect(() => Decimal.parse(Infinity, 18)).toThrow(/not a finite number/);
    expect(() => Decimal.parse(-Infinity, 18)).toThrow(/not a finite number/);
    expect(() => new Decimal(1n, 0).add(NaN)).toThrow(/not a finite number/);
  });
});
