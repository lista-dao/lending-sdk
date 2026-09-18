import type { Address, PublicClient } from "viem";
import { zeroAddress } from "viem";
import type { MarketExtraInfo, NetworkName } from "@lista-dao/moolah-sdk-core";
import {
  Decimal,
  getNativeCurrencySymbol,
  getAnnualBorrowRate,
  getBorrowRateInfo,
  DEFAULT_RATE_CAP,
} from "@lista-dao/moolah-sdk-core";
import {
  getERC20Info,
  getMarketParams,
  getMarketState,
  getPrice,
  getMinLoan,
  getProvider,
  getBorrowRateView,
} from "@lista-dao/moolah-sdk-core";
import { classifyIrm } from "../shared/irm.js";

/**
 * Get market extra information from chain
 */
export async function getMarketExtraInfo(
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
): Promise<MarketExtraInfo> {
  const [params, marketState] = await Promise.all([
    getMarketParams(publicClient, contracts.moolah, marketId),
    getMarketState(publicClient, contracts.moolah, marketId),
  ]);

  const LLTV = new Decimal(params.lltv);
  const {
    totalSupplyAssets,
    totalBorrowAssets,
    totalBorrowShares,
    lastUpdate,
    fee,
  } = marketState;

  const paramsObj = params;
  const marketObj = marketState;

  // What kind of IRM is this? Ask it, do not look it up — see classifyIrm.
  // Nothing else depends on the answer, so it goes out with everything else
  // rather than costing a second round trip on the hottest read in the SDK.
  const [
    irmReading,
    [
      _rateView,
      _priceRate,
      loanInfo,
      collateralInfo,
      minLoan,
      loanProvider,
      collateralProvider,
    ],
  ] = await Promise.all([
    classifyIrm(publicClient, params.irm, marketId, contracts.fixedRateIrm),
    Promise.all([
      getBorrowRateView(publicClient, params.irm, paramsObj, marketObj),
      getPrice(publicClient, contracts.moolah, paramsObj),
      getERC20Info(publicClient, params.loanToken),
      getERC20Info(publicClient, params.collateralToken),
      getMinLoan(publicClient, contracts.moolah, paramsObj),
      getProvider(publicClient, contracts.moolah, marketId, params.loanToken),
      getProvider(
        publicClient,
        contracts.moolah,
        marketId,
        params.collateralToken,
      ),
    ]),
  ]);

  const isFixedRateIrm = irmReading.isFixedRate;
  const _rateAtTarget = irmReading.rateAtTarget;

  // A fixed-rate market has no adaptive curve, so it has no cap or floor to
  // report — null, not a default that would misrepresent it. For an adaptive
  // market a zero cap means "unset, use the protocol default", while a null cap
  // means the IRM has no such view at all and the rate is genuinely uncapped.
  // Collapsing those two was a regression: it clamped an uncapped market to the
  // ~30% default and reported a cap that does not exist.
  const rateFloor = isFixedRateIrm ? null : irmReading.rateFloor;
  const rateCap = isFixedRateIrm
    ? null
    : irmReading.rateCap === 0n
      ? DEFAULT_RATE_CAP
      : irmReading.rateCap;

  const remaining = totalSupplyAssets - totalBorrowAssets;
  const utilRate =
    totalSupplyAssets > 0n
      ? new Decimal(totalBorrowAssets, loanInfo.decimals).div(
          new Decimal(totalSupplyAssets, loanInfo.decimals),
        )
      : Decimal.ZERO;

  let rateAtTarget = 0n;
  let latestBorrowRate = 0n;
  const rateView = _rateView;
  if (!isFixedRateIrm) {
    const result = getBorrowRateInfo({
      utilization: utilRate.roundDown(18).numerator,
      rateAtTarget: _rateAtTarget,
      lastUpdate,
      rateCap,
      rateFloor,
    });
    latestBorrowRate = result.latestBorrowRate;
    rateAtTarget = result.rateAtTarget;
  } else {
    latestBorrowRate = getAnnualBorrowRate(_rateView);
  }

  const _computeBorrowRate = (utilRate: bigint) => {
    if (isFixedRateIrm) {
      return new Decimal(getAnnualBorrowRate(rateView));
    }

    const { latestBorrowRate } = getBorrowRateInfo({
      utilization: utilRate,
      rateAtTarget,
      lastUpdate,
      rateCap,
      rateFloor,
    });

    return new Decimal(latestBorrowRate);
  };

  const priceRate = new Decimal(_priceRate, 36)
    .mul(10n ** BigInt(collateralInfo.decimals))
    .div(10n ** BigInt(loanInfo.decimals))
    .roundDown(18);

  const nativeSymbol = getNativeCurrencySymbol(network);

  const loanIsNative =
    loanProvider !== zeroAddress &&
    (loanProvider === contracts.nativeProvider ||
      params.loanToken === contracts.wbnb);
  const collateralIsNative =
    collateralProvider !== zeroAddress &&
    collateralProvider === contracts.nativeProvider;

  return {
    lastUpdate,
    LLTV,
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
    collateralIsNative,
    isFixedRate: isFixedRateIrm,
    loanInfo: {
      ...loanInfo,
      symbol: loanIsNative ? nativeSymbol : loanInfo.symbol,
    },
    collateralInfo: {
      ...collateralInfo,
      symbol: collateralIsNative ? nativeSymbol : collateralInfo.symbol,
    },
    _computeBorrowRate,
  };
}
