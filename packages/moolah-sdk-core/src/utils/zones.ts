/**
 * Lending zones, as the grouped-market feed reports them.
 *
 * The backend tags each market group with a `zones` array, and the zone is what
 * decides how a market must be read and written. It is not cosmetic: a Smart
 * Lending market's collateral is a DEX LP position behind a SmartProvider, and
 * reading it with the plain market path gets the wrong answer.
 *
 * The trap is zone 6. The backend emits it, it carries a populated
 * `smartCollateralConfig`, and it looks exactly like a Smart Lending market
 * from the outside — but its "provider" implements none of the SmartProvider
 * interface. The reference frontend drops zone 6 on purpose and documents it as
 * dirty data, so filtering on the config alone is unsafe.
 */
export const LENDING_ZONE = {
  /** DEX-LP collateral behind a SmartProvider. Smart Lending. */
  SMART: 3,
  /** Tokenised-equity collateral, which carries a scaled-UI multiplier. */
  BSTOCK: 5,
  /**
   * Known bad data. The backend still emits it; the reference frontend leaves
   * it unmapped so it never reaches the UI. Filter it out.
   */
  DIRTY: 6,
} as const;

export type LendingZone = (typeof LENDING_ZONE)[keyof typeof LENDING_ZONE];

/** Does this market group carry the given zone? */
export function hasZone(
  zones: readonly number[] | number | undefined,
  zone: number,
): boolean {
  if (zones === undefined) return false;
  return Array.isArray(zones) ? zones.includes(zone) : zones === zone;
}

/**
 * Is this a genuine Smart Lending market?
 *
 * Checks the zone rather than the presence of `smartCollateralConfig`, which
 * zone 6 also carries.
 */
export function isSmartLendingZone(
  zones: readonly number[] | number | undefined,
): boolean {
  return hasZone(zones, LENDING_ZONE.SMART);
}
