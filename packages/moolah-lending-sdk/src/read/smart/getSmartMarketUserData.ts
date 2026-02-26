import type { Address, PublicClient } from "viem";
import {
  Decimal,
  MOOLAH_ABI,
  ERC20_ABI,
  type SmartMarketExtraInfo,
  type SmartMarketUserData,
} from "@lista-dao/moolah-sdk-core";
import { MathLib } from "@morpho-org/blue-sdk";

const THRESHOLD = new Decimal(98n, 2);

/**
 * Get Smart Market user data
 */
export async function getSmartMarketUserData(
  publicClient: PublicClient,
  contracts: {
    moolah: Address;
  },
  marketId: Address,
  userAddress: Address,
  extraInfo: SmartMarketExtraInfo,
): Promise<SmartMarketUserData> {
  const {
    loanInfo,
    lpInfo,
    tokenAInfo,
    tokenBInfo,
    LLTV,
    loanIsNative,
    tokenAIsNative,
    tokenBIsNative,
    rateView,
    borrowRate,
    priceRate,
    balances: lpBalances,
    totalLp,
  } = extraInfo;

  // Get position and whitelist status
  const [position, isWhiteList] = await Promise.all([
    publicClient.readContract({
      address: contracts.moolah,
      abi: MOOLAH_ABI,
      functionName: "position",
      args: [marketId, userAddress],
    }),
    publicClient.readContract({
      address: contracts.moolah,
      abi: MOOLAH_ABI,
      functionName: "isWhiteList",
      args: [marketId, userAddress],
    }),
  ]);

  const decimals = {
    l: loanInfo.decimals,
    c: 18,
    a: tokenAInfo.decimals,
    b: tokenBInfo.decimals,
    lp: lpInfo.decimals,
  };

  // Get user balances
  const getErc20Balance = async (tokenAddress: Address): Promise<Decimal> => {
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [userAddress],
    });
    return new Decimal(balance);
  };

  const getNativeBalance = async (): Promise<Decimal> => {
    const balance = await publicClient.getBalance({ address: userAddress });
    return new Decimal(balance);
  };

  const [lpBalance, loanBalance, tokenABalance, tokenBBalance] =
    await Promise.all([
      getErc20Balance(lpInfo.address),
      loanIsNative ? getNativeBalance() : getErc20Balance(loanInfo.address),
      tokenAIsNative ? getNativeBalance() : getErc20Balance(tokenAInfo.address),
      tokenBIsNative ? getNativeBalance() : getErc20Balance(tokenBInfo.address),
    ]);

  const balances = {
    lp: lpBalance,
    loan: loanBalance,
    tokenA: tokenABalance,
    tokenB: tokenBBalance,
  };

  const currentTime = BigInt(Math.round(Date.now() / 1000));
  const unrealizedRate = new Decimal(
    MathLib.wTaylorCompounded(rateView, currentTime - extraInfo.lastUpdate),
  );

  const [, borrowShares, _collateral] = position;
  const collateral = new Decimal(_collateral);

  const baseBorrowed =
    extraInfo.totalBorrowShares > 0n
      ? new Decimal(
          (borrowShares * extraInfo.totalBorrowAssets) /
            extraInfo.totalBorrowShares,
          loanInfo.decimals,
        )
      : Decimal.ZERO;
  const borrowed = baseBorrowed.mul(unrealizedRate.add(Decimal.ONE));

  const _getExtraRepayAmount = () => {
    const now = BigInt(Math.round(Date.now() / 1000));
    const futureUnrealizedRate = new Decimal(
      MathLib.wTaylorCompounded(rateView, now - currentTime + BigInt(20 * 60)),
    );
    return borrowed.mul(futureUnrealizedRate.add(Decimal.ONE));
  };

  const lpTokenA = collateral.gt(Decimal.ZERO)
    ? collateral.mul(lpBalances[0]).div(totalLp)
    : Decimal.ZERO;
  const lpTokenB = collateral.gt(Decimal.ZERO)
    ? collateral.mul(lpBalances[1]).div(totalLp)
    : Decimal.ZERO;

  const _computeLTV = ({
    collateral: collateralAmount,
    borrowAmount,
  }: {
    collateral: Decimal;
    borrowAmount?: Decimal;
  }) => {
    try {
      return borrowed
        .add(borrowAmount ?? Decimal.ZERO)
        .div(collateralAmount.mul(priceRate));
    } catch {
      return Decimal.ZERO;
    }
  };

  const _computeLoanable = (collateralAmount: Decimal, LTV?: number) => {
    const currentLTV = LTV == null ? LLTV.mul(THRESHOLD) : Decimal.parse(LTV);
    return collateralAmount
      .mul(currentLTV)
      .mul(priceRate)
      .sub(borrowed)
      .roundDown(decimals.l);
  };

  const _computeWithdrawable = (
    repay: Decimal,
    slippage: Decimal,
    isFixed: boolean = false,
  ): readonly [Decimal, Decimal, Decimal] => {
    if (priceRate.isZero()) {
      return [Decimal.ZERO, Decimal.ZERO, Decimal.ZERO] as const;
    }

    const percent = Decimal.ONE.sub(slippage);
    let maxWithdrawLp = collateral
      .sub(borrowed.sub(repay).div(priceRate).div(LLTV).div(THRESHOLD))
      .roundDown(decimals.c);

    if (isFixed) {
      const maxWithdrawA = lpBalances[0].mul(maxWithdrawLp).div(totalLp);
      const maxWithdrawB = lpBalances[1].mul(maxWithdrawLp).div(totalLp);

      return [maxWithdrawA, maxWithdrawB, maxWithdrawLp] as const;
    }

    maxWithdrawLp = maxWithdrawLp.mul(percent).roundDown(18);
    const maxWithdrawA = lpBalances[0].mul(maxWithdrawLp).div(totalLp);
    const maxWithdrawB = lpBalances[1].mul(maxWithdrawLp).div(totalLp);
    return [maxWithdrawA, maxWithdrawB, maxWithdrawLp] as const;
  };

  const LTV = _computeLTV({ collateral });
  const loanable = _computeLoanable(collateral);

  return {
    collateral,
    lpTokenA,
    lpTokenB,
    borrowShares,
    borrowed,
    borrowRate,
    loanable,
    LTV,
    LLTV,
    decimals,
    balances,
    isWhiteList,
    _getExtraRepayAmount,
    _computeLTV,
    _computeLoanable,
    _computeWithdrawable,
  };
}
