/**
 * Display-layer conversions.
 *
 * Some collateral tokens — tokenised equities, "bStocks" — carry a UI
 * multiplier: a stock split changes what a balance *means* to a reader without
 * changing the balance itself. `balanceOf` is unchanged, and so is every
 * amount the contracts take.
 *
 * So there are two number spaces, and mixing them is the hazard this module
 * exists to prevent:
 *
 *   raw     — what the chain stores and what calldata MUST always carry
 *   display — raw x multiplier, what a person should be shown
 *
 * A unit price moves the opposite way, so USD value is preserved:
 *
 *   displayAmount x displayPrice ~= rawAmount x rawPrice
 *
 * That is an approximate identity, not a strict one. Both conversions floor,
 * and the two truncations only cancel when the multiplier divides 1e18 evenly
 * — true for a 2:1 or 4:1 split, false for 3:1 or 6:1, where the product comes
 * out slightly short. The drift is bounded by one unit of the larger operand
 * and it is display-only: nothing here reaches calldata. Do not use these
 * values for settlement arithmetic.
 *
 * {@link DisplayAmount} is a wrapper object, not a branded bigint, so it
 * cannot be passed where a `bigint` is expected. That matters because
 * `buildCallParams` accepts `readonly unknown[]`, which would swallow a brand
 * without complaint. Reaching `.value` is still possible — but it is a
 * deliberate, greppable act rather than an accident.
 *
 * This module is exported only from the `/display` subpath and is banned from
 * the builders by lint. Nothing here may ever be used to construct calldata.
 */

declare const displayBrand: unique symbol;

/** A quantity in display space. Cannot be passed where a bigint is expected. */
export interface DisplayAmount {
  readonly value: bigint;
  readonly [displayBrand]: true;
}

/** A per-unit price in display space. */
export interface DisplayUnitPrice {
  readonly value: bigint;
  readonly [displayBrand]: true;
}

/** 1e18 — the multiplier of a token with no split applied. */
export const UI_MULTIPLIER_ONE = 10n ** 18n;

const DECIMAL_STRING = /^\d+(\.\d+)?$/;

/**
 * Parse an API `collateralUiMultiplier` into 1e18 fixed point.
 *
 * The field is a decimal string (`"1"`, `"1.0"`, `"4"`). Anything that is not
 * a plain non-negative decimal — exponent notation, hex, whitespace, a
 * thousands separator, a negative, zero, null — falls back to 1. A wrong
 * multiplier misstates what a user is shown, so the parser refuses to guess.
 */
export function parseUiMultiplier(
  raw: string | number | null | undefined,
): bigint {
  if (raw === null || raw === undefined) return UI_MULTIPLIER_ONE;

  const text = typeof raw === "number" ? String(raw) : raw;
  if (!DECIMAL_STRING.test(text)) return UI_MULTIPLIER_ONE;

  const [whole, fraction = ""] = text.split(".");
  const padded = (fraction + "0".repeat(18)).slice(0, 18);
  const scaled = BigInt(whole) * UI_MULTIPLIER_ONE + BigInt(padded || "0");

  return scaled > 0n ? scaled : UI_MULTIPLIER_ONE;
}

/**
 * Convert a raw on-chain amount into what a user should be shown.
 *
 * Never feed the result to a builder. Use the raw value for calldata.
 */
export function toDisplayAmount(
  rawAmount: bigint,
  multiplier: bigint = UI_MULTIPLIER_ONE,
): DisplayAmount {
  const m = multiplier > 0n ? multiplier : UI_MULTIPLIER_ONE;
  return { value: (rawAmount * m) / UI_MULTIPLIER_ONE } as DisplayAmount;
}

/**
 * Convert a raw per-unit price into display space.
 *
 * Divides where {@link toDisplayAmount} multiplies, so that amount x price is
 * unchanged: a split shows more units at a proportionally lower price.
 */
export function toDisplayUnitPrice(
  rawUnitPrice: bigint,
  multiplier: bigint = UI_MULTIPLIER_ONE,
): DisplayUnitPrice {
  const m = multiplier > 0n ? multiplier : UI_MULTIPLIER_ONE;
  return { value: (rawUnitPrice * UI_MULTIPLIER_ONE) / m } as DisplayUnitPrice;
}

/**
 * Recover the raw amount behind a display amount.
 *
 * Present for round-tripping a user-entered figure back into something a
 * builder can take. Integer division means it is lossy for a multiplier that
 * does not divide evenly — treat the raw value as authoritative wherever you
 * still have it.
 */
export function fromDisplayAmount(
  amount: DisplayAmount,
  multiplier: bigint = UI_MULTIPLIER_ONE,
): bigint {
  const m = multiplier > 0n ? multiplier : UI_MULTIPLIER_ONE;
  return (amount.value * UI_MULTIPLIER_ONE) / m;
}
