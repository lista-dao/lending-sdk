import { describe, it, expect } from "vitest";
import { Decimal } from "../utils/decimal.js";
import { simulateVaultDeposit, simulateVaultWithdraw } from "../simulate/vault.js";
import {
  simulateMarketBorrow,
  simulateMarketRepay,
  simulateComputeLTV,
  simulateComputeLoanable,
  simulateComputeWithdrawable,
  simulateComputeLiqPriceRate,
  MARKET_THRESHOLD,
} from "../simulate/market.js";
import {
  simulateSmartMarketBorrow,
  simulateSmartMarketRepay,
  computeSmartLTV,
  computeSmartLoanable,
  computeSmartWithdrawable,
  breakdownLp,
  SMART_THRESHOLD,
} from "../simulate/smart.js";

describe("Vault Simulation", () => {
  describe("simulateVaultDeposit", () => {
    it("should calculate new locked amount after deposit", () => {
      const result = simulateVaultDeposit({
        depositAmount: Decimal.parse("100", 18),
        userLocked: Decimal.parse("500", 18),
        userBalance: Decimal.parse("1000", 18),
      });

      expect(result.locked.toString(18)).toBe("600");
      expect(result.balance.toString(18)).toBe("900");
    });

    it("should calculate earnings when APY and price provided", () => {
      const result = simulateVaultDeposit({
        depositAmount: Decimal.parse("100", 18),
        userLocked: Decimal.parse("500", 18),
        userBalance: Decimal.parse("1000", 18),
        apy: Decimal.parse("0.1", 18), // 10% APY
        assetPrice: Decimal.parse("1", 18), // $1 per token
      });

      expect(result.yearlyEarnings).toBeDefined();
      expect(result.monthlyEarnings).toBeDefined();
      // 600 * 0.1 * 1 = 60 yearly earnings
      expect(result.yearlyEarnings!.toString(18)).toBe("60");
    });

    it("should handle zero deposit", () => {
      const result = simulateVaultDeposit({
        depositAmount: Decimal.ZERO,
        userLocked: Decimal.parse("500", 18),
        userBalance: Decimal.parse("1000", 18),
      });

      expect(result.locked.toString(18)).toBe("500");
      expect(result.balance.toString(18)).toBe("1000");
    });
  });

  describe("simulateVaultWithdraw", () => {
    it("should calculate new locked amount after withdraw", () => {
      const result = simulateVaultWithdraw({
        withdrawAmount: Decimal.parse("100", 18),
        userLocked: Decimal.parse("500", 18),
        userBalance: Decimal.parse("1000", 18),
      });

      expect(result.locked.toString(18)).toBe("400");
      expect(result.balance.toString(18)).toBe("1100");
    });

    it("should calculate earnings when APY and price provided", () => {
      const result = simulateVaultWithdraw({
        withdrawAmount: Decimal.parse("100", 18),
        userLocked: Decimal.parse("500", 18),
        userBalance: Decimal.parse("1000", 18),
        apy: Decimal.parse("0.1", 18),
        assetPrice: Decimal.parse("1", 18),
      });

      expect(result.yearlyEarnings).toBeDefined();
      // 400 * 0.1 * 1 = 40 yearly earnings
      expect(result.yearlyEarnings!.toString(18)).toBe("40");
    });
  });
});

describe("Market Simulation", () => {
  const marketState = {
    totalSupply: Decimal.parse("10000", 18),
    totalBorrow: Decimal.parse("5000", 18),
    LLTV: Decimal.parse("0.8", 18), // 80% LLTV
    priceRate: Decimal.parse("2000", 18), // 1 collateral = 2000 loan tokens
    loanDecimals: 18,
    collateralDecimals: 18,
  };

  describe("simulateComputeLTV", () => {
    it("should calculate LTV correctly", () => {
      const borrowed = Decimal.parse("1000", 18);
      const collateral = Decimal.parse("1", 18);
      const priceRate = Decimal.parse("2000", 18);

      const ltv = simulateComputeLTV(borrowed, collateral, priceRate);
      // LTV = 1000 / (1 * 2000) = 0.5 = 50%
      expect(ltv.toString(18)).toBe("0.5");
    });

    it("should return zero for zero collateral", () => {
      const ltv = simulateComputeLTV(
        Decimal.parse("1000", 18),
        Decimal.ZERO,
        Decimal.parse("2000", 18),
      );
      expect(ltv.eq(Decimal.ZERO)).toBe(true);
    });
  });

  describe("simulateComputeLoanable", () => {
    it("should calculate max loanable amount", () => {
      const collateral = Decimal.parse("1", 18);
      const borrowed = Decimal.ZERO;
      const LLTV = Decimal.parse("0.8", 18);
      const priceRate = Decimal.parse("2000", 18);

      const loanable = simulateComputeLoanable(
        collateral,
        borrowed,
        LLTV,
        priceRate,
        18,
      );
      // loanable = 1 * 0.8 * 0.98 * 2000 - 0 = 1568
      expect(Number(loanable.toString(18))).toBeCloseTo(1568, 0);
    });
  });

  describe("simulateComputeWithdrawable", () => {
    it("should calculate max withdrawable collateral", () => {
      const collateral = Decimal.parse("2", 18);
      const borrowed = Decimal.parse("1000", 18);
      const repay = Decimal.ZERO;
      const LLTV = Decimal.parse("0.8", 18);
      const priceRate = Decimal.parse("2000", 18);

      const withdrawable = simulateComputeWithdrawable(
        collateral,
        borrowed,
        repay,
        LLTV,
        priceRate,
        18,
      );

      // Should be able to withdraw some collateral
      expect(withdrawable.gt(Decimal.ZERO)).toBe(true);
      expect(withdrawable.lt(collateral)).toBe(true);
    });
  });

  describe("simulateComputeLiqPriceRate", () => {
    it("should calculate liquidation price rate", () => {
      const borrowed = Decimal.parse("1000", 18);
      const collateral = Decimal.parse("1", 18);
      const LLTV = Decimal.parse("0.8", 18);

      const liqPrice = simulateComputeLiqPriceRate(borrowed, collateral, LLTV);
      // liqPrice = 1000 / 1 / 0.8 = 1250
      expect(liqPrice.toString(18)).toBe("1250");
    });

    it("should return zero for zero collateral", () => {
      const liqPrice = simulateComputeLiqPriceRate(
        Decimal.parse("1000", 18),
        Decimal.ZERO,
        Decimal.parse("0.8", 18),
      );
      expect(liqPrice.eq(Decimal.ZERO)).toBe(true);
    });
  });

  describe("simulateMarketBorrow", () => {
    it("should simulate borrow operation", () => {
      const result = simulateMarketBorrow({
        supplyAmount: Decimal.parse("1", 18),
        borrowAmount: Decimal.parse("500", 18),
        userPosition: {
          collateral: Decimal.parse("1", 18),
          borrowed: Decimal.ZERO,
        },
        marketState,
      });

      expect(result.collateral.toString(18)).toBe("2");
      expect(result.borrowed.toString(18)).toBe("500");
      expect(result.LTV.gt(Decimal.ZERO)).toBe(true);
      expect(result.loanable.gt(Decimal.ZERO)).toBe(true);
      expect(result.liqPriceRate.gt(Decimal.ZERO)).toBe(true);
    });

    it("should return baseLoanable not affected by borrowAmount", () => {
      const base = simulateMarketBorrow({
        supplyAmount: Decimal.parse("1", 18),
        borrowAmount: Decimal.ZERO,
        userPosition: {
          collateral: Decimal.parse("1", 18),
          borrowed: Decimal.ZERO,
        },
        marketState,
      });
      const withBorrow = simulateMarketBorrow({
        supplyAmount: Decimal.parse("1", 18),
        borrowAmount: Decimal.parse("500", 18),
        userPosition: {
          collateral: Decimal.parse("1", 18),
          borrowed: Decimal.ZERO,
        },
        marketState,
      });

      // baseLoanable should be identical regardless of borrowAmount
      expect(base.baseLoanable.toString(18)).toBe(
        withBorrow.baseLoanable.toString(18),
      );
      // loanable should differ (post-borrow remaining)
      expect(base.loanable.gt(withBorrow.loanable)).toBe(true);
    });

    it("should compute loanable for a target LTV via computeLoanableForLTV", () => {
      const result = simulateMarketBorrow({
        supplyAmount: Decimal.parse("1", 18),
        borrowAmount: Decimal.ZERO,
        userPosition: {
          collateral: Decimal.parse("1", 18),
          borrowed: Decimal.ZERO,
        },
        marketState,
      });

      // collateral=2, priceRate=2000, targetLTV=0.4
      // loanable = 2 * 0.4 * 2000 - 0 = 1600
      const loanable = result.computeLoanableForLTV(0.4);
      expect(Number(loanable.toString(18))).toBeCloseTo(1600, 0);
    });

    it("should calculate borrow rate when computeBorrowRate provided", () => {
      const result = simulateMarketBorrow({
        supplyAmount: Decimal.ZERO,
        borrowAmount: Decimal.parse("500", 18),
        userPosition: {
          collateral: Decimal.parse("2", 18),
          borrowed: Decimal.ZERO,
        },
        marketState,
        computeBorrowRate: () => Decimal.parse("0.05", 18), // 5%
      });

      expect(result.borrowRate).toBeDefined();
      expect(result.borrowRate!.toString(18)).toBe("0.05");
    });
  });

  describe("simulateMarketRepay", () => {
    it("should simulate repay operation", () => {
      const result = simulateMarketRepay({
        repayAmount: Decimal.parse("500", 18),
        withdrawAmount: Decimal.parse("0.5", 18),
        userPosition: {
          collateral: Decimal.parse("2", 18),
          borrowed: Decimal.parse("1000", 18),
        },
        marketState,
      });

      expect(result.collateral.toString(18)).toBe("1.5");
      expect(result.borrowed.toString(18)).toBe("500");
    });

    it("should handle repay all", () => {
      const result = simulateMarketRepay({
        repayAmount: Decimal.parse("1000", 18),
        withdrawAmount: Decimal.ZERO,
        isRepayAll: true,
        userPosition: {
          collateral: Decimal.parse("2", 18),
          borrowed: Decimal.parse("1000", 18),
        },
        marketState,
      });

      expect(result.borrowed.eq(Decimal.ZERO)).toBe(true);
      // When repaying all, withdrawable should be all collateral
      expect(result.withdrawable.toString(18)).toBe("2");
    });

    it("should calculate borrow rate when computeBorrowRate provided", () => {
      const result = simulateMarketRepay({
        repayAmount: Decimal.parse("500", 18),
        withdrawAmount: Decimal.ZERO,
        userPosition: {
          collateral: Decimal.parse("2", 18),
          borrowed: Decimal.parse("1000", 18),
        },
        marketState,
        computeBorrowRate: (utilRate) => utilRate.mul(Decimal.parse("0.1", 18)),
      });

      expect(result.borrowRate).toBeDefined();
      // newUtilRate = (5000 - 500) / 10000 = 0.45
      // borrowRate = 0.45 * 0.1 = 0.045
      expect(result.borrowRate!.valueOf()).toBeCloseTo(0.045, 10);
    });

    it("should return zero borrow rate when totalSupply is zero", () => {
      const zeroSupplyMarketState = {
        ...marketState,
        totalSupply: Decimal.ZERO,
      };
      const result = simulateMarketRepay({
        repayAmount: Decimal.parse("500", 18),
        withdrawAmount: Decimal.ZERO,
        userPosition: {
          collateral: Decimal.parse("2", 18),
          borrowed: Decimal.parse("1000", 18),
        },
        marketState: zeroSupplyMarketState,
        computeBorrowRate: () => Decimal.parse("0.05", 18),
      });

      expect(result.borrowRate).toBeDefined();
      // When totalSupply is zero, utilRate = 0, so computeBorrowRate gets 0
      expect(result.borrowRate!.toString(18)).toBe("0.05");
    });
  });

  describe("simulateMarketBorrow with zero totalSupply", () => {
    it("should return zero utilization rate when totalSupply is zero", () => {
      const zeroSupplyMarketState = {
        ...marketState,
        totalSupply: Decimal.ZERO,
      };
      let receivedUtilRate: Decimal | undefined;
      simulateMarketBorrow({
        supplyAmount: Decimal.parse("1", 18),
        borrowAmount: Decimal.parse("500", 18),
        userPosition: {
          collateral: Decimal.parse("1", 18),
          borrowed: Decimal.ZERO,
        },
        marketState: zeroSupplyMarketState,
        computeBorrowRate: (utilRate) => {
          receivedUtilRate = utilRate;
          return Decimal.parse("0.05", 18);
        },
      });

      expect(receivedUtilRate).toBeDefined();
      expect(receivedUtilRate!.eq(Decimal.ZERO)).toBe(true);
    });
  });
});

describe("Smart Market Simulation", () => {
  const smartMarketState = {
    totalSupply: Decimal.parse("10000", 18),
    totalBorrow: Decimal.parse("5000", 18),
    LLTV: Decimal.parse("0.8", 18),
    priceRate: Decimal.parse("1", 18), // 1:1 for simplicity
    loanDecimals: 18,
    lpDecimals: 18,
    lpBalances: [Decimal.parse("5000", 18), Decimal.parse("5000", 18)] as const,
    totalLp: Decimal.parse("10000", 18),
  };

  describe("computeSmartLTV", () => {
    it("should calculate LTV for smart market", () => {
      const borrowed = Decimal.parse("500", 18);
      const collateral = Decimal.parse("1000", 18);
      const priceRate = Decimal.parse("1", 18);

      const ltv = computeSmartLTV(borrowed, collateral, priceRate);
      expect(ltv.toString(18)).toBe("0.5");
    });
  });

  describe("computeSmartLoanable", () => {
    it("should calculate max loanable for smart market", () => {
      const collateral = Decimal.parse("1000", 18);
      const borrowed = Decimal.ZERO;
      const LLTV = Decimal.parse("0.8", 18);
      const priceRate = Decimal.parse("1", 18);

      const loanable = computeSmartLoanable(
        collateral,
        borrowed,
        LLTV,
        priceRate,
        18,
      );
      // loanable = 1000 * 0.8 * 0.98 * 1 = 784
      expect(Number(loanable.toString(18))).toBeCloseTo(784, 0);
    });
  });

  describe("computeSmartWithdrawable", () => {
    it("should return zero when priceRate is zero", () => {
      const [a, b, lp] = computeSmartWithdrawable(
        Decimal.parse("100", 18),
        Decimal.parse("50", 18),
        Decimal.ZERO,
        Decimal.parse("0.8", 18),
        Decimal.ZERO, // zero priceRate
        18,
        [Decimal.parse("5000", 18), Decimal.parse("5000", 18)],
        Decimal.parse("10000", 18),
      );
      expect(a.eq(Decimal.ZERO)).toBe(true);
      expect(b.eq(Decimal.ZERO)).toBe(true);
      expect(lp.eq(Decimal.ZERO)).toBe(true);
    });

    it("should return zero when totalLp is zero", () => {
      const [a, b, lp] = computeSmartWithdrawable(
        Decimal.parse("100", 18),
        Decimal.parse("50", 18),
        Decimal.ZERO,
        Decimal.parse("0.8", 18),
        Decimal.parse("1", 18),
        18,
        [Decimal.parse("5000", 18), Decimal.parse("5000", 18)],
        Decimal.ZERO, // zero totalLp
      );
      expect(a.eq(Decimal.ZERO)).toBe(true);
      expect(b.eq(Decimal.ZERO)).toBe(true);
      expect(lp.eq(Decimal.ZERO)).toBe(true);
    });
  });

  describe("breakdownLp", () => {
    it("should break down LP into token amounts", () => {
      const lpAmount = Decimal.parse("1000", 18);
      const lpBalances = [
        Decimal.parse("5000", 18),
        Decimal.parse("5000", 18),
      ] as const;
      const totalLp = Decimal.parse("10000", 18);

      const { aOutput, bOutput } = breakdownLp(lpAmount, lpBalances, totalLp);
      // 1000 / 10000 * 5000 = 500
      expect(aOutput.toString(18)).toBe("500");
      expect(bOutput.toString(18)).toBe("500");
    });

    it("should return zero for zero totalLp", () => {
      const { aOutput, bOutput } = breakdownLp(
        Decimal.parse("1000", 18),
        [Decimal.parse("5000", 18), Decimal.parse("5000", 18)],
        Decimal.ZERO,
      );
      expect(aOutput.eq(Decimal.ZERO)).toBe(true);
      expect(bOutput.eq(Decimal.ZERO)).toBe(true);
    });
  });

  describe("simulateSmartMarketBorrow", () => {
    it("should simulate smart market borrow with LP supply", () => {
      const result = simulateSmartMarketBorrow({
        supplyLpAmount: Decimal.parse("100", 18),
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        borrowAmount: Decimal.parse("50", 18),
        userPosition: {
          collateral: Decimal.parse("100", 18),
          borrowed: Decimal.ZERO,
          lpTokenA: Decimal.parse("50", 18),
          lpTokenB: Decimal.parse("50", 18),
        },
        marketState: smartMarketState,
      });

      // Collateral should increase by LP amount
      expect(result.collateral.toString(18)).toBe("200");
      expect(result.borrowed.toString(18)).toBe("50");
      expect(result.LTV.gt(Decimal.ZERO)).toBe(true);
      expect(result.loanable.gte(Decimal.ZERO)).toBe(true);
    });

    it("should return baseLoanable not affected by borrowAmount", () => {
      const userPosition = {
        collateral: Decimal.parse("100", 18),
        borrowed: Decimal.ZERO,
        lpTokenA: Decimal.parse("50", 18),
        lpTokenB: Decimal.parse("50", 18),
      };
      const base = simulateSmartMarketBorrow({
        supplyLpAmount: Decimal.parse("100", 18),
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        borrowAmount: Decimal.ZERO,
        userPosition,
        marketState: smartMarketState,
      });
      const withBorrow = simulateSmartMarketBorrow({
        supplyLpAmount: Decimal.parse("100", 18),
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        borrowAmount: Decimal.parse("50", 18),
        userPosition,
        marketState: smartMarketState,
      });

      expect(base.baseLoanable.toString(18)).toBe(
        withBorrow.baseLoanable.toString(18),
      );
      expect(base.loanable.gt(withBorrow.loanable)).toBe(true);
    });

    it("should compute loanable for a target LTV via computeLoanableForLTV", () => {
      const result = simulateSmartMarketBorrow({
        supplyLpAmount: Decimal.parse("100", 18),
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        borrowAmount: Decimal.ZERO,
        userPosition: {
          collateral: Decimal.parse("100", 18),
          borrowed: Decimal.ZERO,
          lpTokenA: Decimal.parse("50", 18),
          lpTokenB: Decimal.parse("50", 18),
        },
        marketState: smartMarketState,
      });

      // collateral=200, priceRate=1, targetLTV=0.4
      // loanable = 200 * 0.4 * 1 - 0 = 80
      const loanable = result.computeLoanableForLTV(0.4);
      expect(Number(loanable.toString(18))).toBeCloseTo(80, 0);
    });

    it("should calculate borrow rate when provided", () => {
      const result = simulateSmartMarketBorrow({
        supplyLpAmount: Decimal.ZERO,
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        borrowAmount: Decimal.parse("50", 18),
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.ZERO,
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: smartMarketState,
        computeBorrowRate: () => Decimal.parse("0.08", 18),
      });

      expect(result.borrowRate).toBeDefined();
      expect(result.borrowRate!.toString(18)).toBe("0.08");
    });

    it("should use computeLpOutput when provided", () => {
      const result = simulateSmartMarketBorrow({
        supplyLpAmount: Decimal.ZERO,
        tokenAAmount: Decimal.parse("50", 18),
        tokenBAmount: Decimal.parse("50", 18),
        borrowAmount: Decimal.parse("50", 18),
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.ZERO,
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: smartMarketState,
        computeLpOutput: (_amounts, currentCollateral) => {
          // Mock LP output calculation
          return {
            aOutput: Decimal.parse("150", 18),
            bOutput: Decimal.parse("150", 18),
            lpOutput: currentCollateral.add(Decimal.parse("100", 18)),
          };
        },
      });

      expect(result.lpTokenA.toString(18)).toBe("150");
      expect(result.lpTokenB.toString(18)).toBe("150");
    });

    it("should return zero utilization rate when totalSupply is zero", () => {
      const zeroSupplyMarketState = {
        ...smartMarketState,
        totalSupply: Decimal.ZERO,
      };
      let receivedUtilRate: Decimal | undefined;
      simulateSmartMarketBorrow({
        supplyLpAmount: Decimal.ZERO,
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        borrowAmount: Decimal.parse("50", 18),
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.ZERO,
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: zeroSupplyMarketState,
        computeBorrowRate: (utilRate) => {
          receivedUtilRate = utilRate;
          return Decimal.parse("0.05", 18);
        },
      });

      expect(receivedUtilRate).toBeDefined();
      expect(receivedUtilRate!.eq(Decimal.ZERO)).toBe(true);
    });
  });

  describe("simulateSmartMarketRepay", () => {
    it("should simulate smart market repay", () => {
      const result = simulateSmartMarketRepay({
        swapType: "fixed",
        repayAmount: Decimal.parse("50", 18),
        withdrawLpAmount: Decimal.ZERO,
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        slippage: Decimal.parse("0.005", 3),
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.parse("100", 18),
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: smartMarketState,
      });

      expect(result.borrowed.toString(18)).toBe("50");
      expect(result.exceedError).toBe(false);
    });

    it("should handle repay all", () => {
      const result = simulateSmartMarketRepay({
        swapType: "fixed",
        repayAmount: Decimal.parse("100", 18),
        withdrawLpAmount: Decimal.ZERO,
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        slippage: Decimal.parse("0.005", 3),
        isRepayAll: true,
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.parse("100", 18),
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: smartMarketState,
      });

      expect(result.borrowed.eq(Decimal.ZERO)).toBe(true);
    });

    it("should handle LP withdraw mode", () => {
      const result = simulateSmartMarketRepay({
        swapType: "lp",
        repayAmount: Decimal.ZERO,
        withdrawLpAmount: Decimal.parse("50", 18),
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        slippage: Decimal.parse("0.005", 3),
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.parse("50", 18),
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: smartMarketState,
      });

      // LP output should be reduced by withdraw amount
      expect(result.lpTokenA.lt(Decimal.parse("100", 18))).toBe(true);
      expect(result.lpTokenB.lt(Decimal.parse("100", 18))).toBe(true);
    });

    it("should calculate borrow rate when computeBorrowRate provided", () => {
      const result = simulateSmartMarketRepay({
        swapType: "fixed",
        repayAmount: Decimal.parse("50", 18),
        withdrawLpAmount: Decimal.ZERO,
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        slippage: Decimal.parse("0.005", 3),
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.parse("100", 18),
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: smartMarketState,
        computeBorrowRate: (utilRate) => utilRate.mul(Decimal.parse("0.1", 18)),
      });

      expect(result.borrowRate).toBeDefined();
      // newUtilRate = (5000 - 50) / 10000 = 0.495
      // borrowRate = 0.495 * 0.1 = 0.0495
      expect(result.borrowRate!.valueOf()).toBeCloseTo(0.0495, 10);
    });

    it("should handle variable mode with computeLpOutput slippage", () => {
      const result = simulateSmartMarketRepay({
        swapType: "variable",
        repayAmount: Decimal.parse("50", 18),
        withdrawLpAmount: Decimal.ZERO,
        tokenAAmount: Decimal.parse("25", 18),
        tokenBAmount: Decimal.parse("25", 18),
        slippage: Decimal.parse("0.01", 3), // 1% slippage
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.parse("100", 18),
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: smartMarketState,
        computeLpOutput: (amounts, currentCollateral, slippage?) => {
          // amounts is [tokenAAmount.negated(), tokenBAmount.negated()]
          // For testing, just compute LP based on amounts with slippage
          const lpChange = amounts[0].add(amounts[1]);
          const slippageFactor = slippage
            ? Decimal.ONE.sub(slippage)
            : Decimal.ONE;
          return {
            aOutput: amounts[0].negated().mul(slippageFactor),
            bOutput: amounts[1].negated().mul(slippageFactor),
            lpOutput: currentCollateral.add(lpChange.mul(slippageFactor)),
          };
        },
      });

      expect(result.borrowed.toString(18)).toBe("50");
      // exceedError should be calculated with slippage consideration
      expect(typeof result.exceedError).toBe("boolean");
    });

    it("should return zero borrow rate when totalSupply is zero", () => {
      const zeroSupplyMarketState = {
        ...smartMarketState,
        totalSupply: Decimal.ZERO,
      };
      let receivedUtilRate: Decimal | undefined;
      const result = simulateSmartMarketRepay({
        swapType: "fixed",
        repayAmount: Decimal.parse("50", 18),
        withdrawLpAmount: Decimal.ZERO,
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        slippage: Decimal.parse("0.005", 3),
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.parse("100", 18),
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: zeroSupplyMarketState,
        computeBorrowRate: (utilRate) => {
          receivedUtilRate = utilRate;
          return Decimal.parse("0.05", 18);
        },
      });

      expect(receivedUtilRate).toBeDefined();
      expect(receivedUtilRate!.eq(Decimal.ZERO)).toBe(true);
      expect(result.borrowRate!.toString(18)).toBe("0.05");
    });

    it("should handle isWithdrawAll flag", () => {
      const result = simulateSmartMarketRepay({
        swapType: "fixed",
        repayAmount: Decimal.parse("100", 18),
        withdrawLpAmount: Decimal.ZERO,
        tokenAAmount: Decimal.ZERO,
        tokenBAmount: Decimal.ZERO,
        slippage: Decimal.parse("0.005", 3),
        isRepayAll: true,
        isWithdrawAll: true,
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.parse("100", 18),
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: smartMarketState,
      });

      // When isWithdrawAll is true, lpOutput, aOutput, bOutput should be zero
      expect(result.lpTokenA.eq(Decimal.ZERO)).toBe(true);
      expect(result.lpTokenB.eq(Decimal.ZERO)).toBe(true);
      expect(result.borrowed.eq(Decimal.ZERO)).toBe(true);
    });

    it("should handle variable mode without computeLpOutput (fallback)", () => {
      const result = simulateSmartMarketRepay({
        swapType: "variable",
        repayAmount: Decimal.parse("50", 18),
        withdrawLpAmount: Decimal.ZERO,
        tokenAAmount: Decimal.parse("25", 18),
        tokenBAmount: Decimal.parse("25", 18),
        slippage: Decimal.parse("0.01", 3),
        userPosition: {
          collateral: Decimal.parse("200", 18),
          borrowed: Decimal.parse("100", 18),
          lpTokenA: Decimal.parse("100", 18),
          lpTokenB: Decimal.parse("100", 18),
        },
        marketState: smartMarketState,
        // No computeLpOutput provided - should use fallback
      });

      expect(result.borrowed.toString(18)).toBe("50");
      // exceedError uses fallback logic when no computeLpOutput
      expect(typeof result.exceedError).toBe("boolean");
    });
  });
});

describe("Threshold Constants", () => {
  it("MARKET_THRESHOLD should be 98%", () => {
    expect(MARKET_THRESHOLD.toString(2)).toBe("0.98");
  });

  it("SMART_THRESHOLD should be 98%", () => {
    expect(SMART_THRESHOLD.toString(2)).toBe("0.98");
  });
});
