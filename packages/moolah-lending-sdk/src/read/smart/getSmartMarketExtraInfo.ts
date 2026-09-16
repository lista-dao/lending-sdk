import type { Address, PublicClient } from "viem";
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
import { classifyIrm } from "../shared/irm.js";
import { isContractLevelFailure } from "../../rpcErrors.js";

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

  // What kind of IRM is this? Ask it, do not look it up. A live market can
  // point at an IRM in neither address-book slot; address matching alone can
  // send a fixed-rate IRM down the adaptive-curve path and fail the read.
  // Nothing below depends on the answer, so it goes out alongside everything
  // else rather than costing its own round trip.
  const [
    irmReading,
    [_rateView, _priceRate, minLoan, loanProvider, collateralProvider],
  ] = await Promise.all([
    classifyIrm(publicClient, irm, marketId, contracts.fixedRateIrm),
    Promise.all([
      publicClient.readContract({
        address: irm,
        abi: INTEREST_RATE_MODEL_ABI,
        functionName: "borrowRateView",
        args: [paramsObj, marketObj],
      }),
      publicClient.readContract({
        address: contracts.moolah,
        abi: MOOLAH_ABI,
        functionName: "getPrice",
        args: [paramsObj],
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
    ]),
  ]);

  const isFixedRateIrm = irmReading.isFixedRate;
  const _rateAtTarget = irmReading.rateAtTarget;

  // Get Smart Provider data
  //
  // Not every market the API tags with a `smartCollateralConfig` is backed by a
  // stable-swap SmartProvider. The grouped feed can emit zone-6 entries —
  // which the reference frontend documents as junk data and
  // drops on purpose — whose collateral "provider" is a plain asset provider
  // with no `token()`, `dex()` or `dexLP()` at all. Reading one produced a bare
  // "the contract function token reverted", which says nothing about the actual
  // problem: this is not a Smart Lending market. Filter on `zones` containing
  // 3, and if one slips through, say what went wrong.
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
    ]).catch((error: unknown) => {
      // A revert or a missing function says the collateral provider does not
      // implement the interface — that is the zone-6 case this message is
      // for. A timeout, a rate limit, a dropped connection says nothing about
      // the contract at all, and mapping it to "not a Smart Lending market"
      // turned a retryable RPC failure into a wrong, confident answer about
      // the market's kind. Anything that is not contract-level is rethrown
      // as-is so the caller can retry it.
      if (!isContractLevelFailure(error)) throw error;
      throw new Error(
        `getSmartMarketExtraInfo: market ${marketId} is not a Smart Lending ` +
          `market. Its collateral provider ${collateralProvider} does not ` +
          `implement the stable-swap SmartProvider interface (token/dex/dexLP). ` +
          `Smart Lending markets carry zone 3 in the grouped-market feed; ` +
          `zone 6 entries are known bad data and should be filtered out.`,
      );
    });

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
  // Same rule as the plain market path, and now the same answer for the same
  // market: a fixed-rate market has no adaptive cap or floor to report, and a
  // null cap means the IRM has no such view — genuinely uncapped, not capped at
  // the default. Collapsing those clamped an uncapped market to ~30%.
  const rateFloor = isFixedRateIrm ? null : irmReading.rateFloor;
  const rateCap = isFixedRateIrm
    ? null
    : irmReading.rateCap === 0n
      ? DEFAULT_RATE_CAP
      : irmReading.rateCap;

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
    isFixedRate: isFixedRateIrm,
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
