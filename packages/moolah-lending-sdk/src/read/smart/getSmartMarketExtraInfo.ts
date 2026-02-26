import type { Address, PublicClient } from "viem";
import { zeroAddress } from "viem";
import {
  Decimal,
  MOOLAH_ABI,
  INTEREST_RATE_MODEL_ABI,
  SMART_PROVIDER_ABI,
  STABLE_SWAP_POOL_ABI,
  STABLE_SWAP_LP_ABI,
  ERC20_ABI,
  getNativeCurrencySymbol,
  getAnnualBorrowRate,
  getBorrowRateInfo,
  DEFAULT_RATE_CAP,
  type NetworkName,
  type SmartMarketExtraInfo,
  type TokenInfo,
} from "@lista-dao/moolah-sdk-core";

const WEI_VALUE = 10n ** 18n;
const NATIVE_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;

/**
 * Get Smart Market extra info from chain
 */
export async function getSmartMarketExtraInfo(
  publicClient: PublicClient,
  contracts: {
    moolah: Address;
    interestRateModel: Address;
    fixedRateIrm: Address;
    nativeProvider: Address;
    wbnb: Address;
  },
  network: NetworkName,
  marketId: Address,
): Promise<SmartMarketExtraInfo> {
  // Get basic market data
  const [[loanToken, collateralToken, oracle, irm, lltv], market] =
    await Promise.all([
      publicClient.readContract({
        address: contracts.moolah,
        abi: MOOLAH_ABI,
        functionName: "idToMarketParams",
        args: [marketId],
      }),
      publicClient.readContract({
        address: contracts.moolah,
        abi: MOOLAH_ABI,
        functionName: "market",
        args: [marketId],
      }),
    ]);

  const [
    totalSupplyAssets,
    totalSupplyShares,
    totalBorrowAssets,
    totalBorrowShares,
    lastUpdate,
    fee,
  ] = market;

  const LLTV = new Decimal(lltv);

  const paramsObj = {
    loanToken,
    collateralToken,
    oracle,
    irm,
    lltv,
  };

  const marketObj = {
    totalSupplyAssets,
    totalSupplyShares,
    totalBorrowAssets,
    totalBorrowShares,
    lastUpdate,
    fee,
  };

  const isFixedRateIrm =
    contracts.fixedRateIrm !== zeroAddress && irm === contracts.fixedRateIrm;

  // Get interest rate and provider info
  const [
    _rateView,
    _rateCap,
    _rateFloor,
    _priceRate,
    _rateAtTarget,
    minLoan,
    loanProvider,
    collateralProvider,
  ] = await Promise.all([
    publicClient.readContract({
      address: irm,
      abi: INTEREST_RATE_MODEL_ABI,
      functionName: "borrowRateView",
      args: [paramsObj, marketObj],
    }),
    publicClient.readContract({
      address: irm,
      abi: INTEREST_RATE_MODEL_ABI,
      functionName: "rateCap",
      args: [marketId],
    }),
    publicClient
      .readContract({
        address: irm,
        abi: INTEREST_RATE_MODEL_ABI,
        functionName: "rateFloor",
        args: [marketId],
      })
      .catch(() => 0n), // rateFloor may not exist on all IRMs
    publicClient.readContract({
      address: contracts.moolah,
      abi: MOOLAH_ABI,
      functionName: "getPrice",
      args: [paramsObj],
    }),
    isFixedRateIrm
      ? Promise.resolve(0n)
      : publicClient.readContract({
          address: irm,
          abi: INTEREST_RATE_MODEL_ABI,
          functionName: "rateAtTarget",
          args: [marketId],
        }),
    publicClient.readContract({
      address: contracts.moolah,
      abi: MOOLAH_ABI,
      functionName: "minLoan",
      args: [paramsObj],
    }),
    publicClient.readContract({
      address: contracts.moolah,
      abi: MOOLAH_ABI,
      functionName: "providers",
      args: [marketId, loanToken],
    }),
    publicClient.readContract({
      address: contracts.moolah,
      abi: MOOLAH_ABI,
      functionName: "providers",
      args: [marketId, collateralToken],
    }),
  ]);

  // Get Smart Provider data
  const [tokenA, tokenB, stablePool, LPToken, stablePoolTool] =
    await Promise.all([
      publicClient.readContract({
        address: collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "token",
        args: [0n],
      }),
      publicClient.readContract({
        address: collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "token",
        args: [1n],
      }),
      publicClient.readContract({
        address: collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "dex",
        args: [],
      }),
      publicClient.readContract({
        address: collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "dexLP",
        args: [],
      }),
      publicClient.readContract({
        address: collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "dexInfo",
        args: [],
      }),
    ]);

  const tokenAIsNative = tokenA === NATIVE_ADDRESS;
  const tokenBIsNative = tokenB === NATIVE_ADDRESS;
  const loanIsNative = loanProvider === contracts.nativeProvider;
  const nativeCurrency = getNativeCurrencySymbol(network);
  const nativeInfo: TokenInfo = {
    symbol: nativeCurrency,
    decimals: 18,
    address: NATIVE_ADDRESS,
  };

  // Get token info and pool data
  const getTokenInfo = async (address: Address): Promise<TokenInfo> => {
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({
        address,
        abi: ERC20_ABI,
        functionName: "symbol",
        args: [],
      }),
      publicClient.readContract({
        address,
        abi: ERC20_ABI,
        functionName: "decimals",
        args: [],
      }),
    ]);
    return { symbol, decimals, address };
  };

  const [
    tokenAInfo,
    tokenBInfo,
    lpInfo,
    loanInfo,
    _amplifier,
    balanceA,
    balanceB,
    _poolFee,
    totalSupply,
  ] = await Promise.all([
    tokenAIsNative ? nativeInfo : getTokenInfo(tokenA),
    tokenBIsNative ? nativeInfo : getTokenInfo(tokenB),
    getTokenInfo(LPToken),
    loanIsNative ? nativeInfo : getTokenInfo(loanToken),
    publicClient.readContract({
      address: stablePool,
      abi: STABLE_SWAP_POOL_ABI,
      functionName: "A",
      args: [],
    }),
    publicClient.readContract({
      address: stablePool,
      abi: STABLE_SWAP_POOL_ABI,
      functionName: "balances",
      args: [0n],
    }),
    publicClient.readContract({
      address: stablePool,
      abi: STABLE_SWAP_POOL_ABI,
      functionName: "balances",
      args: [1n],
    }),
    publicClient.readContract({
      address: stablePool,
      abi: STABLE_SWAP_POOL_ABI,
      functionName: "fee",
      args: [],
    }),
    publicClient.readContract({
      address: LPToken,
      abi: STABLE_SWAP_LP_ABI,
      functionName: "totalSupply",
      args: [],
    }),
  ]);

  const lpBalances: [Decimal, Decimal] = [
    new Decimal(balanceA, tokenAInfo.decimals),
    new Decimal(balanceB, tokenBInfo.decimals),
  ];
  const totalLp = new Decimal(totalSupply);
  const rateCap = _rateCap === 0n ? DEFAULT_RATE_CAP : _rateCap;
  const rateFloor = _rateFloor;

  // Calculate rates
  const remaining = totalSupplyAssets - totalBorrowAssets;
  const utilRate =
    totalSupplyAssets > 0n
      ? new Decimal((totalBorrowAssets * WEI_VALUE) / totalSupplyAssets)
      : Decimal.ZERO;

  let rateAtTarget = 0n;
  let latestBorrowRate = 0n;
  const rateView = _rateView;
  if (!isFixedRateIrm) {
    ({ latestBorrowRate, rateAtTarget } = getBorrowRateInfo({
      utilization: utilRate.roundDown(18).numerator,
      rateAtTarget: _rateAtTarget,
      lastUpdate,
      rateCap,
      rateFloor,
    }));
  } else {
    latestBorrowRate = getAnnualBorrowRate(rateView);
  }

  const priceRate = new Decimal(_priceRate, 36)
    .mul(10n ** BigInt(lpInfo.decimals))
    .div(10n ** BigInt(loanInfo.decimals))
    .roundDown(18);

  return {
    LLTV,
    lastUpdate,
    params: paramsObj,
    totalSupply: new Decimal(totalSupplyAssets, loanInfo.decimals),
    totalBorrow: new Decimal(totalBorrowAssets, loanInfo.decimals),
    totalSupplyAssets,
    totalBorrowShares,
    totalBorrowAssets,
    remaining: new Decimal(remaining, loanInfo.decimals),
    minLoan: new Decimal(minLoan, loanInfo.decimals),
    feeRate: new Decimal(fee),
    utilRate,
    borrowRate: new Decimal(latestBorrowRate),
    priceRate,
    rateCap,
    rateFloor,
    rateAtTarget,
    rateView,
    loanProvider,
    collateralProvider,
    loanIsNative,
    tokenAIsNative,
    tokenBIsNative,
    collateralIsNative: false,
    lpInfo,
    loanInfo,
    tokenAInfo,
    tokenBInfo,
    balances: lpBalances,
    totalLp,
    proportion: lpBalances[1].gt(Decimal.ZERO)
      ? lpBalances[0].div(lpBalances[1])
      : Decimal.ZERO,
    stablePool,
    LPToken,
    stablePoolTool,
    amplifier: _amplifier,
    poolFee: _poolFee,
  };
}
