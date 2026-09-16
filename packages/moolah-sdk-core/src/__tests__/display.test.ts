import { describe, it, expect } from "vitest";
import {
  parseUiMultiplier,
  toDisplayAmount,
  toDisplayUnitPrice,
  fromDisplayAmount,
  UI_MULTIPLIER_ONE,
} from "../display/index.js";

const WAD = 10n ** 18n;

describe("parseUiMultiplier", () => {
  it("parses plain decimal strings", () => {
    expect(parseUiMultiplier("1")).toBe(WAD);
    expect(parseUiMultiplier("1.0")).toBe(WAD);
    expect(parseUiMultiplier("4")).toBe(4n * WAD);
    expect(parseUiMultiplier("0.5")).toBe(WAD / 2n);
    expect(parseUiMultiplier("2.5")).toBe((5n * WAD) / 2n);
  });

  it("keeps full precision to 18 places and truncates beyond", () => {
    expect(parseUiMultiplier("1.000000000000000001")).toBe(WAD + 1n);
    expect(parseUiMultiplier("1.0000000000000000019")).toBe(WAD + 1n);
  });

  it("falls back to 1 for anything it cannot trust", () => {
    // A wrong multiplier misstates what a user is shown, so the parser
    // refuses to interpret formats it was not promised.
    for (const bad of [
      "",
      " ",
      "1 ",
      " 1",
      "1e18",
      "0x1",
      "1,0",
      "-1",
      "-1.5",
      "abc",
      "1.2.3",
      ".5",
      "+1",
      "Infinity",
      "NaN",
      null,
      undefined,
    ]) {
      expect(parseUiMultiplier(bad as string), String(bad)).toBe(WAD);
    }
  });

  it("treats zero as absent rather than as a multiplier", () => {
    expect(parseUiMultiplier("0")).toBe(WAD);
    expect(parseUiMultiplier("0.0")).toBe(WAD);
  });

  it("accepts a number as well as a string", () => {
    expect(parseUiMultiplier(1)).toBe(WAD);
    expect(parseUiMultiplier(4)).toBe(4n * WAD);
  });
});

describe("display conversions", () => {
  it("scales amounts up and prices down", () => {
    const m = 4n * WAD;
    expect(toDisplayAmount(100n, m).value).toBe(400n);
    expect(toDisplayUnitPrice(1000n, m).value).toBe(250n);
  });

  it("is the identity at a multiplier of one", () => {
    expect(toDisplayAmount(123n).value).toBe(123n);
    expect(toDisplayUnitPrice(456n).value).toBe(456n);
    expect(toDisplayAmount(123n, UI_MULTIPLIER_ONE).value).toBe(123n);
  });

  it("keeps USD value exactly invariant when the multiplier divides 1e18", () => {
    for (const m of [WAD, 2n * WAD, 4n * WAD, 10n * WAD, WAD / 2n]) {
      const rawAmount = 1_000_000n;
      const rawPrice = 7n * WAD;
      const displayed =
        toDisplayAmount(rawAmount, m).value *
        toDisplayUnitPrice(rawPrice, m).value;
      expect(displayed, `multiplier ${m}`).toBe(rawAmount * rawPrice);
    }
  });

  it("preserves USD value only approximately for a 3:1 or 6:1 split", () => {
    // Both conversions floor, and the truncations cancel only when the
    // multiplier divides 1e18. 3:1 and 6:1 are ordinary equity splits and they
    // do not, so the earlier test's multiplier set was proving less than it
    // looked. The drift is display-only and bounded — assert the bound rather
    // than an equality that does not hold.
    for (const m of [3n * WAD, 6n * WAD, 7n * WAD]) {
      const rawAmount = 1_000_000n;
      const rawPrice = 7n * WAD;
      const exact = rawAmount * rawPrice;
      const displayed =
        toDisplayAmount(rawAmount, m).value *
        toDisplayUnitPrice(rawPrice, m).value;
      expect(displayed, `multiplier ${m}`).toBeLessThanOrEqual(exact);
      const drift = exact - displayed;
      expect(drift, `multiplier ${m}`).toBeLessThan(
        toDisplayAmount(rawAmount, m).value + rawPrice,
      );
    }
  });

  it("round-trips an amount back to raw", () => {
    const m = 4n * WAD;
    expect(fromDisplayAmount(toDisplayAmount(1000n, m), m)).toBe(1000n);
  });

  it("falls back to the identity for a non-positive multiplier", () => {
    expect(toDisplayAmount(100n, 0n).value).toBe(100n);
    expect(toDisplayAmount(100n, -5n).value).toBe(100n);
    expect(toDisplayUnitPrice(100n, 0n).value).toBe(100n);
  });

  it("wraps results so they cannot be mistaken for a raw bigint", () => {
    const amount = toDisplayAmount(100n, 4n * WAD);
    expect(typeof amount).toBe("object");
    expect(typeof amount.value).toBe("bigint");
  });
});
