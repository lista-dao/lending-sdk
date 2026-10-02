import type { Address, PublicClient } from "viem";
import { zeroAddress } from "viem";
import {
  getRateAtTarget,
  getRateCap,
  getRateFloor,
} from "@lista-dao/moolah-sdk-core";
import { optionalRead } from "../../rpcErrors.js";

export interface IrmReading {
  /** True when the market's rate is fixed rather than adaptive-curve. */
  isFixedRate: boolean;
  /**
   * How that was decided. `"address"` means the address book named this IRM;
   * `"probe"` means the contract was asked. An integrator debugging a
   * surprising rate wants to know which.
   */
  classifiedBy: "address" | "probe";
  /** Adaptive-curve target rate. Zero when the IRM does not expose one. */
  rateAtTarget: bigint;
  /** Null when the IRM does not expose it. */
  rateCap: bigint | null;
  /** Null when the IRM does not expose it. */
  rateFloor: bigint | null;
}

/**
 * Work out what kind of interest rate model a market uses, by asking it.
 *
 * The address book is a fast path, not the answer. It names one FixedRateIrm
 * per network, and a market can legitimately point somewhere else — an upgrade,
 * a second instance, or an older deployment still serving live markets. An
 * address-only classification can put a fixed-rate IRM on the adaptive-curve
 * path, where `rateAtTarget` reverts and takes the entire market read down.
 *
 * So: match the address if it matches, and otherwise let behaviour decide. An
 * IRM that *reverts* `rateAtTarget` is a fixed-rate IRM, whatever address it
 * lives at — but an IRM that could not be reached is not evidence of anything,
 * and that case is rethrown rather than guessed at.
 */
export async function classifyIrm(
  publicClient: PublicClient,
  irm: Address,
  marketId: Address,
  fixedRateIrmAddress: Address,
): Promise<IrmReading> {
  const knownFixedRate =
    fixedRateIrmAddress !== zeroAddress &&
    irm.toLowerCase() === fixedRateIrmAddress.toLowerCase();

  // Cap and floor are read either way. Skipping them on the fast path lost the
  // real values for any fixed-rate market the address book does name.
  //
  // `optionalRead` on both paths. An earlier version swallowed cap and floor
  // failures on the fast path, reasoning that the classification was already
  // settled — but the classification is not what those reads feed. A null floor
  // is read downstream as *no floor*, so a timeout there reports a borrow rate
  // below the market's actual one, which is exactly the defect that removing
  // `getRateFloor`'s inner catch was meant to fix.
  const [rateCap, rateFloor, rateAtTarget] = await Promise.all([
    optionalRead(getRateCap(publicClient, irm, marketId)),
    optionalRead(getRateFloor(publicClient, irm, marketId)),
    knownFixedRate
      ? Promise.resolve<bigint | null>(null)
      : optionalRead(getRateAtTarget(publicClient, irm, marketId)),
  ]);

  return {
    // No rateAtTarget means no adaptive curve to follow.
    isFixedRate: knownFixedRate || rateAtTarget === null,
    classifiedBy: knownFixedRate ? "address" : "probe",
    rateAtTarget: rateAtTarget ?? 0n,
    rateCap,
    rateFloor,
  };
}
