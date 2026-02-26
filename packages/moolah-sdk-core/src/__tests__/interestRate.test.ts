import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getRawBorrowRate,
  getBorrowRateInfo,
  getAnnualBorrowRate,
  getApy,
  computeBorrowRate,
  getInterestRates,
  getFixedRateInterestRates,
} from "../calculations/interestRate";

describe("getAnnualBorrowRate", () => {
  it("should convert per-second rate to annual rate", () => {
    // ~5% APY rate per second (5% / 31536000 seconds * 1e18 ≈ 1585489599)
    const ratePerSecond = 1585489599n;
    const annualRate = getAnnualBorrowRate(ratePerSecond);

    // Should be approximately 5% (50000000000000000 = 0.05 * 1e18)
    expect(annualRate).toBeGreaterThan(49000000000000000n);
    expect(annualRate).toBeLessThan(51000000000000000n);
  });

  it("should return 0 for zero rate", () => {
    const annualRate = getAnnualBorrowRate(0n);
    expect(annualRate).toBe(0n);
  });

  it("should handle custom compounding period", () => {
    const ratePerSecond = 158548959n;
    const annualRate1Hour = getAnnualBorrowRate(ratePerSecond, 3600);
    const annualRate6Hours = getAnnualBorrowRate(ratePerSecond, 6 * 3600);

    // Results should be similar but not identical due to compounding
    expect(annualRate1Hour).toBeGreaterThan(0n);
    expect(annualRate6Hours).toBeGreaterThan(0n);
  });
});

describe("getApy", () => {
  it("should calculate APY from per-second rate", () => {
    // ~5% APY rate per second
    const ratePerSecond = 1585489599n;
    const apy = getApy(ratePerSecond);

    // APY should be close to 5% (with compounding, slightly higher)
    expect(apy).toBeGreaterThan(49000000000000000n);
    expect(apy).toBeLessThan(52000000000000000n);
  });

  it("should return 0 for zero rate", () => {
    expect(getApy(0n)).toBe(0n);
  });
});

describe("getRawBorrowRate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return borrow rate based on utilization", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const rate = getRawBorrowRate(
      500000000000000000n, // 50% utilization
      796668712n, // rateAtTarget
      now - 3600, // 1 hour ago
    );

    expect(rate).toBeGreaterThan(0n);
  });

  it("should return higher rate at higher utilization", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const rateLow = getRawBorrowRate(
      200000000000000000n, // 20% utilization
      796668712n,
      now,
    );

    const rateHigh = getRawBorrowRate(
      900000000000000000n, // 90% utilization
      796668712n,
      now,
    );

    expect(rateHigh).toBeGreaterThan(rateLow);
  });
});

describe("getBorrowRateInfo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return borrow rate and updated rateAtTarget", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const result = getBorrowRateInfo({
      utilization: 500000000000000000n,
      rateAtTarget: 796668712n,
      lastUpdate: now - 3600,
    });

    expect(result.latestBorrowRate).toBeGreaterThan(0n);
    expect(result.rateAtTarget).toBeGreaterThan(0n);
  });

  it("should apply rate cap", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const rateCap = 100000000n; // Low cap
    const result = getBorrowRateInfo({
      utilization: 900000000000000000n, // High utilization
      rateAtTarget: 796668712n,
      lastUpdate: now,
      rateCap,
    });

    // Annual rate from capped rate should be limited
    const uncappedResult = getBorrowRateInfo({
      utilization: 900000000000000000n,
      rateAtTarget: 796668712n,
      lastUpdate: now,
    });

    expect(result.latestBorrowRate).toBeLessThanOrEqual(
      uncappedResult.latestBorrowRate,
    );
  });

  it("should apply rate floor", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const rateFloor = 500000000n; // High floor
    const result = getBorrowRateInfo({
      utilization: 100000000000000000n, // Low utilization
      rateAtTarget: 796668712n,
      lastUpdate: now,
      rateFloor,
    });

    // Should be at least the floor rate
    const unfloored = getBorrowRateInfo({
      utilization: 100000000000000000n,
      rateAtTarget: 796668712n,
      lastUpdate: now,
    });

    expect(result.latestBorrowRate).toBeGreaterThanOrEqual(
      unfloored.latestBorrowRate,
    );
  });
});

describe("computeBorrowRate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should compute borrow rate for variable rate market", () => {
    const now = 1704067200n;
    vi.setSystemTime(Number(now) * 1000);

    const rate = computeBorrowRate({
      utilRate: 500000000000000000n,
      rateAtTarget: 796668712n,
      lastUpdate: now,
    });

    expect(rate).toBeGreaterThan(0n);
  });

  it("should return fixed rate for fixed rate market", () => {
    const now = 1704067200n;
    vi.setSystemTime(Number(now) * 1000);

    const fixedRateView = 158548959n; // ~5% per second
    const rate = computeBorrowRate({
      utilRate: 500000000000000000n,
      rateAtTarget: 796668712n,
      lastUpdate: now,
      isFixedRate: true,
      fixedRateView,
    });

    const expectedAnnualRate = getAnnualBorrowRate(fixedRateView);
    expect(rate).toBe(expectedAnnualRate);
  });

  it("should apply rate cap", () => {
    const now = 1704067200n;
    vi.setSystemTime(Number(now) * 1000);

    const rateCap = 50000000n;
    const rateWithCap = computeBorrowRate({
      utilRate: 900000000000000000n,
      rateAtTarget: 796668712n,
      lastUpdate: now,
      rateCap,
    });

    const rateWithoutCap = computeBorrowRate({
      utilRate: 900000000000000000n,
      rateAtTarget: 796668712n,
      lastUpdate: now,
    });

    expect(rateWithCap).toBeLessThanOrEqual(rateWithoutCap);
  });

  it("should apply rate floor", () => {
    const now = 1704067200n;
    vi.setSystemTime(Number(now) * 1000);

    const rateFloor = 500000000n;
    const rateWithFloor = computeBorrowRate({
      utilRate: 100000000000000000n,
      rateAtTarget: 796668712n,
      lastUpdate: now,
      rateFloor,
    });

    const rateWithoutFloor = computeBorrowRate({
      utilRate: 100000000000000000n,
      rateAtTarget: 796668712n,
      lastUpdate: now,
    });

    expect(rateWithFloor).toBeGreaterThanOrEqual(rateWithoutFloor);
  });
});

describe("getInterestRates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should generate rate curve with default points", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const rates = getInterestRates({
      rateAtTarget: 796668712n,
      lastUpdate: now,
      fee: 100000000000000000n, // 10% fee
    });

    expect(rates.length).toBe(101);
  });

  it("should generate rate curve with custom points", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const rates = getInterestRates({
      rateAtTarget: 796668712n,
      lastUpdate: now,
      fee: 0n,
      points: 11,
    });

    expect(rates.length).toBe(11);
  });

  it("should have proper structure", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const rates = getInterestRates({
      rateAtTarget: 796668712n,
      lastUpdate: now,
      fee: 0n,
      points: 11,
    });

    const firstPoint = rates[0];
    expect(firstPoint).toHaveProperty("borrowRate");
    expect(firstPoint).toHaveProperty("supplyRate");
    expect(firstPoint).toHaveProperty("utilization");
  });

  it("should have increasing utilization", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const rates = getInterestRates({
      rateAtTarget: 796668712n,
      lastUpdate: now,
      fee: 0n,
      points: 11,
    });

    expect(rates[0].utilization).toBeCloseTo(0, 5);
    expect(rates[rates.length - 1].utilization).toBeCloseTo(1, 5);
  });

  it("should have supply rate lower than borrow rate", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const rates = getInterestRates({
      rateAtTarget: 796668712n,
      lastUpdate: now,
      fee: 100000000000000000n, // 10% fee
      points: 11,
    });

    // At non-zero utilization, supply should be less than borrow
    const midPoint = rates[5];
    if (midPoint.utilization > 0) {
      expect(midPoint.supplyRate).toBeLessThanOrEqual(midPoint.borrowRate);
    }
  });

  it("should apply rate cap", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const ratesCapped = getInterestRates({
      rateAtTarget: 796668712n,
      lastUpdate: now,
      fee: 0n,
      rateCap: 50000000n,
      points: 11,
    });

    const ratesUncapped = getInterestRates({
      rateAtTarget: 796668712n,
      lastUpdate: now,
      fee: 0n,
      points: 11,
    });

    // High utilization rates should be capped
    const highUtil = ratesCapped[ratesCapped.length - 1];
    const highUtilUncapped = ratesUncapped[ratesUncapped.length - 1];
    expect(highUtil.borrowRate).toBeLessThanOrEqual(
      highUtilUncapped.borrowRate,
    );
  });

  it("should apply rate floor", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const rateFloor = 500000000n; // High floor to ensure it applies
    const ratesFloored = getInterestRates({
      rateAtTarget: 796668712n,
      lastUpdate: now,
      fee: 0n,
      rateFloor,
      points: 11,
    });

    const ratesUnfloored = getInterestRates({
      rateAtTarget: 796668712n,
      lastUpdate: now,
      fee: 0n,
      points: 11,
    });

    // Low utilization rates should be floored
    const lowUtil = ratesFloored[1]; // Index 1 for ~10% utilization
    const lowUtilUnfloored = ratesUnfloored[1];
    expect(lowUtil.borrowRate).toBeGreaterThanOrEqual(
      lowUtilUnfloored.borrowRate,
    );
  });
});

describe("getFixedRateInterestRates", () => {
  it("should generate curve with constant borrow rate", () => {
    const borrowRate = 158548959n;
    const rates = getFixedRateInterestRates({
      borrowRate,
      fee: 0n,
      points: 11,
    });

    expect(rates.length).toBe(11);

    // All borrow rates should be the same
    const firstBorrowRate = rates[0].borrowRate;
    rates.forEach((point) => {
      expect(point.borrowRate).toBeCloseTo(firstBorrowRate, 10);
    });
  });

  it("should have increasing supply rate with utilization", () => {
    const rates = getFixedRateInterestRates({
      borrowRate: 158548959n,
      fee: 0n,
      points: 11,
    });

    // Supply rate should increase with utilization
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i].supplyRate).toBeGreaterThanOrEqual(
        rates[i - 1].supplyRate,
      );
    }
  });

  it("should account for fee in supply rate", () => {
    const ratesNoFee = getFixedRateInterestRates({
      borrowRate: 158548959n,
      fee: 0n,
      points: 11,
    });

    const ratesWithFee = getFixedRateInterestRates({
      borrowRate: 158548959n,
      fee: 100000000000000000n, // 10% fee
      points: 11,
    });

    // At same utilization, supply with fee should be lower
    const midIndex = 5;
    expect(ratesWithFee[midIndex].supplyRate).toBeLessThan(
      ratesNoFee[midIndex].supplyRate,
    );
  });

  it("should have supply rate of 0 at 0% utilization", () => {
    const rates = getFixedRateInterestRates({
      borrowRate: 158548959n,
      fee: 0n,
      points: 11,
    });

    expect(rates[0].supplyRate).toBe(0);
  });
});
