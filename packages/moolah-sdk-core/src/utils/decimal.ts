import { parseUnits } from "viem";

import {
  type BigintIsh,
  DivisionByZeroError,
  Fraction,
  getTenPower,
  RoundingMode,
} from "./fraction.js";

export class Decimal extends Fraction {
  public readonly decimal: number;

  public static readonly ZERO = new Decimal(0n, 0);

  public static readonly ONE = new Decimal(1n, 0);

  constructor(numerator: bigint, decimal: number = Fraction.DEFAULT_DECIMALS) {
    super(numerator, getTenPower(decimal));
    this.decimal = decimal;
  }

  public static fromFraction(fraction: Fraction): Decimal {
    const rounded = fraction.roundDown(Fraction.DEFAULT_DECIMALS);
    return new Decimal(rounded.numerator, Fraction.DEFAULT_DECIMALS);
  }

  public static parse(
    value: BigintIsh,
    decimal: number = Fraction.DEFAULT_DECIMALS,
  ) {
    const denominator = getTenPower(decimal);
    let numerator = 0n;
    if (typeof value === "string") {
      numerator = parseUnits(value, decimal);
    } else if (typeof value === "number") {
      numerator = parseUnits(value.toFixed(decimal), decimal);
    } else if (typeof value === "bigint") {
      numerator = value * denominator;
    } else {
      throw new Error(
        `parseFraction: Invalid argument type args: (${typeof value})`,
      );
    }

    return new Decimal(numerator, decimal);
  }

  private static getDecimal(
    arg1: Fraction | Decimal | BigintIsh,
    arg2?: number,
  ): Decimal {
    if (arg1 instanceof Decimal) {
      return arg1;
    }
    if (arg1 instanceof Fraction) {
      return Decimal.fromFraction(arg1);
    }

    if (arg2 == null) {
      if (typeof arg1 === "bigint") {
        return new Decimal(arg1, 0);
      }
      if (typeof arg1 === "number") {
        if (Number.isInteger(arg1)) {
          return new Decimal(BigInt(Math.round(arg1)), 0);
        }
        return new Decimal(
          parseUnits(
            arg1.toFixed(Fraction.DEFAULT_DECIMALS),
            Fraction.DEFAULT_DECIMALS,
          ),
          Fraction.DEFAULT_DECIMALS,
        );
      }

      if (typeof arg1 === "string") {
        if (Number.isInteger(Number(arg1))) {
          return new Decimal(BigInt(Math.round(Number(arg1))), 0);
        }
        return new Decimal(
          parseUnits(arg1, Fraction.DEFAULT_DECIMALS),
          Fraction.DEFAULT_DECIMALS,
        );
      }

      throw new Error(
        `getFraction: Invalid argument type args: (${typeof arg1}, ${typeof arg2})`,
      );
    }

    return new Decimal(BigInt(arg1), arg2);
  }

  negated(): Decimal {
    return new Decimal(-this.numerator, this.decimal);
  }

  add(
    other: Fraction | Decimal | BigintIsh,
    decimal?: number | BigintIsh,
  ): Decimal {
    const otherDecimal = Decimal.getDecimal(
      other,
      typeof decimal === "number" ? decimal : undefined,
    );

    if (this.decimal === otherDecimal.decimal) {
      return new Decimal(this.numerator + otherDecimal.numerator, this.decimal);
    }

    if (this.decimal < otherDecimal.decimal) {
      return new Decimal(
        this.numerator * getTenPower(otherDecimal.decimal - this.decimal) +
          otherDecimal.numerator,
        otherDecimal.decimal,
      );
    }

    return new Decimal(
      this.numerator +
        otherDecimal.numerator *
          getTenPower(this.decimal - otherDecimal.decimal),
      this.decimal,
    );
  }

  sub(
    other: Fraction | Decimal | BigintIsh,
    decimal?: number | BigintIsh,
  ): Decimal {
    const otherDecimal = Decimal.getDecimal(
      other,
      typeof decimal === "number" ? decimal : undefined,
    );

    if (this.decimal === otherDecimal.decimal) {
      return new Decimal(this.numerator - otherDecimal.numerator, this.decimal);
    }

    if (this.decimal < otherDecimal.decimal) {
      return new Decimal(
        this.numerator * getTenPower(otherDecimal.decimal - this.decimal) -
          otherDecimal.numerator,
        otherDecimal.decimal,
      );
    }

    return new Decimal(
      this.numerator -
        otherDecimal.numerator *
          getTenPower(this.decimal - otherDecimal.decimal),
      this.decimal,
    );
  }

  mul(
    other: Fraction | Decimal | BigintIsh,
    decimal?: number | BigintIsh,
  ): Decimal {
    const otherDecimal = Decimal.getDecimal(
      other,
      typeof decimal === "number" ? decimal : undefined,
    );

    return new Decimal(
      this.numerator * otherDecimal.numerator,
      this.decimal + otherDecimal.decimal,
    );
  }

  div(
    other: Fraction | Decimal | BigintIsh,
    decimal?: number | BigintIsh,
  ): Decimal {
    const otherDecimal = Decimal.getDecimal(
      other,
      typeof decimal === "number" ? decimal : undefined,
    );

    if (this.denominator * otherDecimal.numerator === 0n) {
      throw new DivisionByZeroError("Fraction: Division by zero");
    }

    return new Decimal(
      (this.numerator * otherDecimal.denominator ** 2n) /
        otherDecimal.numerator,
      this.decimal + otherDecimal.decimal,
    );
  }

  /** Rounds towards zero. */
  roundDown(decimals: number = 0): Decimal {
    if (decimals === this.decimal) return this;

    return new Decimal(
      (this.numerator * getTenPower(decimals)) / this.denominator,
      decimals,
    );
  }

  floor(decimals: number = 0): Decimal {
    if (decimals === this.decimal) return this;

    const numerator = this.numerator * getTenPower(decimals);
    const integer = numerator / this.denominator;
    const remainder = numerator % this.denominator;
    return new Decimal(integer - (remainder < 0n ? 1n : 0n), decimals);
  }

  ceiling(decimals: number = 0): Decimal {
    const denominator = getTenPower(decimals);
    if (decimals === this.decimal) return this;

    const numerator = this.numerator * denominator;
    const integer = numerator / this.denominator;
    const remainder = numerator % this.denominator;

    return new Decimal(integer + (remainder > 0n ? 1n : 0n), decimals);
  }

  round(decimals: number = 0): Decimal {
    const denominator = getTenPower(decimals);
    if (decimals === this.decimal) return this;

    const numerator = this.numerator * denominator;
    const carry = (numerator % this.denominator) * 2n >= this.denominator;
    return new Decimal(
      numerator / this.denominator + (carry ? 1n : 0n),
      decimals,
    );
  }

  /**
   * Rounding modes: 0 FLOOR, 1 CEILING, 2 ROUND
   */
  dp(
    decimals: number = 0,
    roundingMode: RoundingMode = RoundingMode.FLOOR,
  ): Decimal {
    if (roundingMode === RoundingMode.CEILING) {
      return this.ceiling(decimals);
    }
    if (roundingMode === RoundingMode.ROUND) {
      return this.round(decimals);
    }

    return this.floor(decimals);
  }

  rd = this.roundDown;

  plus = this.add;

  minus = this.sub;

  times = this.mul;

  dividedBy = this.div;

  decimalPlaces = this.dp;
}
