import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeAprRate,
  getCurrentRoundedTimestamp,
  calculateDynamicLoanRepayment,
  calculateFixedLoanRepayment,
} from "../calculations/loan.js";

const RATE_SCALE_27 = 10n ** 27n;
const DECIMAL_SCALE = 10n ** 18n;

describe("normalizeAprRate", () => {
  it("should return 0 when apr is less than scale", () => {
    expect(normalizeAprRate(RATE_SCALE_27 / 2n)).toBe(0n);
  });

  it("should return 0 when apr equals scale", () => {
    expect(normalizeAprRate(RATE_SCALE_27)).toBe(0n);
  });

  it("should subtract scale when apr is greater", () => {
    // 5% APR = 1.05 * 10^27
    const apr5Percent = RATE_SCALE_27 + (RATE_SCALE_27 * 5n) / 100n;
    const normalized = normalizeAprRate(apr5Percent);
    expect(normalized).toBe((RATE_SCALE_27 * 5n) / 100n);
  });

  it("should handle 10% APR", () => {
    // 10% APR = 1.10 * 10^27
    const apr10Percent = RATE_SCALE_27 + (RATE_SCALE_27 * 10n) / 100n;
    const normalized = normalizeAprRate(apr10Percent);
    expect(normalized).toBe((RATE_SCALE_27 * 10n) / 100n);
  });
});

describe("getCurrentRoundedTimestamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should round down to 10-minute blocks and add buffer", () => {
    // Set time to 12:05:30
    const timestamp = 1704067530; // 2024-01-01 00:05:30
    vi.setSystemTime(timestamp * 1000);

    // Should round to 12:00:00 + 10 min buffer = 12:10:00
    const result = getCurrentRoundedTimestamp(10);
    const expectedRoundedDown = 1704067200n; // 00:00:00
    const expectedBuffer = 600n; // 10 minutes
    expect(result).toBe(expectedRoundedDown + expectedBuffer);
  });

  it("should use default 10 minute buffer", () => {
    const timestamp = 1704067200;
    vi.setSystemTime(timestamp * 1000);

    const result = getCurrentRoundedTimestamp();
    expect(result).toBe(1704067200n + 600n);
  });

  it("should handle custom buffer", () => {
    const timestamp = 1704067200;
    vi.setSystemTime(timestamp * 1000);

    const result = getCurrentRoundedTimestamp(20);
    expect(result).toBe(1704067200n + 1200n); // 20 min = 1200 sec
  });
});

describe("calculateDynamicLoanRepayment", () => {
  // Rate is now a cumulative borrow index in RAY format (27 decimals)
  // 1e27 = index of 1.0 (no interest), 1.05e27 = 5% interest accumulated
  const RATE_INDEX_5_PERCENT = RATE_SCALE_27 + (RATE_SCALE_27 * 5n) / 100n; // 1.05e27

  it("should calculate repayment for dynamic loan", () => {
    const result = calculateDynamicLoanRepayment({
      principal: 1000n * DECIMAL_SCALE,
      rate: RATE_INDEX_5_PERCENT, // 5% accumulated interest (borrow index = 1.05)
    });

    expect(result.principal.numerator).toBe(1000n * DECIMAL_SCALE);
    expect(result.totalRepay.valueOf()).toBeGreaterThan(1000);
    expect(result.interest.valueOf()).toBeGreaterThan(0);
  });

  it("should use normalizedDebt for debt calculation but return original principal", () => {
    const result = calculateDynamicLoanRepayment({
      principal: 1000n * DECIMAL_SCALE,
      normalizedDebt: 1100n * DECIMAL_SCALE, // Normalized debt used for debt calculation
      rate: RATE_INDEX_5_PERCENT,
    });

    // principal in result is always the original principal
    expect(result.principal.numerator).toBe(1000n * DECIMAL_SCALE);
    // totalRepay should be higher because normalizedDebt (1100) is used for calculation
    expect(result.totalRepay.valueOf()).toBeGreaterThan(1100);
  });

  it("should handle zero rate (index = 1.0)", () => {
    const result = calculateDynamicLoanRepayment({
      principal: 1000n * DECIMAL_SCALE,
      rate: RATE_SCALE_27, // Index = 1.0, no interest accumulated
    });

    // With index = 1.0, total should equal principal (no interest, no buffer)
    expect(result.totalRepay.valueOf()).toBeCloseTo(1000, 0);
  });

  it("should respect loan decimals", () => {
    const result6 = calculateDynamicLoanRepayment(
      {
        principal: 1000n * 10n ** 6n,
        rate: RATE_INDEX_5_PERCENT,
      },
      6,
    );

    const result18 = calculateDynamicLoanRepayment(
      {
        principal: 1000n * DECIMAL_SCALE,
        rate: RATE_INDEX_5_PERCENT,
      },
      18,
    );

    // Both should represent similar repay amounts relative to scale
    expect(result6.totalRepay.valueOf()).toBeGreaterThan(0);
    expect(result18.totalRepay.valueOf()).toBeGreaterThan(0);
  });
});

describe("calculateFixedLoanRepayment", () => {
  const basePosition = {
    posId: 1n,
    principal: 1000n * DECIMAL_SCALE,
    principalRepaid: 0n,
    interestRepaid: 0n,
    lastRepaidTime: 0n,
    apr: RATE_SCALE_27 + (RATE_SCALE_27 * 5n) / 100n, // 5% APR
    start: 1704067200n, // 2024-01-01
    end: 1735689600n, // 2025-01-01
  };

  it("should calculate interest for active loan", () => {
    // Simulate being halfway through the loan term
    const halfwayTime = (basePosition.start + basePosition.end) / 2n;

    const result = calculateFixedLoanRepayment(basePosition, halfwayTime);

    expect(result.principal).toBe(1000n * DECIMAL_SCALE);
    expect(result.interest).toBeGreaterThan(0n);
    expect(result.totalRepay.valueOf()).toBeGreaterThan(1000);
  });

  it("should include penalty for early repayment", () => {
    // Very early in the loan term
    const earlyTime = basePosition.start + 3600n; // 1 hour after start

    const result = calculateFixedLoanRepayment(basePosition, earlyTime);

    expect(result.penalty).toBeGreaterThan(0n);
  });

  it("should have no penalty at maturity", () => {
    // At or after maturity
    const result = calculateFixedLoanRepayment(basePosition, basePosition.end);

    expect(result.penalty).toBe(0n);
  });

  it("should account for partial repayment", () => {
    const partiallyRepaid = {
      ...basePosition,
      principalRepaid: 500n * DECIMAL_SCALE, // Half repaid
    };

    const halfwayTime = (basePosition.start + basePosition.end) / 2n;
    const result = calculateFixedLoanRepayment(partiallyRepaid, halfwayTime);

    expect(result.principal).toBe(500n * DECIMAL_SCALE);
  });

  it("should handle fully repaid loan", () => {
    const fullyRepaid = {
      ...basePosition,
      principalRepaid: 1000n * DECIMAL_SCALE,
    };

    const result = calculateFixedLoanRepayment(
      fullyRepaid,
      basePosition.start + 86400n,
    );

    expect(result.principal).toBe(0n);
    expect(result.interest).toBe(0n);
  });

  it("should use current rounded timestamp if not provided", () => {
    vi.useFakeTimers();
    vi.setSystemTime(
      Number((basePosition.start + basePosition.end) / 2n) * 1000,
    );

    const result = calculateFixedLoanRepayment(basePosition);

    expect(result.totalRepay.valueOf()).toBeGreaterThan(1000);

    vi.useRealTimers();
  });
});
