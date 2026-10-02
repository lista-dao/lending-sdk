import { describe, it, expect } from "vitest";
import { calculateFixedLoanRepayment } from "../calculations/loan.js";
import type { FixedLoanPosition } from "../types/loan.js";

/**
 * `calculateFixedLoanRepayment` against a transcription of the Solidity.
 *
 * The unit tests beside this one pin individual behaviours — the accrual
 * window, the maturity cap — which is what catches a regression but not what
 * catches a formula that is subtly the wrong shape. Both defects this file was
 * written for were of the second kind: the penalty inverted the contract
 * instead of transcribing it (1.33x the real figure at 30% APR), and every
 * division floored where the contract ceils (a matured 1000-token position
 * quoted 32 wei short, which leaves dust principal and reverts
 * `broker/fixed-below-min-loan`). Neither shows up as a wrong-looking number.
 *
 * So this sweeps the parameter space and asserts two things per case: that the
 * interest and penalty equal the contract's, and — the property that actually
 * matters to a caller — that sending `totalRepay` clears the position exactly,
 * with nothing left on the principal and nothing refunded.
 *
 * Transcribed from `lista-dao/moolah` at `src/broker/libraries/BrokerMath.sol`:
 * `_aprPerSecond`, `getAccruedInterestForFixedPosition`,
 * `getPenaltyForFixedPosition` and `previewRepayFixedLoanPosition`.
 */

const RATE_SCALE = 10n ** 27n;
const ONE_YEAR = 31536000n;

/** `Math.mulDiv(..., Math.Rounding.Ceil)`, which the contract uses throughout. */
const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a + b - 1n) / b);

const aprPerSecond = (apr: bigint) =>
  apr <= RATE_SCALE ? 0n : ceilDiv(apr - RATE_SCALE, ONE_YEAR);

const accruedInterest = (p: FixedLoanPosition, now: bigint) => {
  const cap = now > p.end ? p.end : now;
  const start = p.lastRepaidTime > p.end ? p.end : p.lastRepaidTime;
  const elapsed = cap - start;
  if (p.principal === 0n || elapsed === 0n) return 0n;
  return ceilDiv(
    (p.principal - p.principalRepaid) * (aprPerSecond(p.apr) * elapsed),
    RATE_SCALE,
  );
};

const penaltyFor = (p: FixedLoanPosition, repayAmt: bigint, now: bigint) => {
  if (now > p.end) return 0n;
  const timeLeft = p.end - now;
  return ceilDiv(
    ceilDiv(repayAmt * aprPerSecond(p.apr), RATE_SCALE) * timeLeft,
    2n,
  );
};

/** What `previewRepayFixedLoanPosition` does with an amount the caller sends. */
const previewRepay = (p: FixedLoanPosition, amount: bigint, now: bigint) => {
  const remaining = p.principal - p.principalRepaid;
  const owedInterest = accruedInterest(p, now) - p.interestRepaid;
  const interestRepaid = amount < owedInterest ? amount : owedInterest;
  let budget = amount - interestRepaid;
  let penalty = 0n;
  let principalRepaid = 0n;
  if (budget > 0n) {
    penalty = penaltyFor(p, budget > remaining ? remaining : budget, now);
    budget -= penalty;
    if (budget > 0n) principalRepaid = budget > remaining ? remaining : budget;
  }
  return {
    principalRepaid,
    remainingAfter: remaining - principalRepaid,
    unspent: amount - interestRepaid - penalty - principalRepaid,
  };
};

const START = 1704067200n;
const position = (
  aprPercent: number,
  years: number,
  principalRepaid: bigint,
  interestRepaid: bigint,
  lastRepaidAt: number,
): FixedLoanPosition => {
  const term = BigInt(Math.round(years * Number(ONE_YEAR)));
  return {
    posId: 1n,
    principal: 1000n * 10n ** 18n,
    principalRepaid,
    interestRepaid,
    lastRepaidTime:
      START + (term * BigInt(Math.round(lastRepaidAt * 100))) / 100n,
    apr: RATE_SCALE + (RATE_SCALE * BigInt(aprPercent)) / 100n,
    start: START,
    end: START + term,
  };
};

const APRS = [0, 5, 10, 30, 80];
const TERMS = [0.25, 1, 2];
/** Fractions of the term to evaluate at, including past maturity. */
const WHENS = [0, 0.01, 0.5, 0.999, 1, 1.5];
const HISTORIES: Array<[bigint, bigint, number]> = [
  [0n, 0n, 0], // untouched
  [300n * 10n ** 18n, 0n, 0.2], // principal repaid: stamp moved, interest zeroed
  [0n, 10n ** 18n, 0], // interest-only repayment: stamp unmoved
  [999n * 10n ** 18n, 0n, 0.5], // all but a sliver of principal repaid
];

describe("calculateFixedLoanRepayment matches BrokerMath", () => {
  const cases: Array<[string, FixedLoanPosition, bigint]> = [];
  for (const apr of APRS)
    for (const years of TERMS)
      for (const when of WHENS)
        for (const [
          principalRepaid,
          interestRepaid,
          lastRepaidAt,
        ] of HISTORIES) {
          const p = position(
            apr,
            years,
            principalRepaid,
            interestRepaid,
            lastRepaidAt,
          );
          const now =
            START + ((p.end - START) * BigInt(Math.round(when * 1000))) / 1000n;
          // The broker can never record more interest repaid than has accrued,
          // so those combinations are not states to hold the SDK to.
          if (accruedInterest(p, now) < p.interestRepaid) continue;
          cases.push([
            `${apr}% over ${years}y at ${when * 100}% of term, repaid ${principalRepaid}/${interestRepaid}`,
            p,
            now,
          ]);
        }

  it("covers the parameter space", () => {
    expect(cases.length).toBeGreaterThan(250);
  });

  it.each(cases)("%s", (_label, p, now) => {
    const result = calculateFixedLoanRepayment(p, now);
    const remaining = p.principal - p.principalRepaid;

    expect(result.principal).toBe(remaining);
    expect(result.interest).toBe(accruedInterest(p, now) - p.interestRepaid);
    expect(result.penalty).toBe(
      now < p.end ? penaltyFor(p, remaining, now) : 0n,
    );

    // The property a caller depends on: send this and the position is closed,
    // with nothing stranded on the principal and nothing handed back.
    const total = result.principal + result.interest + result.penalty;
    const settled = previewRepay(p, total, now);
    expect(settled.remainingAfter).toBe(0n);
    expect(settled.unspent).toBe(0n);
  });
});
