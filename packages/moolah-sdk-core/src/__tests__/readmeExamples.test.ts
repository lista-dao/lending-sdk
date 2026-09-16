import { describe, it, expect } from "vitest";
import { Decimal, RoundingMode } from "../index.js";

/**
 * The README's own numbers, asserted.
 *
 * Three of the five formatting examples were wrong: they showed rounded values
 * for methods that truncate. Nothing caught it because a README is not
 * executed — the parity, ABI, fork and testnet layers all check the SDK
 * against a chain, and none of them reads the docs.
 *
 * The examples an integrator copies are as load-bearing as the code, so the
 * ones that claim a specific output live here. If a formatter's behaviour
 * changes, this file fails and the README has to move with it.
 *
 * Source: README.md, "Creating Decimals", "Rounding & Precision" and
 * "Formatting Output".
 */
describe("README: Creating Decimals", () => {
  it("parses a decimal string", () => {
    expect(Decimal.parse("123.456", 18).toFixed(3)).toBe("123.456");
  });

  it("reads a number as the value written, not the double's expansion", () => {
    // This used to go through `value.toFixed(18)`, which does not format the
    // number you wrote — it expands the double you got, so 1234.56 came back
    // as 1234.5599… and the truncating formatters kept it that way. The
    // shortest round-tripping representation is the number the caller meant.
    expect(Decimal.parse(1234.56, 18).toFixed(4)).toBe("1234.5600");
    expect(Decimal.parse(0.3, 18).toFixed(4)).toBe("0.3000");
    expect(Decimal.parse(99.99, 18).toFixed(4)).toBe("99.9900");
    expect(Decimal.parse(1.005, 18).toFixed(4)).toBe("1.0050");
  });

  it("agrees with the string overload on every shape a number can take", () => {
    for (const n of [1234.56, 0.3, 99.99, 0.1, 1.005, 100, 0, -0.5, 0.000001]) {
      expect(Decimal.parse(n, 18).toFixed(8)).toBe(
        Decimal.parse(String(n), 18).toFixed(8),
      );
    }
  });

  it("writes exponential notation out in full", () => {
    // `String(1e21)` is "1e+21" and `parseUnits` will not take that.
    expect(Decimal.parse(1e21, 18).toString(0)).toBe("1000000000000000000000");
    expect(Decimal.parse(1e-7, 18).toFixed(8)).toBe("0.00000010");
  });

  it("rejects a number that is not finite", () => {
    expect(() => Decimal.parse(NaN, 18)).toThrow(/not a finite number/);
    expect(() => Decimal.parse(Infinity, 18)).toThrow(/not a finite number/);
  });

  it("wraps a raw bigint with its decimal places", () => {
    expect(new Decimal(123456000000000000000000n, 18).toFixed(1)).toBe(
      "123456.0",
    );
  });

  it("exposes the documented constants", () => {
    // `toFixed(0)` keeps a trailing ".0"; `toString(0)` does not.
    expect(Decimal.ZERO.toString(0)).toBe("0");
    expect(Decimal.ONE.toString(0)).toBe("1");
  });
});

describe("README: Rounding & Precision", () => {
  const value = Decimal.parse("123.456789", 18);

  it.each([
    ["dp FLOOR", value.dp(2, RoundingMode.FLOOR), "123.45"],
    ["dp CEILING", value.dp(2, RoundingMode.CEILING), "123.46"],
    ["dp ROUND", value.dp(2, RoundingMode.ROUND), "123.46"],
    ["floor", value.floor(2), "123.45"],
    ["ceiling", value.ceiling(2), "123.46"],
    ["round", value.round(2), "123.46"],
    ["roundDown", value.roundDown(2), "123.45"],
  ])("%s", (_label, actual, expected) => {
    expect(actual.toFixed(2)).toBe(expected);
  });
});

describe("README: Formatting Output", () => {
  const amount = Decimal.parse("1234567.123456789", 18);

  // The three that were documented as rounding. They truncate.
  it("toString truncates rather than rounding", () => {
    expect(amount.toString(4)).toBe("1234567.1234");
    expect(amount.toString(2)).toBe("1234567.12");
  });

  it("toFixed truncates and keeps trailing zeros", () => {
    expect(amount.toFixed(4)).toBe("1234567.1234");
    expect(amount.toFixed(8)).toBe("1234567.12345678");
  });

  it("toFormat truncates and adds separators", () => {
    expect(amount.toFormat(2)).toBe("1,234,567.12");
  });

  it("rounds only when asked", () => {
    expect(amount.round(4).toFixed(4)).toBe("1234567.1235");
  });

  it("shows only the integer part when coerced to a string", () => {
    // The footgun the README now warns about: `console.log(d)` and `${d}`
    // both land here, and the result looks like a plausible number.
    expect(String(amount)).toBe("1234567");
    expect(`${amount}`).toBe("1234567");
    expect(amount.toString()).toBe("1234567");
  });

  it("cannot be JSON.stringify'd, because it holds bigints", () => {
    expect(() => JSON.stringify({ amount })).toThrow(/BigInt/);
    expect(JSON.stringify({ amount: amount.toFixed(6) })).toBe(
      '{"amount":"1234567.123456"}',
    );
  });
});
