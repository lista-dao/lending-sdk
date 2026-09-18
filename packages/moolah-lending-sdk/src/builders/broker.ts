import type { Address, PublicClient } from "viem";
import {
  LENDING_BROKER_ABI,
  MOOLAH_ABI,
  getContractAddress,
  type NetworkName,
} from "@lista-dao/moolah-sdk-core";
import type {
  ChainId,
  StepParam,
  BuildBrokerBorrowParams,
  BuildBrokerRepayAllParams,
  BuildBrokerRefinanceMaturedParams,
  BuildConvertDynamicToFixedParams,
} from "../types.js";
import { buildCallParams, finalizeSteps, type DraftStep } from "../utils.js";
import { isContractLevelFailure } from "../rpcErrors.js";
import {
  buildApproveSteps,
  buildClearAllowanceStep,
  priorAllowanceOf,
} from "./approve.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Shape check only. Enough for a call target, not enough for an approval
 * spender — see {@link assertBrokerIsRegistered}.
 */
function assertBrokerAddress(brokerAddress: Address): void {
  if (
    !brokerAddress ||
    brokerAddress.toLowerCase() === ZERO_ADDRESS ||
    !/^0x[0-9a-fA-F]{40}$/.test(brokerAddress)
  ) {
    throw new Error(
      `Invalid broker address: ${brokerAddress}. The broker comes from market ` +
        `metadata, not the address book — verify it against ` +
        `Moolah.brokers(marketId) before approving tokens to it.`,
    );
  }
}

/**
 * Prove a broker address is the broker Moolah knows about.
 *
 * Every other approval spender in this SDK is resolved on-chain: the market and
 * vault providers come from `Moolah.providers` and `vault.provider`, the
 * liquidator from the address book. The broker is the one exception — it
 * arrives in `MarketInfo.broker`, over HTTPS, from a REST API whose base URL a
 * caller can set. A format check accepts any well-formed address, which is
 * every address an attacker would supply.
 *
 * So close the loop on-chain instead of asking the caller to. A broker names
 * the market it serves (`MARKET_ID`) and the Moolah it belongs to (`MOOLAH`);
 * asking Moolah for that market's broker must lead back to the same address. An
 * impostor can claim any `MARKET_ID` it likes, but `Moolah.brokers(id)` then
 * returns the real broker and the mismatch is caught. No caller input needed,
 * one extra read on a path that is already async.
 */
async function assertBrokerIsRegistered(
  brokerAddress: Address,
  publicClient: PublicClient,
  network: NetworkName,
  expectedMarketId?: `0x${string}`,
): Promise<void> {
  assertBrokerAddress(brokerAddress);
  const moolah = getContractAddress(network, "moolah");

  const [claimedMarketId, claimedMoolah] = await Promise.all([
    publicClient.readContract({
      address: brokerAddress,
      abi: LENDING_BROKER_ABI,
      functionName: "MARKET_ID",
    }) as Promise<`0x${string}`>,
    publicClient.readContract({
      address: brokerAddress,
      abi: LENDING_BROKER_ABI,
      functionName: "MOOLAH",
    }) as Promise<Address>,
  ]).catch((error: unknown) => {
    // Only a contract-level failure is evidence about the contract. A 429 or a
    // timeout says nothing about whether this address is a broker, and
    // reporting it as "not a LendingBroker" is the same reasoning error the
    // IRM classification had.
    if (!isContractLevelFailure(error)) throw error;
    throw new Error(
      `Broker ${brokerAddress} does not answer MARKET_ID()/MOOLAH(), so it is ` +
        `not a LendingBroker. Refusing to approve tokens to it.`,
    );
  });

  if (claimedMoolah.toLowerCase() !== moolah.toLowerCase()) {
    throw new Error(
      `Broker ${brokerAddress} belongs to Moolah ${claimedMoolah}, not ` +
        `${moolah} on ${network}. Refusing to approve tokens to it.`,
    );
  }

  const registered = (await publicClient.readContract({
    address: moolah,
    abi: MOOLAH_ABI,
    functionName: "brokers",
    args: [claimedMarketId],
  })) as Address;

  if (registered.toLowerCase() !== brokerAddress.toLowerCase()) {
    throw new Error(
      `Broker mismatch for market ${claimedMarketId}: metadata says ` +
        `${brokerAddress}, Moolah.brokers() says ${registered}. Refusing to ` +
        `approve tokens to an unregistered broker.`,
    );
  }

  // Registered by *some* market is not the same as registered by *this* one.
  // Without this, a substituted-but-genuine broker for another market passes —
  // the spender is a real protocol contract, so nothing is stolen, but the
  // repayment goes somewhere the caller did not intend. Supply `marketId` and
  // the substitution is caught too.
  if (
    expectedMarketId &&
    claimedMarketId.toLowerCase() !== expectedMarketId.toLowerCase()
  ) {
    throw new Error(
      `Broker ${brokerAddress} serves market ${claimedMarketId}, not ` +
        `${expectedMarketId}. Refusing to repay through a broker for a ` +
        `different market.`,
    );
  }
}

export async function buildBrokerBorrowSteps(
  params: BuildBrokerBorrowParams,
  publicClient: PublicClient,
  network: NetworkName,
): Promise<StepParam[]> {
  const { amount, termId, onBehalf, receiver } = params;
  if (amount <= 0n) {
    throw new Error("buildBrokerBorrowSteps: amount must be greater than zero");
  }
  if ((onBehalf === undefined) !== (receiver === undefined)) {
    throw new Error(
      "buildBrokerBorrowSteps: onBehalf and receiver must be given together",
    );
  }
  if (onBehalf !== undefined && termId === undefined) {
    throw new Error(
      "buildBrokerBorrowSteps: termId is required when borrowing on behalf of another account",
    );
  }

  // Verified, not merely shape-checked, and after the argument checks so a
  // malformed call still fails on its arguments rather than on the network.
  // This path emits no approval, so an impostor cannot pull tokens — but the
  // address still comes from market metadata, i.e. the REST API, and it is
  // what receives a signed transaction. Checking it on the repay path and not
  // here was a distinction with nothing behind it.
  await assertBrokerIsRegistered(
    params.brokerAddress,
    publicClient,
    network,
    params.marketId,
  );

  // Three overloads share the name `borrow`; the argument list selects one.
  const args =
    onBehalf !== undefined
      ? [amount, termId, onBehalf, receiver]
      : termId !== undefined
        ? [amount, termId]
        : [amount];

  return finalizeSteps([
    {
      step: "brokerBorrow",
      params: buildCallParams({
        to: params.brokerAddress,
        abi: LENDING_BROKER_ABI,
        functionName: "borrow",
        args,
        chainId: params.chainId,
      }),
    },
  ]);
}

/**
 * Move part of the flexible leg into a fixed term, within one broker.
 *
 * Distinct from a cross-market migration: this stays inside the broker, so it
 * needs no authorization and no approval, and is a single transaction.
 *
 * `amount` is **principal**, not outstanding. `dynamicOutstanding` from
 * `getBrokerUserPositions` is principal plus accrued interest; passing it asks
 * to convert more than the leg holds and reverts — intermittently, depending on
 * how far the contract's own accrual has caught up with the SDK's figure, which
 * is the worst way for it to fail. Use `dynamicPosition.principal`.
 *
 * A conversion leaves two legs, and the market rejects any position below its
 * minimum loan — so `amount` must clear `minLoan`, and what remains on the
 * flexible leg must be either zero or also above it. Converting "half" of a
 * position sized near the minimum reverts with
 * `broker/positions-below-min-loan`. Read `minLoan` from
 * `getMarketExtraInfo` and size accordingly, or convert the whole leg.
 */
export async function buildConvertDynamicToFixedSteps(
  params: BuildConvertDynamicToFixedParams,
  publicClient: PublicClient,
  network: NetworkName,
): Promise<StepParam[]> {
  if (params.amount <= 0n) {
    throw new Error(
      "buildConvertDynamicToFixedSteps: amount must be greater than zero",
    );
  }
  await assertBrokerIsRegistered(
    params.brokerAddress,
    publicClient,
    network,
    params.marketId,
  );
  return finalizeSteps([
    {
      step: "convertDynamicToFixed",
      params: buildCallParams({
        to: params.brokerAddress,
        abi: LENDING_BROKER_ABI,
        functionName: "convertDynamicToFixed",
        args: [params.amount, params.termId],
        chainId: params.chainId,
      }),
      meta: { amount: params.amount },
    },
  ]);
}

/**
 * Repay everything owed to a broker — flexible leg and every fixed position.
 *
 * The contract settles against debt at execution time, so the amount here only
 * sizes the approval (or the native value). Debt keeps accruing between
 * building and sending; pass headroom, and the contract refunds the excess.
 */
export async function buildBrokerRepayAllSteps(
  params: BuildBrokerRepayAllParams,
  publicClient: PublicClient,
  network: NetworkName,
): Promise<StepParam[]> {
  if (params.maxRepayAmount <= 0n) {
    throw new Error(
      "buildBrokerRepayAllSteps: maxRepayAmount must be greater than zero",
    );
  }
  // `loanToken` and `walletAddress` are optional so a native-loan repay does
  // not have to name a token it does not approve — but for anything else,
  // omitting either used to skip the approval branch silently rather than
  // refuse. The result was one clean-looking step with no approval and no
  // value: a guaranteed on-chain revert with nothing at build time to say why.
  if (
    !params.isNativeLoanToken &&
    (!params.loanToken || !params.walletAddress)
  ) {
    throw new Error(
      `buildBrokerRepayAllSteps: ${!params.loanToken ? "loanToken" : "walletAddress"} ` +
        "is required unless isNativeLoanToken is true.",
    );
  }

  // Argument checks before the network call, like every sibling here — a
  // malformed call fails on its arguments rather than on three RPC reads it
  // did not need to make.
  await assertBrokerIsRegistered(
    params.brokerAddress,
    publicClient,
    network,
    params.marketId,
  );

  const steps: DraftStep[] = [];
  let approvedHere = false;
  let priorAllowance = 0n;

  if (!params.isNativeLoanToken && params.loanToken && params.walletAddress) {
    const approveSteps = await buildApproveSteps(
      {
        chainId: params.chainId,
        owner: params.walletAddress,
        token: params.loanToken,
        spender: params.brokerAddress,
        amount: params.maxRepayAmount,
      },
      publicClient,
      network,
    );
    approvedHere = approveSteps.length > 0;
    priorAllowance = priorAllowanceOf(approveSteps);
    steps.push(...approveSteps);
  }

  steps.push({
    step: "brokerRepayAll",
    params: buildCallParams({
      to: params.brokerAddress,
      abi: LENDING_BROKER_ABI,
      functionName: "repayAll",
      args: [params.onBehalf],
      value: params.isNativeLoanToken ? params.maxRepayAmount : undefined,
      chainId: params.chainId,
    }),
    meta: { amount: params.maxRepayAmount },
  });

  // The approval was sized for a debt that keeps growing, so it is larger than
  // what the broker actually takes. Give the remainder back — only when this
  // sequence created it, and put it back where it was rather than at zero —
  // a caller who already had a standing allowance keeps it.
  if (approvedHere && !params.keepAllowance && params.loanToken) {
    steps.push(
      ...buildClearAllowanceStep({
        chainId: params.chainId,
        token: params.loanToken,
        spender: params.brokerAddress,
        restoreTo: priorAllowance,
        network: network,
      }),
    );
  }

  return finalizeSteps(steps);
}

/**
 * Settle matured fixed-term positions.
 *
 * A matured term still owes — it does not clear itself — and this is what
 * closes it without a repayment. Where the balance lands is the broker's
 * decision, not this call's, so read the position back rather than assuming a
 * new term id appeared. What is guaranteed is that the matured leg is gone and
 * the debt is not.
 *
 * Without it a matured position has to be repaid and re-borrowed, so it is part
 * of the fixed-term lifecycle rather than an optimisation.
 */
export async function buildBrokerRefinanceMaturedSteps(
  params: BuildBrokerRefinanceMaturedParams,
  publicClient: PublicClient,
  network: NetworkName,
): Promise<StepParam[]> {
  if (params.positionIds.length === 0) {
    throw new Error(
      "buildBrokerRefinanceMaturedSteps: positionIds must not be empty",
    );
  }
  await assertBrokerIsRegistered(
    params.brokerAddress,
    publicClient,
    network,
    params.marketId,
  );
  return finalizeSteps([
    {
      step: "brokerRefinanceMatured",
      params: buildCallParams({
        to: params.brokerAddress,
        abi: LENDING_BROKER_ABI,
        functionName: "refinanceMaturedFixedPositions",
        args: [params.user, params.positionIds],
        chainId: params.chainId,
      }),
    },
  ]);
}

/**
 * Repay one fixed position, or the flexible leg.
 *
 * `posId` selects a fixed position and is the position's **own id**, taken from
 * `userFixedPositions()[n].posId` — not its index in that array. The ids are not
 * dense: a partly used account can hold ids 5, 7, 8 at indices 0, 1, 2, and
 * passing the index reverts with `PositionNotFound()`. Omit `posId` to repay the
 * flexible leg, which has no id.
 *
 * Pass `amount` with headroom rather than an exact figure. Interest accrues
 * between quoting and inclusion, so an exact quote repays slightly less than the
 * full principal and leaves the position under the market minimum, which reverts
 * with `remain borrow too low`. The broker transfers only what is actually owed
 * — verified on chain: a 40.0 amount against a 20.000000061 position moved
 * 20.000002877 — so headroom is free. `previewRepayFixedLoanPosition` gives the
 * size; double it to send.
 */
export async function buildBrokerRepaySteps(
  params: {
    chainId: ChainId;
    brokerAddress: Address;
    amount: bigint;
    posId?: bigint;
    onBehalf?: Address;
    loanToken?: Address;
    walletAddress?: Address;
    /** Keep the leftover allowance instead of returning it to zero. */
    keepAllowance?: boolean;
    /** The market being repaid. Supply it and the broker is checked against it. */
    marketId?: `0x${string}`;
  },
  publicClient: PublicClient,
  network: NetworkName,
): Promise<StepParam[]> {
  await assertBrokerIsRegistered(
    params.brokerAddress,
    publicClient,
    network,
    params.marketId,
  );
  // Every sibling here (`buildBrokerBorrowSteps`, `buildConvertDynamicToFixedSteps`,
  // `buildBrokerRepayAllSteps`) rejects a non-positive amount; this one did
  // not. Zero skips `buildApproveSteps` (which itself no-ops below zero) and
  // still emits a clean-looking `brokerRepay` step with no approval —
  // exactly the input this builder's own headroom guidance expects a caller
  // to send, undersized.
  if (params.amount <= 0n) {
    throw new Error("buildBrokerRepaySteps: amount must be greater than zero");
  }

  const steps: DraftStep[] = [];
  let approvedHere = false;
  let priorAllowance = 0n;

  if (params.loanToken && params.walletAddress) {
    const approveSteps = await buildApproveSteps(
      {
        chainId: params.chainId,
        owner: params.walletAddress,
        token: params.loanToken,
        spender: params.brokerAddress,
        amount: params.amount,
      },
      publicClient,
      network,
    );
    approvedHere = approveSteps.length > 0;
    priorAllowance = priorAllowanceOf(approveSteps);
    steps.push(...approveSteps);
  }

  steps.push({
    step: "brokerRepay",
    params: buildCallParams({
      to: params.brokerAddress,
      abi: LENDING_BROKER_ABI,
      functionName: "repay",
      args:
        params.posId !== undefined
          ? [
              params.amount,
              params.posId,
              params.onBehalf ?? params.walletAddress,
            ]
          : [params.amount, params.onBehalf ?? params.walletAddress],
      chainId: params.chainId,
    }),
  });

  // Repay amounts are sized with headroom on purpose — see above — so the
  // approval outlives the repayment unless it is put back where it was found.
  if (approvedHere && !params.keepAllowance && params.loanToken) {
    steps.push(
      ...buildClearAllowanceStep({
        chainId: params.chainId,
        token: params.loanToken,
        spender: params.brokerAddress,
        restoreTo: priorAllowance,
        network: network,
      }),
    );
  }

  return finalizeSteps(steps);
}
