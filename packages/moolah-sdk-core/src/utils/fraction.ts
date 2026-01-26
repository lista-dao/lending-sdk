/* eslint-disable max-classes-per-file */
import { parseUnits } from 'viem'

export type BigintIsh = bigint | number | string

const tenPowers = Array.from({ length: 24 }, (_, i) => 10n ** BigInt(i))
export const getTenPower = (decimal: number) =>
    tenPowers[decimal] ?? 10n ** BigInt(decimal)

export class FractionError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'FractionError'
    }
}

export class InvalidFractionError extends FractionError {
    constructor(message: string) {
        super(message)
        this.name = 'InvalidFractionError'
    }
}

export class DivisionByZeroError extends FractionError {
    constructor(message: string) {
        super(message)
        this.name = 'DivisionByZeroError'
    }
}

/**
 * Rounding modes
 * 0 FLOOR: Rounds towards zero.
 * 1 CEILING: Rounds towards positive infinity.
 * 2 ROUND: Rounds to the nearest integer.
 */
export enum RoundingMode {
    FLOOR = 0,
    CEILING = 1,
    ROUND = 2,
}

const addCommas = (value: bigint): string => {
    const integer = value.toString()

    let result = ''
    for (let i = integer.length - 1, count = 0; i >= 0; i--, count++) {
        result = integer[i] + result
        if (count % 3 === 2 && i !== 0) {
            result = `,${result}`
        }
    }

    const resultStr = result.length > 0 ? result : '0'

    return resultStr
}

const toString = (
    value: Fraction,
    decimals: number,
    options?: {
        removeTrailingZeros?: boolean
        commas?: boolean
    },
): string => {
    const tenPower = getTenPower(decimals)
    if (tenPower !== value.denominator) {
        throw new Error('toString: Invalid argument type args: (decimals)')
    }

    const { removeTrailingZeros = false, commas = false } = options ?? {}

    const integer = value.numerator / tenPower
    const fraction = value.numerator % tenPower
    let fractionStr = (fraction < 0n ? -fraction : fraction)
        .toString()
        .padStart(decimals, '0')

    const absInteger = integer < 0n ? -integer : integer
    let integerStr = absInteger.toString()

    if (removeTrailingZeros) {
        fractionStr = fractionStr.replace(/(0+)$/, '')
    }
    if (commas) {
        integerStr = addCommas(absInteger)
    }

    const prefix = value.isNegative() ? '-' : ''

    return fractionStr.length > 0
        ? `${prefix}${integerStr}.${fractionStr}`
        : `${prefix}${integerStr}`
}

export function parseNumber(value: number, decimals: number = 18): bigint {
    // if value contains 'e', use scientific notation
    if (value.toString().includes('e')) {
        const [integer, fraction] = value.toString().split('e')
        // integer is the integer part, fraction is the fractional part
        const integerValue = parseUnits(integer, decimals)
        // exponent is the power of 10
        const exponentValue = Math.round(Number(fraction))

        if (exponentValue > 0) {
            return integerValue * 10n ** BigInt(exponentValue)
        }
        return integerValue / 10n ** BigInt(-exponentValue)
    }

    return parseUnits(value.toString(), decimals)
}

export class Fraction {
    public readonly numerator: bigint

    public readonly denominator: bigint

    public static readonly ZERO = new Fraction(0n, 1n)

    public static readonly ONE = new Fraction(1n, 1n)

    public static readonly DEFAULT_DECIMALS = 18

    constructor(numerator: bigint, denominator: bigint = 1n) {
        if (denominator === 0n) {
            throw new InvalidFractionError('Fraction: Denominator cannot be 0')
        }

        this.numerator = BigInt(numerator)
        this.denominator = BigInt(denominator)
    }

    /**
     * Create a Fraction from a decimal number
     * @param numerator - The numerator of the Fraction
     * @param decimal - The decimal places of the Fraction, default is 18
     * @returns The Fraction
     */
    public static createByDecimal(
        numerator: bigint,
        decimal = Fraction.DEFAULT_DECIMALS,
    ): Fraction {
        return new Fraction(numerator, getTenPower(decimal))
    }

    public static parse(
        value: BigintIsh,
        decimal: number = Fraction.DEFAULT_DECIMALS,
    ) {
        const denominator = getTenPower(decimal)
        let numerator = 0n
        if (typeof value === 'string') {
            numerator = parseUnits(value, decimal)
        } else if (typeof value === 'number') {
            numerator = parseNumber(value, decimal)
        } else if (typeof value === 'bigint') {
            numerator = value * denominator
        } else {
            throw new Error(
                `parseFraction: Invalid argument type args: (${typeof value})`,
            )
        }

        return new Fraction(numerator, denominator)
    }

    private static getFraction(
        arg1: Fraction | BigintIsh,
        arg2?: BigintIsh,
    ): Fraction {
        if (arg1 instanceof Fraction) {
            return arg1
        }

        if (arg2 == null) {
            if (typeof arg1 === 'bigint') {
                return new Fraction(arg1, 1n)
            }
            if (typeof arg1 === 'number') {
                if (Number.isInteger(arg1)) {
                    return new Fraction(BigInt(Math.round(arg1)), 1n)
                }
                return new Fraction(
                    parseUnits(
                        arg1.toFixed(Fraction.DEFAULT_DECIMALS),
                        Fraction.DEFAULT_DECIMALS,
                    ),
                    getTenPower(Fraction.DEFAULT_DECIMALS),
                )
            }

            if (typeof arg1 === 'string') {
                if (Number.isInteger(Number(arg1))) {
                    return new Fraction(BigInt(Math.round(Number(arg1))), 1n)
                }
                return new Fraction(
                    parseUnits(arg1, Fraction.DEFAULT_DECIMALS),
                    getTenPower(Fraction.DEFAULT_DECIMALS),
                )
            }

            throw new Error(
                `getFraction: Invalid argument type args: (${typeof arg1}, ${typeof arg2})`,
            )
        }

        return new Fraction(BigInt(arg1), BigInt(arg2))
    }

    negated(): Fraction {
        return new Fraction(-this.numerator, this.denominator)
    }

    add(other: Fraction | BigintIsh, denominator?: BigintIsh): Fraction {
        const otherFraction = Fraction.getFraction(other, denominator)

        if (this.denominator === otherFraction.denominator) {
            return new Fraction(
                this.numerator + otherFraction.numerator,
                this.denominator,
            )
        }

        if (
            this.denominator < getTenPower(6) &&
            otherFraction.denominator < getTenPower(6)
        ) {
            return new Fraction(
                this.numerator * otherFraction.denominator +
                otherFraction.numerator * this.denominator,
                this.denominator * otherFraction.denominator,
            )
        }

        return new Fraction(
            this.roundDown(Fraction.DEFAULT_DECIMALS).numerator +
            otherFraction.roundDown(Fraction.DEFAULT_DECIMALS).numerator,
            getTenPower(Fraction.DEFAULT_DECIMALS),
        )
    }

    sub(other: Fraction | BigintIsh, denominator?: BigintIsh): Fraction {
        const otherFraction = Fraction.getFraction(other, denominator)

        if (this.denominator === otherFraction.denominator) {
            return new Fraction(
                this.numerator - otherFraction.numerator,
                this.denominator,
            )
        }

        if (
            this.denominator < getTenPower(6) &&
            otherFraction.denominator < getTenPower(6)
        ) {
            return new Fraction(
                this.numerator * otherFraction.denominator -
                otherFraction.numerator * this.denominator,
                this.denominator * otherFraction.denominator,
            )
        }

        return new Fraction(
            this.roundDown(Fraction.DEFAULT_DECIMALS).numerator -
            otherFraction.roundDown(Fraction.DEFAULT_DECIMALS).numerator,
            getTenPower(Fraction.DEFAULT_DECIMALS),
        )
    }

    mul(other: Fraction | BigintIsh, denominator?: BigintIsh): Fraction {
        const otherFraction = Fraction.getFraction(other, denominator)

        return new Fraction(
            this.numerator * otherFraction.numerator,
            this.denominator * otherFraction.denominator,
        )
    }

    div(other: Fraction | BigintIsh, denominator?: BigintIsh): Fraction {
        const otherFraction = Fraction.getFraction(other, denominator)
        if (this.denominator * otherFraction.numerator === 0n) {
            throw new DivisionByZeroError('Fraction: Division by zero')
        }

        return new Fraction(
            this.numerator * otherFraction.denominator,
            this.denominator * otherFraction.numerator,
        )
    }

    eq(other: Fraction | BigintIsh, denominator?: BigintIsh): boolean {
        const otherFraction = Fraction.getFraction(other, denominator)

        return (
            this.numerator * otherFraction.denominator ===
            otherFraction.numerator * this.denominator
        )
    }

    gt(other: Fraction | BigintIsh, denominator?: BigintIsh): boolean {
        const otherFraction = Fraction.getFraction(other, denominator)

        return (
            this.numerator * otherFraction.denominator >
            otherFraction.numerator * this.denominator
        )
    }

    gte(other: Fraction | BigintIsh, denominator?: BigintIsh): boolean {
        const otherFraction = Fraction.getFraction(other, denominator)
        return this.gt(otherFraction) || this.eq(otherFraction)
    }

    lt(other: Fraction | BigintIsh, denominator?: BigintIsh): boolean {
        const otherFraction = Fraction.getFraction(other, denominator)
        return !this.gte(otherFraction)
    }

    lte(other: Fraction | BigintIsh, denominator?: BigintIsh): boolean {
        const otherFraction = Fraction.getFraction(other, denominator)
        return !this.gt(otherFraction)
    }

    isPositive(): boolean {
        return (
            (this.numerator > 0n && this.denominator > 0n) ||
            (this.numerator < 0n && this.denominator < 0n)
        )
    }

    isNegative(): boolean {
        return (
            (this.numerator < 0n && this.denominator > 0n) ||
            (this.numerator > 0n && this.denominator < 0n)
        )
    }

    isZero(): boolean {
        return this.numerator === 0n
    }

    /** Rounds towards zero. */
    roundDown(decimals: number = 0): Fraction {
        const denominator = getTenPower(decimals)
        if (denominator === this.denominator) return this

        return new Fraction(
            (this.numerator * denominator) / this.denominator,
            denominator,
        )
    }

    floor(decimals: number = 0): Fraction {
        const denominator = getTenPower(decimals)
        if (denominator === this.denominator) return this

        const numerator = this.numerator * denominator
        const integer = numerator / this.denominator
        const remainder = numerator % this.denominator

        return new Fraction(integer - (remainder < 0n ? 1n : 0n), denominator)
    }

    ceiling(decimals: number = 0): Fraction {
        const denominator = getTenPower(decimals)
        if (denominator === this.denominator) return this

        const numerator = this.numerator * denominator
        const integer = numerator / this.denominator
        const remainder = numerator % this.denominator

        return new Fraction(integer + (remainder > 0n ? 1n : 0n), denominator)
    }

    round(decimals: number = 0): Fraction {
        const denominator = getTenPower(decimals)
        if (denominator === this.denominator) return this

        const carry =
            ((this.numerator * denominator) % this.denominator) * 2n >=
            this.denominator
        return new Fraction(
            (this.numerator * denominator) / this.denominator + (carry ? 1n : 0n),
            denominator,
        )
    }

    /**
     * Rounding modes: 0 FLOOR, 1 CEILING, 2 ROUND
     */
    dp(
        decimals: number = 0,
        roundingMode: RoundingMode = RoundingMode.FLOOR,
    ): Fraction {
        if (roundingMode === RoundingMode.CEILING) {
            return this.ceiling(decimals)
        }
        if (roundingMode === RoundingMode.ROUND) {
            return this.round(decimals)
        }

        return this.floor(decimals)
    }

    /**
     * Rounding modes: 0 FLOOR, 1 CEILING, 2 ROUND
     */
    toString(
        decimals: number = 0,
        roundingMode: RoundingMode = RoundingMode.FLOOR,
    ): string {
        const rounded = this.dp(decimals, roundingMode)
        return toString(rounded, decimals, { removeTrailingZeros: true })
    }

    /**
     * Rounding modes: 0 FLOOR, 1 CEILING, 2 ROUND
     */
    toFixed(
        decimals: number = 0,
        roundingMode: RoundingMode = RoundingMode.FLOOR,
    ): string {
        const rounded = this.dp(decimals, roundingMode)
        return toString(rounded, decimals)
    }

    /**
     * Rounding modes: 0 FLOOR, 1 CEILING, 2 ROUND
     */
    toFormat(
        decimals: number = 0,
        roundingMode: RoundingMode = RoundingMode.FLOOR,
    ) {
        const rounded = this.dp(decimals, roundingMode)
        return toString(rounded, decimals, {
            commas: true,
            removeTrailingZeros: true,
        })
    }

    valueOf(): number {
        return Number(this.numerator) / Number(this.denominator)
    }

    plus = this.add

    minus = this.sub

    times = this.mul

    dividedBy = this.div

    equals = this.eq

    greaterThan = this.gt

    greaterThanOrEqual = this.gte

    lessThan = this.lt

    lessThanOrEqual = this.lte

    decimalPlaces = this.dp
}
