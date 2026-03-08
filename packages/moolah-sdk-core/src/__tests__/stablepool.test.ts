import { describe, it, expect } from "vitest";
import {
  getD,
  getLPOutput,
  getDAfterWithdraw,
  getYD,
  getMaxX,
  getMaxY,
} from "../calculations/stablepool.js";

const WEI = 10n ** 18n;

describe("stablepool calculations", () => {
  describe("getD", () => {
    it("should throw if less than 2 coins", () => {
      expect(() => getD({ amplifier: 100n, balances: [1000n * WEI] })).toThrow(
        "To get constant D, pool should have at least two coins.",
      );
    });

    it("should return 0 if sum of balances is 0", () => {
      const d = getD({ amplifier: 100n, balances: [0n, 0n] });
      expect(d).toBe(0n);
    });

    it("should calculate D for balanced pool", () => {
      const balances = [1000n * WEI, 1000n * WEI];
      const d = getD({ amplifier: 100n, balances });
      // D should be approximately 2000 * WEI for balanced pool
      expect(d).toBeGreaterThan(1999n * WEI);
      expect(d).toBeLessThan(2001n * WEI);
    });

    it("should calculate D for imbalanced pool", () => {
      const balances = [1000n * WEI, 2000n * WEI];
      const d = getD({ amplifier: 100n, balances });
      // D should be between sum (3000) and geometric mean * 2 (~2828)
      expect(d).toBeGreaterThan(2800n * WEI);
      expect(d).toBeLessThan(3001n * WEI);
    });

    it("should calculate D for 3-coin pool", () => {
      const balances = [1000n * WEI, 1000n * WEI, 1000n * WEI];
      const d = getD({ amplifier: 100n, balances });
      // D should be approximately 3000 * WEI for balanced pool
      expect(d).toBeGreaterThan(2999n * WEI);
      expect(d).toBeLessThan(3001n * WEI);
    });

    it("should handle different amplifiers", () => {
      const balances = [1000n * WEI, 1000n * WEI];
      const dLowAmp = getD({ amplifier: 10n, balances });
      const dHighAmp = getD({ amplifier: 1000n, balances });
      // Higher amplifier should give D closer to sum
      expect(dHighAmp).toBeGreaterThanOrEqual(dLowAmp);
    });
  });

  describe("getLPOutput", () => {
    it("should return D for first supply (empty pool)", () => {
      const lp = getLPOutput({
        amplifier: 100n,
        balances: [0n, 0n],
        amounts: [1000n * WEI, 1000n * WEI],
        totalSupply: 0n,
        fee: 4000000n, // 0.04%
      });
      // First supply should return D of the new balances
      const expectedD = getD({
        amplifier: 100n,
        balances: [1000n * WEI, 1000n * WEI],
      });
      expect(lp).toBe(expectedD);
    });

    it("should throw if amounts length mismatch", () => {
      expect(() =>
        getLPOutput({
          amplifier: 100n,
          balances: [1000n * WEI, 1000n * WEI],
          amounts: [100n * WEI],
          totalSupply: 2000n * WEI,
          fee: 4000000n,
        }),
      ).toThrow("amounts length must be equal to balances length");
    });

    it("should calculate LP output for balanced add", () => {
      const lp = getLPOutput({
        amplifier: 100n,
        balances: [1000n * WEI, 1000n * WEI],
        amounts: [100n * WEI, 100n * WEI],
        totalSupply: 2000n * WEI,
        fee: 4000000n,
      });
      // Adding 10% to balanced pool should mint ~10% LP (minus fees)
      expect(lp).toBeGreaterThan(190n * WEI);
      expect(lp).toBeLessThan(201n * WEI);
    });

    it("should calculate LP output for imbalanced add", () => {
      const lp = getLPOutput({
        amplifier: 100n,
        balances: [1000n * WEI, 1000n * WEI],
        amounts: [200n * WEI, 0n],
        totalSupply: 2000n * WEI,
        fee: 4000000n,
      });
      // Imbalanced add should get less LP due to fees
      expect(lp).toBeGreaterThan(90n * WEI);
      expect(lp).toBeLessThan(200n * WEI);
    });

    it("should return d1 for first supply with totalSupply = 0", () => {
      const lp = getLPOutput({
        amplifier: 100n,
        balances: [1000n * WEI, 1000n * WEI],
        amounts: [100n * WEI, 100n * WEI],
        totalSupply: 0n,
        fee: 4000000n,
      });
      // When totalSupply is 0 but balances exist, should return d1
      const d1 = getD({
        amplifier: 100n,
        balances: [1100n * WEI, 1100n * WEI],
      });
      expect(lp).toBe(d1);
    });
  });

  describe("getDAfterWithdraw", () => {
    it("should calculate D after partial withdraw", () => {
      const d = 2000n * WEI;
      const result = getDAfterWithdraw({
        d,
        withdrawLp: 200n * WEI,
        totalSupply: 2000n * WEI,
      });
      // Withdrawing 10% should reduce D by 10%
      expect(result).toBe(1800n * WEI);
    });

    it("should return 0 when withdrawing all", () => {
      const result = getDAfterWithdraw({
        d: 2000n * WEI,
        withdrawLp: 2000n * WEI,
        totalSupply: 2000n * WEI,
      });
      expect(result).toBe(0n);
    });

    it("should handle small withdrawals", () => {
      const result = getDAfterWithdraw({
        d: 2000n * WEI,
        withdrawLp: 1n,
        totalSupply: 2000n * WEI,
      });
      expect(result).toBeLessThan(2000n * WEI);
      expect(result).toBeGreaterThan(1999n * WEI);
    });
  });

  describe("getYD", () => {
    it("should throw if idx is out of bounds (negative)", () => {
      expect(() =>
        getYD({
          amplifier: 100n,
          balances: [1000n * WEI, 1000n * WEI],
          idx: -1,
        }),
      ).toThrow("idx is out of bounds");
    });

    it("should throw if idx is out of bounds (too large)", () => {
      expect(() =>
        getYD({
          amplifier: 100n,
          balances: [1000n * WEI, 1000n * WEI],
          idx: 2,
        }),
      ).toThrow("idx is out of bounds");
    });

    it("should calculate Y for balanced pool", () => {
      const balances = [1000n * WEI, 1000n * WEI];
      const d = getD({ amplifier: 100n, balances });
      const y = getYD({
        d,
        amplifier: 100n,
        balances,
        idx: 0,
      });
      // For balanced pool, Y should be close to original balance
      expect(y).toBeGreaterThan(999n * WEI);
      expect(y).toBeLessThan(1001n * WEI);
    });

    it("should calculate Y with reduced D", () => {
      const balances = [1000n * WEI, 1000n * WEI];
      const d = getD({ amplifier: 100n, balances });
      const reducedD = (d * 9n) / 10n; // 90% of D
      const y = getYD({
        d: reducedD,
        amplifier: 100n,
        balances,
        idx: 0,
      });
      // Y should be less than original when D is reduced
      expect(y).toBeLessThan(1000n * WEI);
    });

    it("should auto-calculate D if not provided", () => {
      const balances = [1000n * WEI, 1000n * WEI];
      const y = getYD({
        amplifier: 100n,
        balances,
        idx: 0,
      });
      // Should work without explicit D
      expect(y).toBeGreaterThan(0n);
    });
  });

  describe("getMaxX", () => {
    it("should throw if idx is out of bounds", () => {
      expect(() =>
        getMaxX(
          {
            amplifier: 100n,
            balances: [1000n * WEI, 1000n * WEI],
            withdrawLp: 100n * WEI,
            totalSupply: 2000n * WEI,
            fee: 4000000n,
          },
          -1,
        ),
      ).toThrow("idx is out of bounds");

      expect(() =>
        getMaxX(
          {
            amplifier: 100n,
            balances: [1000n * WEI, 1000n * WEI],
            withdrawLp: 100n * WEI,
            totalSupply: 2000n * WEI,
            fee: 4000000n,
          },
          2,
        ),
      ).toThrow("idx is out of bounds");
    });

    it("should calculate max single token withdraw", () => {
      const [dx, fee] = getMaxX(
        {
          amplifier: 100n,
          balances: [1000n * WEI, 1000n * WEI],
          withdrawLp: 200n * WEI,
          totalSupply: 2000n * WEI,
          fee: 4000000n,
        },
        0,
      );
      // Withdrawing 10% LP as single token should get ~10% of that token (minus fees)
      expect(dx).toBeGreaterThan(90n * WEI);
      expect(dx).toBeLessThan(200n * WEI);
      // Fee should be positive
      expect(fee).toBeGreaterThanOrEqual(0n);
    });

    it("should return [dx, fee] tuple", () => {
      const result = getMaxX(
        {
          amplifier: 100n,
          balances: [1000n * WEI, 1000n * WEI],
          withdrawLp: 100n * WEI,
          totalSupply: 2000n * WEI,
          fee: 4000000n,
        },
        0,
      );
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it("should use provided D if available", () => {
      const balances = [1000n * WEI, 1000n * WEI];
      const d = getD({ amplifier: 100n, balances });
      const [dx1] = getMaxX(
        {
          d,
          amplifier: 100n,
          balances,
          withdrawLp: 100n * WEI,
          totalSupply: 2000n * WEI,
          fee: 4000000n,
        },
        0,
      );
      const [dx2] = getMaxX(
        {
          amplifier: 100n,
          balances,
          withdrawLp: 100n * WEI,
          totalSupply: 2000n * WEI,
          fee: 4000000n,
        },
        0,
      );
      // Should be the same result
      expect(dx1).toBe(dx2);
    });
  });

  describe("getMaxY", () => {
    it("should return [0, 0] if index out of bounds", () => {
      const result = getMaxY(
        {
          amplifier: 100n,
          balances: [1000n * WEI, 1000n * WEI],
          withdrawLp: 100n * WEI,
          totalLp: 2000n * WEI,
          newBalances: [900n * WEI, 1000n * WEI],
        },
        -1,
      );
      expect(result).toEqual([0n, 0n]);
    });

    it("should return [0, 0] if newBalances length mismatch", () => {
      const result = getMaxY(
        {
          amplifier: 100n,
          balances: [1000n * WEI, 1000n * WEI],
          withdrawLp: 100n * WEI,
          totalLp: 2000n * WEI,
          newBalances: [900n * WEI],
        },
        0,
      );
      expect(result).toEqual([0n, 0n]);
    });

    it("should calculate max Y withdraw", () => {
      // Use newBalances that result in a valid positive initial y
      // y = (sum0 * (totalLp - withdrawLp)) / totalLp - sum1
      // sum0 = 2000, withdrawLp = 100, totalLp = 2000
      // y = 2000 * 1900 / 2000 - sum1 = 1900 - sum1
      // For y > 0, need sum1 < 1900
      const [y, diff] = getMaxY(
        {
          amplifier: 100n,
          balances: [1000n * WEI, 1000n * WEI],
          withdrawLp: 100n * WEI,
          totalLp: 2000n * WEI,
          newBalances: [900n * WEI, 900n * WEI], // sum1 = 1800 < 1900
        },
        0,
      );
      // Y should be a reasonable value
      expect(y).toBeGreaterThan(0n);
      // diff should be balance[index] - y
      expect(diff).toBe(1000n * WEI - y);
    });

    it("should return [y, diff] tuple", () => {
      const result = getMaxY(
        {
          amplifier: 100n,
          balances: [1000n * WEI, 1000n * WEI],
          withdrawLp: 100n * WEI,
          totalLp: 2000n * WEI,
          newBalances: [900n * WEI, 900n * WEI], // sum1 = 1800 < 1900
        },
        0,
      );
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it("should use provided D if available", () => {
      const balances = [1000n * WEI, 1000n * WEI];
      const d = getD({ amplifier: 100n, balances });
      const [y1] = getMaxY(
        {
          d,
          amplifier: 100n,
          balances,
          withdrawLp: 100n * WEI,
          totalLp: 2000n * WEI,
          newBalances: [900n * WEI, 900n * WEI],
        },
        0,
      );
      const [y2] = getMaxY(
        {
          amplifier: 100n,
          balances,
          withdrawLp: 100n * WEI,
          totalLp: 2000n * WEI,
          newBalances: [900n * WEI, 900n * WEI],
        },
        0,
      );
      expect(y1).toBe(y2);
    });

    it("should converge with high amplifier", () => {
      // High amplifier changes the curve shape
      const [y, diff] = getMaxY(
        {
          amplifier: 10000n,
          balances: [1000n * WEI, 1000n * WEI],
          withdrawLp: 100n * WEI,
          totalLp: 2000n * WEI,
          newBalances: [900n * WEI, 900n * WEI],
        },
        0,
      );
      expect(y).toBeGreaterThan(0n);
      expect(diff).toBe(1000n * WEI - y);
    });

    it("should handle imbalanced pool withdrawal", () => {
      // Imbalanced pool may have different convergence
      const [y, diff] = getMaxY(
        {
          amplifier: 100n,
          balances: [2000n * WEI, 1000n * WEI],
          withdrawLp: 100n * WEI,
          totalLp: 3000n * WEI,
          newBalances: [1900n * WEI, 900n * WEI],
        },
        0,
      );
      expect(y).toBeGreaterThan(0n);
      expect(diff).toBe(2000n * WEI - y);
    });
  });
});
