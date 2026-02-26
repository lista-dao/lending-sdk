import type { Address, PublicClient } from "viem";
import { MathLib } from "@morpho-org/blue-sdk";
import type {
  MarketExtraInfo,
  MarketUserData,
  UserFixedTermData,
} from "@lista-dao/moolah-sdk-core";
import { Decimal } from "@lista-dao/moolah-sdk-core";
import {
  getERC20Balance,
  getUserPosition,
  isWhiteList,
} from "@lista-dao/moolah-sdk-core";

const THRESHOLD = new Decimal(98n, 2);

/**
 * Get user's market data
 */
export async function getMarketUserData(
  publicClient: PublicClient,
  contracts: {
    moolah: Address;
  },
  marketId: Address,
  userAddress: Address,
  marketExtraInfo: MarketExtraInfo,
  fixedTermData?: UserFixedTermData,
): Promise<MarketUserData> {
  const [position, isWhiteListResult] = await Promise.all([
    getUserPosition(publicClient, contracts.moolah, marketId, userAddress),
    isWhiteList(publicClient, contracts.moolah, marketId, userAddress),
  ]);

  // Get balances
  const loanBalancePromise = marketExtraInfo.loanIsNative
    ? publicClient.getBalance({ address: userAddress })
    : getERC20Balance(
        publicClient,
        marketExtraInfo.loanInfo.address,
        userAddress,
      );

  const collateralBalancePromise = marketExtraInfo.collateralIsNative
    ? publicClient.getBalance({ address: userAddress })
    : getERC20Balance(
        publicClient,
        marketExtraInfo.collateralInfo.address,
        userAddress,
      );

  const [loanBalance, collateralBalance] = await Promise.all([
    loanBalancePromise,
    collateralBalancePromise,
  ]);

  const {
    loanInfo,
    collateralInfo,
    LLTV,
    loanIsNative,
    collateralIsNative,
    rateView,
    priceRate,
    lastUpdate,
    totalBorrowAssets,
    totalBorrowShares,
  } = marketExtraInfo;

  const balances = {
    loan: new Decimal(loanBalance, loanInfo.decimals),
    collateral: new Decimal(collateralBalance, collateralInfo.decimals),
  };

  const decimals = {
    l: loanInfo.decimals,
    c: collateralInfo.decimals,
  };

  const currentTime = BigInt(Math.round(Date.now() / 1000));
  const unrealizedRate = new Decimal(
    MathLib.wTaylorCompounded(rateView, currentTime - lastUpdate),
  );

  const { borrowShares, collateral: collateralN } = position;

  const baseBorrowed =
    totalBorrowShares > 0n
      ? new Decimal(totalBorrowAssets, decimals.l)
          .mul(new Decimal(borrowShares))
          .div(new Decimal(totalBorrowShares))
      : Decimal.ZERO;

  const borrowed = baseBorrowed.mul(unrealizedRate.add(Decimal.ONE));
  const collateral = new Decimal(collateralN, decimals.c);
  const liqPriceRate = collateral.gt(Decimal.ZERO)
    ? borrowed.div(collateral).div(LLTV).roundDown(18)
    : Decimal.ZERO;

  // Use fixed term data if available, otherwise use calculated values
  const finalBorrowed =
    fixedTermData && !fixedTermData.totalBorrowed.isZero()
      ? fixedTermData.totalBorrowed
      : borrowed;

  const finalBorrowRate =
    fixedTermData && !fixedTermData.weightedBorrowRate.isZero()
      ? fixedTermData.weightedBorrowRate
      : marketExtraInfo.borrowRate;

  const _getExtraRepayAmount = () => {
    const now = BigInt(Math.round(Date.now() / 1000));
    const unrealizedRate = new Decimal(
      MathLib.wTaylorCompounded(rateView, now - currentTime + BigInt(20 * 60)),
    );

    return borrowed.mul(unrealizedRate.add(Decimal.ONE));
  };

  const _computeLTV = ({
    supplyAmount,
    borrowAmount,
    repayAmount,
    withdrawAmount,
  }: {
    supplyAmount?: string | number;
    borrowAmount?: string | number;
    repayAmount?: string | number;
    withdrawAmount?: string | number;
  }) => {
    const supply = Decimal.parse(supplyAmount ?? 0, decimals.c);
    const withdraw = Decimal.parse(withdrawAmount ?? 0, decimals.c);
    const borrow = Decimal.parse(borrowAmount ?? 0, decimals.l);
    const repay = Decimal.parse(repayAmount ?? 0, decimals.l);

    const denominator = collateral.add(supply).sub(withdraw).mul(priceRate);
    const numerator = borrowed.add(borrow).sub(repay);

    return denominator.gt(0n) ? numerator.div(denominator) : Decimal.ZERO;
  };

  const _computeLoanable = (supplyAmount: string | number, LTV?: number) => {
    const supply = Decimal.parse(supplyAmount ?? 0, decimals.c);
    const currentLTV = LTV == null ? LLTV.mul(THRESHOLD) : Decimal.parse(LTV);

    return collateral
      .add(supply)
      .mul(currentLTV)
      .mul(priceRate)
      .sub(borrowed)
      .roundDown(decimals.l);
  };

  const _computeWithdrawable = (repayAmount: string | number) => {
    const repay = Decimal.parse(repayAmount, decimals.l);
    return collateral
      .sub(borrowed.sub(repay).div(priceRate).div(LLTV).div(THRESHOLD))
      .roundDown(decimals.c);
  };

  const LTV = _computeLTV({});
  const loanable = _computeLoanable(0);
  const withdrawable = _computeWithdrawable(0);

  return {
    collateral,
    borrowShares,
    borrowed: finalBorrowed,
    rawBorrowed: borrowed,
    borrowRate: finalBorrowRate,
    loanable,
    withdrawable,
    LTV,
    LLTV,
    liqPriceRate,
    decimals,
    balances,
    isWhiteList: isWhiteListResult,
    loanInfo,
    collateralInfo,
    loanIsNative,
    collateralIsNative,
    _getExtraRepayAmount,
    _computeLTV,
    _computeLoanable,
    _computeWithdrawable,
  };
}
