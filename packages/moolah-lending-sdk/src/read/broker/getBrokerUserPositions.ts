import type { Address, PublicClient } from "viem";
import {
  Decimal,
  LENDING_BROKER_ABI,
  BROKER_RATE_CALCULATOR_ABI,
  calculateDynamicLoanRepayment,
  calculateFixedLoanRepayment,
  type BrokerUserPositionsData,
  type FixedLoanPosition,
  type DynamicLoanPosition,
  type RawFixedTerm,
} from "@lista-dao/moolah-sdk-core";

const SECONDS_PER_WEEK = 604800n;

/**
 * Normalize APR rate from contract format
 * Contract stores APR as (1 + rate) * 1e27, we convert to rate * 1e27
 */
function normalizeAprRate(apr: bigint): bigint {
  const ONE_E27 = 10n ** 27n;
  return apr > ONE_E27 ? apr - ONE_E27 : apr;
}

/**
 * Get broker user positions data
 */
export async function getBrokerUserPositions(
  publicClient: PublicClient,
  brokerAddress: Address,
  rateCalculatorAddress: Address,
  userAddress: Address,
  loanDecimals: number = 18,
): Promise<BrokerUserPositionsData> {
  // Fetch data from contracts
  const [fixedPositions, terms, dynamicPosition, dynamicRate] =
    await Promise.all([
      publicClient.readContract({
        address: brokerAddress,
        abi: LENDING_BROKER_ABI,
        functionName: "userFixedPositions",
        args: [userAddress],
      }) as Promise<readonly FixedLoanPosition[]>,
      publicClient.readContract({
        address: brokerAddress,
        abi: LENDING_BROKER_ABI,
        functionName: "getFixedTerms",
        args: [],
      }) as Promise<readonly RawFixedTerm[]>,
      publicClient.readContract({
        address: brokerAddress,
        abi: LENDING_BROKER_ABI,
        functionName: "userDynamicPosition",
        args: [userAddress],
      }) as Promise<DynamicLoanPosition>,
      publicClient.readContract({
        address: rateCalculatorAddress,
        abi: BROKER_RATE_CALCULATOR_ABI,
        functionName: "getRate",
        args: [brokerAddress],
      }) as Promise<bigint>,
    ]);

  // Build term rate map
  const termRateByDuration = new Map<string, Decimal>();
  let currentFlexibleRate = Decimal.ZERO;

  terms.forEach((term) => {
    if (term.duration === SECONDS_PER_WEEK) {
      // Flexible rate = term rate * 100 / 95
      currentFlexibleRate = new Decimal(
        (normalizeAprRate(term.apr) * 100n) / 95n,
        27,
      );
    }
    const normalizedRate = new Decimal(normalizeAprRate(term.apr), 27);
    termRateByDuration.set(term.duration.toString(), normalizedRate);
  });

  // Calculate dynamic position data
  let dynamicOutstanding: Decimal | null = null;

  if (dynamicPosition?.principal && dynamicPosition.principal > 0n) {
    const { totalRepay } = calculateDynamicLoanRepayment(
      {
        principal: dynamicPosition.principal,
        normalizedDebt: dynamicPosition.normalizedDebt,
        rate: dynamicRate,
      },
      loanDecimals,
    );
    dynamicOutstanding = totalRepay.roundDown(loanDecimals);
  }

  // Calculate fixed positions data
  let fixedOutstanding = Decimal.ZERO;
  let totalOutstanding = Decimal.ZERO;
  let weightedSum = Decimal.ZERO;

  // Add dynamic position to totals
  if (dynamicOutstanding && dynamicOutstanding.gt(Decimal.ZERO)) {
    totalOutstanding = totalOutstanding.add(dynamicOutstanding);
    weightedSum = weightedSum.add(
      dynamicOutstanding.mul(currentFlexibleRate ?? Decimal.ZERO),
    );
  }

  // Process fixed positions
  const currentTimestamp = Math.floor(Date.now() / 1000);
  fixedPositions.forEach((position) => {
    const principal = BigInt(position.principal ?? 0n);
    const principalRepaid = BigInt(position.principalRepaid ?? 0n);

    // Skip fully repaid or matured positions
    if (principal <= principalRepaid) {
      return;
    }
    if (Number(position.end ?? 0n) <= currentTimestamp) {
      return;
    }

    const { totalRepay } = calculateFixedLoanRepayment(position);

    fixedOutstanding = fixedOutstanding.add(totalRepay);

    const duration =
      BigInt(position.end ?? 0n) > BigInt(position.start ?? 0n)
        ? BigInt(position.end ?? 0n) - BigInt(position.start ?? 0n)
        : 0n;

    const normalizedFixedRate =
      termRateByDuration.get(duration.toString()) ??
      new Decimal(normalizeAprRate(position.apr), 27);

    totalOutstanding = totalOutstanding.add(totalRepay);
    weightedSum = weightedSum.add(totalRepay.mul(normalizedFixedRate));
  });

  // Calculate weighted borrow rate
  const weightedBorrowRate = totalOutstanding.gt(Decimal.ZERO)
    ? weightedSum.div(totalOutstanding)
    : Decimal.ZERO;

  return {
    fixedPositions,
    dynamicPosition,
    dynamicRate,
    terms,
    dynamicRatePercent: currentFlexibleRate,
    dynamicOutstanding,
    fixedOutstanding,
    totalOutstanding,
    weightedBorrowRate,
    termRateByDuration,
  };
}
