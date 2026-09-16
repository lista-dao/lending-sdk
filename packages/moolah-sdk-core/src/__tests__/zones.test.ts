import { describe, it, expect } from "vitest";
import { LENDING_ZONE, hasZone, isSmartLendingZone } from "../utils/zones.js";

describe("lending zones", () => {
  // The trap this exists for: zone 6 carries a populated
  // smartCollateralConfig and is indistinguishable from Smart Lending unless
  // you look at the zone. Two of the six markets on BSC Testnet that carry the
  // config are zone 6, and their "provider" implements none of the
  // SmartProvider interface.
  it("treats only zone 3 as Smart Lending", () => {
    expect(isSmartLendingZone([LENDING_ZONE.SMART])).toBe(true);
    expect(isSmartLendingZone([LENDING_ZONE.DIRTY])).toBe(false);
    expect(isSmartLendingZone([LENDING_ZONE.BSTOCK])).toBe(false);
  });

  it("accepts a bare number as well as an array", () => {
    expect(isSmartLendingZone(3)).toBe(true);
    expect(isSmartLendingZone(6)).toBe(false);
  });

  it("treats a missing zone as not matching, rather than throwing", () => {
    expect(hasZone(undefined, LENDING_ZONE.SMART)).toBe(false);
    expect(isSmartLendingZone(undefined)).toBe(false);
  });

  it("matches when a group carries several zones", () => {
    expect(isSmartLendingZone([LENDING_ZONE.BSTOCK, LENDING_ZONE.SMART])).toBe(
      true,
    );
  });
});
