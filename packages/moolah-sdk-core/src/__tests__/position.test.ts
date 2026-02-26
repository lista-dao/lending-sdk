import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeLTV,
  computeLoanable,
  computeWithdrawable,
  getExtraRepayAmount,
  computeLiquidationPrice,
  simulateBorrow,
  simulateRepay,
} from "../calculations/position";

const DECIMAL_SCALE = 10n ** 18n;

describe("computeLTV", () => {
  it("should return 0 when collateral is 0", () => {
    const ltv = computeLTV({
      collateral: 0n,
      borrowed: 1000n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
    });
    expect(ltv).toBe(0n);
  });

  it("should return 0 when borrowed is 0", () => {
    const ltv = computeLTV({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 0n,
      priceRate: 2000n * DECIMAL_SCALE,
    });
    expect(ltv).toBe(0n);
  });

  it("should calculate LTV correctly", () => {
    // 1 ETH collateral at $2000, borrowed $1000 = 50% LTV
    const ltv = computeLTV({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
    });
    // 50% = 0.5e18
    expect(ltv).toBe(500000000000000000n);
  });

  it("should account for supplyAmount", () => {
    // 1 ETH + 1 ETH supply = 2 ETH collateral
    // borrowed $1000 at $2000/ETH = 25% LTV
    const ltv = computeLTV({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      supplyAmount: 1n * DECIMAL_SCALE,
    });
    expect(ltv).toBe(250000000000000000n);
  });

  it("should account for borrowAmount", () => {
    // 1 ETH collateral at $2000, borrowed $1000 + $500 = 75% LTV
    const ltv = computeLTV({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      borrowAmount: 500n * DECIMAL_SCALE,
    });
    expect(ltv).toBe(750000000000000000n);
  });

  it("should account for repayAmount", () => {
    // 1 ETH collateral at $2000, borrowed $1000 - $500 repay = 25% LTV
    const ltv = computeLTV({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      repayAmount: 500n * DECIMAL_SCALE,
    });
    expect(ltv).toBe(250000000000000000n);
  });

  it("should account for withdrawAmount", () => {
    // 2 ETH - 1 ETH withdraw = 1 ETH collateral
    // borrowed $1000 at $2000/ETH = 50% LTV
    const ltv = computeLTV({
      collateral: 2n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      withdrawAmount: 1n * DECIMAL_SCALE,
    });
    expect(ltv).toBe(500000000000000000n);
  });

  it("should handle combined operations", () => {
    // Start: 1 ETH, $500 borrowed
    // +0.5 ETH supply, +$250 borrow, -$100 repay
    // Final: 1.5 ETH, $650 borrowed
    // At $2000/ETH: LTV = 650 / (1.5 * 2000) = 21.67%
    const ltv = computeLTV({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 500n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      supplyAmount: 500000000000000000n, // 0.5 ETH
      borrowAmount: 250n * DECIMAL_SCALE,
      repayAmount: 100n * DECIMAL_SCALE,
    });
    // 650 / 3000 = 0.2166... ≈ 216666666666666666
    expect(ltv).toBeGreaterThan(216000000000000000n);
    expect(ltv).toBeLessThan(217000000000000000n);
  });
});

describe("computeLoanable", () => {
  const lltv = 800000000000000000n; // 80% LLTV

  it("should return 0 when no collateral", () => {
    const loanable = computeLoanable({
      collateral: 0n,
      borrowed: 0n,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
    });
    expect(loanable).toBe(0n);
  });

  it("should calculate max loanable with no existing borrow", () => {
    // 1 ETH at $2000, 80% LLTV with 98% safety = 78.4% effective
    // Max borrow = 1 * 2000 * 0.784 = 1568 USDC
    const loanable = computeLoanable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 0n,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
    });
    expect(loanable).toBe(1568n * DECIMAL_SCALE);
  });

  it("should subtract existing borrowed amount", () => {
    // Max borrow = 1568, already borrowed 500 = 1068 remaining
    const loanable = computeLoanable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 500n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
    });
    expect(loanable).toBe(1068n * DECIMAL_SCALE);
  });

  it("should return 0 when already over limit", () => {
    const loanable = computeLoanable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 2000n * DECIMAL_SCALE, // Over the limit
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
    });
    expect(loanable).toBe(0n);
  });

  it("should account for supplyAmount", () => {
    // 1 ETH + 1 ETH = 2 ETH
    // Max = 2 * 2000 * 0.784 = 3136
    const loanable = computeLoanable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 0n,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
      supplyAmount: 1n * DECIMAL_SCALE,
    });
    expect(loanable).toBe(3136n * DECIMAL_SCALE);
  });

  it("should use custom targetLTVPercent", () => {
    // 1 ETH at $2000, target 50% LTV
    // Max = 1 * 2000 * 0.5 = 1000
    const loanable = computeLoanable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 0n,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
      targetLTVPercent: 50,
    });
    expect(loanable).toBe(1000n * DECIMAL_SCALE);
  });

  it("should round down to loan decimals", () => {
    // Test with 6 decimal token (like USDC)
    const loanable = computeLoanable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 0n,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
      loanDecimals: 6,
    });
    // Should be rounded to 6 decimals
    const scale = 10n ** 6n;
    expect(loanable % scale).toBe(0n);
  });
});

describe("computeWithdrawable", () => {
  const lltv = 800000000000000000n; // 80% LLTV

  it("should return full collateral when no borrow", () => {
    const withdrawable = computeWithdrawable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 0n,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
    });
    expect(withdrawable).toBe(1n * DECIMAL_SCALE);
  });

  it("should return 0 when at max utilization", () => {
    // If borrowed is at max, can't withdraw anything
    // 1 ETH at $2000, 80% LLTV = max borrow 1600
    const withdrawable = computeWithdrawable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1600n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
    });
    expect(withdrawable).toBe(0n);
  });

  it("should calculate withdrawable with partial borrow", () => {
    // 2 ETH at $2000, borrowed $1000
    // Min collateral needed = 1000 / (2000 * 0.784) = 0.6377... ETH
    // Withdrawable = 2 - 0.6377 ≈ 1.36 ETH
    const withdrawable = computeWithdrawable({
      collateral: 2n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
    });
    expect(withdrawable).toBeGreaterThan(1360000000000000000n);
    expect(withdrawable).toBeLessThan(1370000000000000000n);
  });

  it("should account for repayAmount", () => {
    // 1 ETH at $2000, borrowed $1600 (at max)
    // Repay $800, new borrowed = $800
    // Min collateral = 800 / (2000 * 0.784) = 0.51 ETH
    // Withdrawable ≈ 0.49 ETH
    const withdrawable = computeWithdrawable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1600n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
      repayAmount: 800n * DECIMAL_SCALE,
    });
    expect(withdrawable).toBeGreaterThan(480000000000000000n);
    expect(withdrawable).toBeLessThan(500000000000000000n);
  });

  it("should return full collateral when repaying all", () => {
    const withdrawable = computeWithdrawable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
      repayAmount: 1000n * DECIMAL_SCALE,
    });
    expect(withdrawable).toBe(1n * DECIMAL_SCALE);
  });

  it("should round down to collateral decimals", () => {
    const withdrawable = computeWithdrawable({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 500n * DECIMAL_SCALE,
      priceRate: 2000n * DECIMAL_SCALE,
      lltv,
      collateralDecimals: 8,
    });
    // Should be rounded to 8 decimals
    const scale = 10n ** 8n;
    expect(withdrawable % scale).toBe(0n);
  });
});

describe("getExtraRepayAmount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return borrowed amount when no interest", () => {
    const now = 1704067200; // 2024-01-01
    vi.setSystemTime(now * 1000);

    const result = getExtraRepayAmount({
      borrowed: 1000n * DECIMAL_SCALE,
      rateView: 0n,
      lastUpdate: BigInt(now),
      bufferMinutes: 0,
    });
    expect(result).toBe(1000n * DECIMAL_SCALE);
  });

  it("should add buffer time interest", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const result = getExtraRepayAmount({
      borrowed: 1000n * DECIMAL_SCALE,
      rateView: 158548959n, // ~5% APY rate per second
      lastUpdate: BigInt(now),
      bufferMinutes: 20,
    });
    // Should be slightly more than borrowed amount
    expect(result).toBeGreaterThan(1000n * DECIMAL_SCALE);
  });

  it("should account for elapsed time since lastUpdate", () => {
    const now = 1704067200;
    const oneHourAgo = now - 3600;
    vi.setSystemTime(now * 1000);

    const result = getExtraRepayAmount({
      borrowed: 1000n * DECIMAL_SCALE,
      rateView: 158548959n,
      lastUpdate: BigInt(oneHourAgo),
      bufferMinutes: 20,
    });
    // Should be more than with just buffer time
    const resultWithNoElapsed = getExtraRepayAmount({
      borrowed: 1000n * DECIMAL_SCALE,
      rateView: 158548959n,
      lastUpdate: BigInt(now),
      bufferMinutes: 20,
    });
    expect(result).toBeGreaterThan(resultWithNoElapsed);
  });

  it("should use default 20 minute buffer", () => {
    const now = 1704067200;
    vi.setSystemTime(now * 1000);

    const resultDefault = getExtraRepayAmount({
      borrowed: 1000n * DECIMAL_SCALE,
      rateView: 158548959n,
      lastUpdate: BigInt(now),
    });

    const result20Min = getExtraRepayAmount({
      borrowed: 1000n * DECIMAL_SCALE,
      rateView: 158548959n,
      lastUpdate: BigInt(now),
      bufferMinutes: 20,
    });

    expect(resultDefault).toBe(result20Min);
  });
});

describe("computeLiquidationPrice", () => {
  const lltv = 800000000000000000n; // 80% LLTV

  it("should return 0 when no collateral", () => {
    const liqPrice = computeLiquidationPrice({
      collateral: 0n,
      borrowed: 1000n * DECIMAL_SCALE,
      lltv,
    });
    expect(liqPrice).toBe(0n);
  });

  it("should return 0 when no borrowed", () => {
    const liqPrice = computeLiquidationPrice({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 0n,
      lltv,
    });
    expect(liqPrice).toBe(0n);
  });

  it("should calculate liquidation price correctly", () => {
    // 1 ETH collateral, borrowed $1000, 80% LLTV
    // Liquidation when: borrowed >= collateral * price * LLTV
    // 1000 >= 1 * price * 0.8
    // price <= 1250
    const liqPrice = computeLiquidationPrice({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      lltv,
    });
    expect(liqPrice).toBe(1250n * DECIMAL_SCALE);
  });

  it("should increase with more borrowed", () => {
    const liqPrice1000 = computeLiquidationPrice({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      lltv,
    });

    const liqPrice1500 = computeLiquidationPrice({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1500n * DECIMAL_SCALE,
      lltv,
    });

    expect(liqPrice1500).toBeGreaterThan(liqPrice1000);
  });

  it("should decrease with more collateral", () => {
    const liqPrice1Eth = computeLiquidationPrice({
      collateral: 1n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      lltv,
    });

    const liqPrice2Eth = computeLiquidationPrice({
      collateral: 2n * DECIMAL_SCALE,
      borrowed: 1000n * DECIMAL_SCALE,
      lltv,
    });

    expect(liqPrice2Eth).toBeLessThan(liqPrice1Eth);
  });
});

describe("simulateBorrow", () => {
  const baseParams = {
    collateral: 1n * DECIMAL_SCALE,
    borrowed: 0n,
    priceRate: 2000n * DECIMAL_SCALE,
    lltv: 800000000000000000n,
  };

  it("should simulate borrowing correctly", () => {
    const result = simulateBorrow({
      ...baseParams,
      borrowAmount: 500n * DECIMAL_SCALE,
    });

    expect(result.newBorrowed).toBe(500n * DECIMAL_SCALE);
    expect(result.newCollateral).toBe(1n * DECIMAL_SCALE);
    expect(result.newLTV).toBe(250000000000000000n); // 25%
    expect(result.newLiqPrice).toBeGreaterThan(0n);
    expect(result.newLoanable).toBeGreaterThan(0n);
    expect(result.newWithdrawable).toBeGreaterThan(0n);
  });

  it("should simulate supply + borrow", () => {
    const result = simulateBorrow({
      ...baseParams,
      supplyAmount: 1n * DECIMAL_SCALE, // Add 1 ETH
      borrowAmount: 1000n * DECIMAL_SCALE,
    });

    expect(result.newCollateral).toBe(2n * DECIMAL_SCALE);
    expect(result.newBorrowed).toBe(1000n * DECIMAL_SCALE);
    // 2 ETH at $2000 = $4000 collateral value
    // $1000 borrowed = 25% LTV
    expect(result.newLTV).toBe(250000000000000000n);
  });

  it("should return all simulation values", () => {
    const result = simulateBorrow({
      ...baseParams,
      borrowAmount: 500n * DECIMAL_SCALE,
    });

    expect(result).toHaveProperty("newLTV");
    expect(result).toHaveProperty("newBorrowed");
    expect(result).toHaveProperty("newCollateral");
    expect(result).toHaveProperty("newLiqPrice");
    expect(result).toHaveProperty("newLoanable");
    expect(result).toHaveProperty("newWithdrawable");
  });
});

describe("simulateRepay", () => {
  const baseParams = {
    collateral: 1n * DECIMAL_SCALE,
    borrowed: 1000n * DECIMAL_SCALE,
    priceRate: 2000n * DECIMAL_SCALE,
    lltv: 800000000000000000n,
  };

  it("should simulate repaying correctly", () => {
    const result = simulateRepay({
      ...baseParams,
      repayAmount: 500n * DECIMAL_SCALE,
    });

    expect(result.newBorrowed).toBe(500n * DECIMAL_SCALE);
    expect(result.newCollateral).toBe(1n * DECIMAL_SCALE);
    expect(result.newLTV).toBe(250000000000000000n); // 25%
  });

  it("should simulate full repay", () => {
    const result = simulateRepay({
      ...baseParams,
      repayAmount: 1000n * DECIMAL_SCALE,
    });

    expect(result.newBorrowed).toBe(0n);
    expect(result.newLTV).toBe(0n);
    expect(result.newWithdrawable).toBe(1n * DECIMAL_SCALE);
  });

  it("should simulate repay + withdraw", () => {
    const result = simulateRepay({
      ...baseParams,
      repayAmount: 1000n * DECIMAL_SCALE,
      withdrawAmount: 500000000000000000n, // 0.5 ETH
    });

    expect(result.newBorrowed).toBe(0n);
    expect(result.newCollateral).toBe(500000000000000000n);
  });

  it("should not allow over-repay (clamp to 0)", () => {
    const result = simulateRepay({
      ...baseParams,
      repayAmount: 2000n * DECIMAL_SCALE, // More than borrowed
    });

    expect(result.newBorrowed).toBe(0n);
  });

  it("should not allow over-withdraw (clamp to 0)", () => {
    const result = simulateRepay({
      ...baseParams,
      withdrawAmount: 2n * DECIMAL_SCALE, // More than collateral
    });

    expect(result.newCollateral).toBe(0n);
  });
});
