import type { Address, PublicClient } from 'viem';
import { zeroAddress } from 'viem';
import type { MarketExtraInfo, NetworkName } from '@lista-dao/moolah-sdk-core';
import {
    Decimal,
    getNativeCurrencySymbol,
    getAnnualBorrowRate,
    getBorrowRateInfo,
    DEFAULT_RATE_CAP,
} from '@lista-dao/moolah-sdk-core';
import {
    getERC20Info,
    getMarketParams,
    getMarketState,
    getPrice,
    getMinLoan,
    getProvider,
    getBorrowRateView,
    getRateCap,
    getRateFloor,
    getRateAtTarget,
} from '@lista-dao/moolah-sdk-core';

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

    // Check if IRM is fixed rate
    const fixedRateIrmAddress = contracts.fixedRateIrm;
    const isFixedRateIrm =
        fixedRateIrmAddress !== zeroAddress &&
        params.irm === fixedRateIrmAddress;

    const [
        _rateView,
        _rateCap,
        rateFloor,
        _priceRate,
        _rateAtTarget,
        loanInfo,
        collateralInfo,
        minLoan,
        loanProvider,
        collateralProvider,
    ] = await Promise.all([
        getBorrowRateView(
            publicClient,
            params.irm,
            paramsObj,
            marketObj,
        ),
        isFixedRateIrm
            ? Promise.resolve(null)
            : getRateCap(publicClient, params.irm, marketId),
        isFixedRateIrm
            ? null
            : getRateFloor(publicClient, params.irm, marketId).catch(() => null),
        getPrice(publicClient, contracts.moolah, paramsObj),
        isFixedRateIrm ? 0n : getRateAtTarget(publicClient, params.irm, marketId),
        getERC20Info(publicClient, params.loanToken),
        getERC20Info(publicClient, params.collateralToken),
        getMinLoan(publicClient, contracts.moolah, paramsObj),
        getProvider(
            publicClient,
            contracts.moolah,
            marketId,
            params.loanToken,
        ),
        getProvider(
            publicClient,
            contracts.moolah,
            marketId,
            params.collateralToken,
        ),
    ]);

    const rateCap = _rateCap === 0n ? DEFAULT_RATE_CAP : _rateCap;

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
