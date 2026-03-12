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

const ONE_E27 = 10n ** 27n;
const SECONDS_PER_WEEK = 604800n;
const RATE_SCALE_18 = 10n ** 18n;
const FLEXIBLE_RATE_NUMERATOR = 100n;
const FLEXIBLE_RATE_DENOMINATOR = 95n;

/**
 * Normalize APR rate from contract format
 * Contract stores APR as (1 + rate) * 1e27, we convert to rate * 1e27
 */
function normalizeAprRate(apr: bigint): bigint {
  return apr > ONE_E27 ? apr - ONE_E27 : apr;
}

/**
 * Convert broker dynamic rate (27 decimals) to WAD (18 decimals)
 * expected by calculateDynamicLoanRepayment.
 */
function normalizeDynamicRateToWad(dynamicRate: bigint): bigint {
  return dynamicRate / RATE_SCALE_18;
}

function buildTermRateData(terms: readonly RawFixedTerm[]) {
  const termRateByDuration = new Map<string, Decimal>();
  let currentFlexibleRate = Decimal.ZERO;

  for (const term of terms) {
    const normalizedRate = normalizeAprRate(term.apr);

    if (term.duration === SECONDS_PER_WEEK) {
      currentFlexibleRate = new Decimal(
        (normalizedRate * FLEXIBLE_RATE_NUMERATOR) / FLEXIBLE_RATE_DENOMINATOR,
        27,
      );
    }

    termRateByDuration.set(
      term.duration.toString(),
      new Decimal(normalizedRate, 27),
    );
  }

  return { termRateByDuration, currentFlexibleRate };
}

function calculateDynamicOutstanding(
  dynamicPosition: DynamicLoanPosition,
  dynamicRate: bigint,
  loanDecimals: number,
): Decimal | null {
  if (dynamicPosition.principal <= 0n) {
    return null;
  }

  const { totalRepay } = calculateDynamicLoanRepayment(
    {
      principal: dynamicPosition.principal,
      normalizedDebt: dynamicPosition.normalizedDebt,
      rate: normalizeDynamicRateToWad(dynamicRate),
    },
    loanDecimals,
  );

  return totalRepay.roundDown(loanDecimals);
}

function getPositionDuration(position: FixedLoanPosition): bigint {
  return position.end > position.start ? position.end - position.start : 0n;
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

  const { termRateByDuration, currentFlexibleRate } = buildTermRateData(terms);
  const dynamicOutstanding = calculateDynamicOutstanding(
    dynamicPosition,
    dynamicRate,
    loanDecimals,
  );

  // Calculate fixed positions data
  let fixedOutstanding = Decimal.ZERO;
  let totalPenalty = Decimal.ZERO;
  let totalOutstanding = Decimal.ZERO;
  let weightedSum = Decimal.ZERO;

  // Add dynamic position to totals
  if (dynamicOutstanding && dynamicOutstanding.gt(Decimal.ZERO)) {
    totalOutstanding = totalOutstanding.add(dynamicOutstanding);
    weightedSum = weightedSum.add(dynamicOutstanding.mul(currentFlexibleRate));
  }

  // Process fixed positions
  const currentTimestamp = Math.floor(Date.now() / 1000);
  for (const position of fixedPositions) {
    // Skip fully repaid or matured positions
    if (position.principal <= position.principalRepaid) {
      continue;
    }
    if (Number(position.end) <= currentTimestamp) {
      continue;
    }

    const {
      principal: remainPrincipal,
      interest,
      penalty,
    } = calculateFixedLoanRepayment(position);
    const totalRepayNoPenalty = new Decimal(
      remainPrincipal + interest,
      loanDecimals,
    );

    fixedOutstanding = fixedOutstanding.add(totalRepayNoPenalty);
    totalPenalty = totalPenalty.add(new Decimal(penalty, loanDecimals));

    const normalizedFixedRate =
      termRateByDuration.get(getPositionDuration(position).toString()) ??
      new Decimal(normalizeAprRate(position.apr), 27);

    totalOutstanding = totalOutstanding.add(totalRepayNoPenalty);
    weightedSum = weightedSum.add(totalRepayNoPenalty.mul(normalizedFixedRate));
  }

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
    totalPenalty,
    totalOutstanding,
    weightedBorrowRate,
    termRateByDuration,
  };
}
