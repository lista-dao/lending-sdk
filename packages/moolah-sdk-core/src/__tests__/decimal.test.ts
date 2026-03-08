import { describe, it, expect } from "vitest";
import {
  Fraction,
  DivisionByZeroError,
  InvalidFractionError,
  RoundingMode,
  getTenPower,
  parseNumber,
} from "../utils/fraction.js";
import { Decimal } from "../utils/decimal.js";

describe("Fraction dp edge cases", () => {
  it("should use CEILING mode", () => {
    const frac = Fraction.parse("1.555", 18);
    const result = frac.dp(2, RoundingMode.CEILING);
    expect(result.numerator).toBe(156n);
  });

  it("should use ROUND mode", () => {
    const frac = Fraction.parse("1.555", 18);
    const result = frac.dp(2, RoundingMode.ROUND);
    expect(result.numerator).toBe(156n);
  });

  it("should use FLOOR mode by default", () => {
    const frac = Fraction.parse("1.555", 18);
    const result = frac.dp(2, RoundingMode.FLOOR);
    expect(result.numerator).toBe(155n);
  });
});

describe("Fraction getFraction edge cases", () => {
  it("should handle string integer via arithmetic", () => {
    const frac = new Fraction(1n, 1n);
    // Adding a string integer triggers getFraction with string
    const result = frac.add("5");
    expect(result.valueOf()).toBeCloseTo(6, 10);
  });

  it("should handle string decimal via arithmetic", () => {
    const frac = new Fraction(1n, 1n);
    // Adding a string decimal triggers getFraction with string
    const result = frac.add("0.5");
    expect(result.valueOf()).toBeCloseTo(1.5, 10);
  });

  it("should handle integer number via arithmetic", () => {
    const frac = new Fraction(1n, 1n);
    // Adding an integer number triggers lines 182-184
    const result = frac.add(5);
    expect(result.valueOf()).toBeCloseTo(6, 10);
  });

  it("should handle non-integer number via arithmetic", () => {
    const frac = new Fraction(1n, 1n);
    // Adding a non-integer number triggers lines 185-192
    const result = frac.add(0.5);
    expect(result.valueOf()).toBeCloseTo(1.5, 10);
  });

  it("should handle two args via arithmetic", () => {
    const frac = new Fraction(1n, 1n);
    // Using add with two args triggers getFraction with denominator
    const result = frac.add(3n, 2n); // 3/2 = 1.5
    expect(result.valueOf()).toBeCloseTo(2.5, 10);
  });

  it("should handle large denominator subtraction fallback", () => {
    // Create fractions with large denominators (>= 10^6) to trigger fallback
    const frac1 = new Fraction(15n * 10n ** 17n, 10n ** 18n); // 1.5 with 18 decimals
    const frac2 = new Fraction(5n * 10n ** 17n, 10n ** 18n); // 0.5 with 18 decimals
    const result = frac1.sub(frac2);
    expect(result.valueOf()).toBeCloseTo(1, 10);
  });

  it("should throw error for invalid type in getFraction", () => {
    const frac = new Fraction(1n, 1n);
    // Passing undefined triggers the error throw in getFraction
    expect(() => frac.add(undefined as unknown as bigint)).toThrow(
      "getFraction: Invalid argument type",
    );
  });
});

describe("getTenPower", () => {
  it("should return correct powers of 10", () => {
    expect(getTenPower(0)).toBe(1n);
    expect(getTenPower(1)).toBe(10n);
    expect(getTenPower(6)).toBe(1000000n);
    expect(getTenPower(18)).toBe(10n ** 18n);
  });

  it("should handle large decimals", () => {
    expect(getTenPower(24)).toBe(10n ** 24n);
    expect(getTenPower(30)).toBe(10n ** 30n);
  });
});

describe("parseNumber", () => {
  it("should parse regular numbers", () => {
    expect(parseNumber(1, 18)).toBe(10n ** 18n);
    expect(parseNumber(0.5, 18)).toBe(5n * 10n ** 17n);
  });

  it("should parse scientific notation", () => {
    expect(parseNumber(1e18, 0)).toBe(10n ** 18n);
    expect(parseNumber(1e-6, 18)).toBe(10n ** 12n);
  });
});

describe("Fraction", () => {
  describe("constructor", () => {
    it("should create a valid fraction", () => {
      const frac = new Fraction(3n, 4n);
      expect(frac.numerator).toBe(3n);
      expect(frac.denominator).toBe(4n);
    });

    it("should throw on zero denominator", () => {
      expect(() => new Fraction(1n, 0n)).toThrow(InvalidFractionError);
    });

    it("should handle negative fractions", () => {
      const frac = new Fraction(-3n, 4n);
      expect(frac.numerator).toBe(-3n);
      expect(frac.isNegative()).toBe(true);
    });
  });

  describe("static constants", () => {
    it("should have ZERO", () => {
      expect(Fraction.ZERO.numerator).toBe(0n);
      expect(Fraction.ZERO.isZero()).toBe(true);
    });

    it("should have ONE", () => {
      expect(Fraction.ONE.numerator).toBe(1n);
      expect(Fraction.ONE.denominator).toBe(1n);
    });
  });

  describe("parse", () => {
    it("should parse string values", () => {
      const frac = Fraction.parse("1.5", 18);
      expect(frac.numerator).toBe(15n * 10n ** 17n);
    });

    it("should parse number values", () => {
      const frac = Fraction.parse(1.5, 18);
      expect(frac.numerator).toBe(15n * 10n ** 17n);
    });

    it("should parse bigint values", () => {
      const frac = Fraction.parse(100n, 18);
      expect(frac.numerator).toBe(100n * 10n ** 18n);
    });

    it("should parse integers", () => {
      const frac = Fraction.parse(5, 18);
      expect(frac.numerator).toBe(5n * 10n ** 18n);
    });
  });

  describe("arithmetic operations", () => {
    const half = new Fraction(1n, 2n);
    const quarter = new Fraction(1n, 4n);

    it("should add fractions", () => {
      const result = half.add(quarter);
      expect(result.valueOf()).toBeCloseTo(0.75, 10);
    });

    it("should subtract fractions", () => {
      const result = half.sub(quarter);
      expect(result.valueOf()).toBeCloseTo(0.25, 10);
    });

    it("should multiply fractions", () => {
      const result = half.mul(quarter);
      expect(result.valueOf()).toBeCloseTo(0.125, 10);
    });

    it("should divide fractions", () => {
      const result = half.div(quarter);
      expect(result.valueOf()).toBeCloseTo(2, 10);
    });

    it("should throw on division by zero", () => {
      expect(() => half.div(Fraction.ZERO)).toThrow(DivisionByZeroError);
    });

    it("should add with bigint", () => {
      const result = half.add(1n);
      expect(result.valueOf()).toBeCloseTo(1.5, 10);
    });

    it("should add with number", () => {
      const result = half.add(0.5);
      expect(result.valueOf()).toBeCloseTo(1, 10);
    });
  });

  describe("comparison operations", () => {
    const half = new Fraction(1n, 2n);
    const quarter = new Fraction(1n, 4n);
    const anotherHalf = new Fraction(2n, 4n);

    it("should check equality", () => {
      expect(half.eq(anotherHalf)).toBe(true);
      expect(half.eq(quarter)).toBe(false);
    });

    it("should check greater than", () => {
      expect(half.gt(quarter)).toBe(true);
      expect(quarter.gt(half)).toBe(false);
    });

    it("should check greater than or equal", () => {
      expect(half.gte(quarter)).toBe(true);
      expect(half.gte(anotherHalf)).toBe(true);
    });

    it("should check less than", () => {
      expect(quarter.lt(half)).toBe(true);
      expect(half.lt(quarter)).toBe(false);
    });

    it("should check less than or equal", () => {
      expect(quarter.lte(half)).toBe(true);
      expect(half.lte(anotherHalf)).toBe(true);
    });
  });

  describe("state checks", () => {
    it("should check positive", () => {
      expect(new Fraction(1n, 2n).isPositive()).toBe(true);
      expect(new Fraction(-1n, 2n).isPositive()).toBe(false);
    });

    it("should check negative", () => {
      expect(new Fraction(-1n, 2n).isNegative()).toBe(true);
      expect(new Fraction(1n, 2n).isNegative()).toBe(false);
    });

    it("should check zero", () => {
      expect(new Fraction(0n, 1n).isZero()).toBe(true);
      expect(new Fraction(1n, 1n).isZero()).toBe(false);
    });
  });

  describe("rounding", () => {
    const frac = new Fraction(15n, 10n); // 1.5

    it("should round down (floor)", () => {
      const result = frac.floor(0);
      expect(result.numerator).toBe(1n);
    });

    it("should round up (ceiling)", () => {
      const result = frac.ceiling(0);
      expect(result.numerator).toBe(2n);
    });

    it("should round to nearest", () => {
      const result = frac.round(0);
      expect(result.numerator).toBe(2n);
    });

    it("should roundDown", () => {
      const result = frac.roundDown(0);
      expect(result.numerator).toBe(1n);
    });
  });

  describe("formatting", () => {
    const frac = Fraction.parse("1234.567", 18);

    it("should convert to string", () => {
      expect(frac.toString(2)).toBe("1234.56");
    });

    it("should convert to fixed", () => {
      expect(frac.toFixed(3)).toBe("1234.567");
    });

    it("should format with commas", () => {
      expect(frac.toFormat(2)).toBe("1,234.56");
    });

    it("should return valueOf", () => {
      expect(frac.valueOf()).toBeCloseTo(1234.567, 3);
    });
  });

  describe("negation", () => {
    it("should negate positive fraction", () => {
      const frac = new Fraction(3n, 4n);
      const negated = frac.negated();
      expect(negated.numerator).toBe(-3n);
    });

    it("should negate negative fraction", () => {
      const frac = new Fraction(-3n, 4n);
      const negated = frac.negated();
      expect(negated.numerator).toBe(3n);
    });
  });

  describe("aliases", () => {
    const frac = new Fraction(1n, 2n);

    it("plus should be same as add", () => {
      expect(frac.plus(frac).valueOf()).toBe(frac.add(frac).valueOf());
    });

    it("minus should be same as sub", () => {
      expect(frac.minus(frac).valueOf()).toBe(frac.sub(frac).valueOf());
    });

    it("times should be same as mul", () => {
      expect(frac.times(frac).valueOf()).toBe(frac.mul(frac).valueOf());
    });

    it("dividedBy should be same as div", () => {
      expect(frac.dividedBy(frac).valueOf()).toBe(frac.div(frac).valueOf());
    });
  });
});

describe("Decimal", () => {
  describe("constructor", () => {
    it("should create a decimal", () => {
      const dec = new Decimal(1000000000000000000n, 18);
      expect(dec.decimal).toBe(18);
      expect(dec.numerator).toBe(1000000000000000000n);
    });
  });

  describe("static constants", () => {
    it("should have ZERO", () => {
      expect(Decimal.ZERO.isZero()).toBe(true);
    });

    it("should have ONE", () => {
      expect(Decimal.ONE.numerator).toBe(1n);
    });
  });

  describe("parse", () => {
    it("should parse string", () => {
      const dec = Decimal.parse("1.5", 18);
      expect(dec.decimal).toBe(18);
    });

    it("should parse number", () => {
      const dec = Decimal.parse(1.5, 18);
      expect(dec.decimal).toBe(18);
    });

    it("should parse bigint", () => {
      const dec = Decimal.parse(100n, 18);
      expect(dec.numerator).toBe(100n * 10n ** 18n);
    });

    it("should throw error for invalid type", () => {
      expect(() => Decimal.parse(undefined as unknown as bigint, 18)).toThrow(
        "parseFraction: Invalid argument type",
      );
    });
  });

  describe("fromFraction", () => {
    it("should convert fraction to decimal", () => {
      const frac = new Fraction(3n, 2n);
      const dec = Decimal.fromFraction(frac);
      expect(dec.decimal).toBe(18);
    });
  });

  describe("arithmetic", () => {
    const one = Decimal.parse("1", 18);
    const half = Decimal.parse("0.5", 18);

    it("should add decimals", () => {
      const result = one.add(half);
      expect(result.valueOf()).toBeCloseTo(1.5, 10);
    });

    it("should subtract decimals", () => {
      const result = one.sub(half);
      expect(result.valueOf()).toBeCloseTo(0.5, 10);
    });

    it("should multiply decimals", () => {
      const result = one.mul(half);
      expect(result.valueOf()).toBeCloseTo(0.5, 10);
    });

    it("should divide decimals", () => {
      const result = one.div(half);
      expect(result.valueOf()).toBeCloseTo(2, 10);
    });

    it("should throw on division by zero", () => {
      expect(() => one.div(Decimal.ZERO)).toThrow(DivisionByZeroError);
    });
  });

  describe("rounding", () => {
    const dec = Decimal.parse("1.555", 18);

    it("should roundDown", () => {
      const result = dec.roundDown(2);
      expect(result.numerator).toBe(155n);
      expect(result.decimal).toBe(2);
    });

    it("should floor", () => {
      const result = dec.floor(2);
      expect(result.numerator).toBe(155n);
    });

    it("should ceiling", () => {
      const result = dec.ceiling(2);
      expect(result.numerator).toBe(156n);
    });

    it("should round", () => {
      const result = dec.round(2);
      expect(result.numerator).toBe(156n);
    });

    it("should dp with RoundingMode.FLOOR", () => {
      const result = dec.dp(2, RoundingMode.FLOOR);
      expect(result.numerator).toBe(155n);
    });

    it("should dp with RoundingMode.CEILING", () => {
      const result = dec.dp(2, RoundingMode.CEILING);
      expect(result.numerator).toBe(156n);
    });

    it("should dp with RoundingMode.ROUND", () => {
      const result = dec.dp(2, RoundingMode.ROUND);
      expect(result.numerator).toBe(156n);
    });
  });

  describe("negation", () => {
    it("should negate decimal", () => {
      const dec = Decimal.parse("1.5", 18);
      const negated = dec.negated();
      expect(negated.isNegative()).toBe(true);
    });
  });

  describe("different decimal places", () => {
    it("should add decimals with different precisions", () => {
      const dec6 = new Decimal(1500000n, 6); // 1.5 with 6 decimals
      const dec18 = new Decimal(500000000000000000n, 18); // 0.5 with 18 decimals
      const result = dec6.add(dec18);
      expect(result.valueOf()).toBeCloseTo(2, 10);
    });

    it("should subtract decimals with different precisions", () => {
      const dec6 = new Decimal(1500000n, 6);
      const dec18 = new Decimal(500000000000000000n, 18);
      const result = dec6.sub(dec18);
      expect(result.valueOf()).toBeCloseTo(1, 10);
    });
  });

  describe("aliases", () => {
    const dec = Decimal.parse("1", 18);

    it("rd should be same as roundDown", () => {
      const a = dec.rd(2);
      const b = dec.roundDown(2);
      expect(a.numerator).toBe(b.numerator);
    });

    it("decimalPlaces should be same as dp", () => {
      const a = dec.decimalPlaces(2);
      const b = dec.dp(2);
      expect(a.numerator).toBe(b.numerator);
    });
  });

  describe("getDecimal edge cases (via arithmetic)", () => {
    it("should handle Fraction conversion", () => {
      const dec = Decimal.parse("1", 18);
      const frac = new Fraction(3n, 2n); // 1.5
      // Adding a Fraction triggers getDecimal with Fraction (line 53-55)
      const result = dec.add(frac);
      // 1 + 1.5 = 2.5
      expect(result.valueOf()).toBeCloseTo(2.5, 10);
    });

    it("should handle bigint without decimal parameter", () => {
      const dec = Decimal.parse("1", 18);
      // Adding a bigint without decimal param triggers line 58-60
      const result = dec.add(5n);
      // 1 + 5 = 6
      expect(result.valueOf()).toBeCloseTo(6, 10);
    });

    it("should handle non-integer number without decimal parameter", () => {
      const dec = Decimal.parse("1", 18);
      // Adding a non-integer number without decimal param triggers lines 65-72
      const result = dec.add(0.5);
      // 1 + 0.5 = 1.5
      expect(result.valueOf()).toBeCloseTo(1.5, 10);
    });

    it("should handle integer number without decimal parameter", () => {
      const dec = Decimal.parse("1", 18);
      // Adding an integer number triggers line 62-63
      const result = dec.add(2);
      expect(result.valueOf()).toBeCloseTo(3, 10);
    });

    it("should handle string integer without decimal parameter", () => {
      const dec = Decimal.parse("1", 18);
      // Adding an integer string triggers line 75-76
      const result = dec.add("2");
      expect(result.valueOf()).toBeCloseTo(3, 10);
    });

    it("should handle string decimal without decimal parameter", () => {
      const dec = Decimal.parse("1", 18);
      // Adding a decimal string triggers line 78-81
      const result = dec.add("0.5");
      expect(result.valueOf()).toBeCloseTo(1.5, 10);
    });

    it("should throw error for invalid type", () => {
      const dec = Decimal.parse("1", 18);
      // Passing an invalid type should throw error (lines 84-86)
      expect(() => dec.add(undefined as unknown as bigint)).toThrow(
        "getFraction: Invalid argument type",
      );
    });

    it("should use getDecimal with decimal parameter", () => {
      const dec = Decimal.parse("1", 18);
      // Using add with decimal param triggers line 89
      // add(5, 6) means "add 5 with 6 decimal places" = 5 / 10^6 = 0.000005
      const result = dec.add(5, 6);
      // 1 + 0.000005 = 1.000005
      expect(result.valueOf()).toBeCloseTo(1.000005, 10);
    });
  });
});
