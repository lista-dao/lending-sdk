import type { Address, PublicClient } from "viem";
import {
  MOOLAH_ABI,
  POSITION_MANAGER_ABI,
  getContractAddress,
  getContractAddressOptional,
  type NetworkName,
  type NetworkContracts,
  type WriteMarketConfig,
} from "@lista-dao/moolah-sdk-core";
import type { ChainId, StepParam } from "../types.js";
import { buildCallParams, finalizeSteps, type DraftStep } from "../utils.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface AuthorizationBuilderDeps {
  publicClient: PublicClient;
  network: NetworkName;
}

function authorizationStep(
  params: { chainId: ChainId; authorized: Address; isAuthorized: boolean },
  network: NetworkName,
): DraftStep {
  return {
    step: params.isAuthorized ? "setAuthorization" : "revokeAuthorization",
    params: buildCallParams({
      to: getContractAddress(network, "moolah"),
      abi: MOOLAH_ABI,
      functionName: "setAuthorization",
      args: [params.authorized, params.isAuthorized],
      chainId: params.chainId,
    }),
    meta: { spender: params.authorized },
  };
}

/**
 * Contracts the SDK will authorize without an explicit override.
 *
 * An authorization is the single highest-value call in this SDK: it hands
 * standing control of every position the signer holds. Defaulting to the
 * address book means a target arriving from a URL, an API field or a deep link
 * cannot be granted by accident.
 */
const AUTHORIZABLE_CONTRACTS: (keyof NetworkContracts)[] = ["positionManager"];

/**
 * Refuse to authorize anything but a contract the address book names.
 *
 * Exported because every path that can produce a grant must apply it — the
 * signature path especially, where there is no undo.
 */
export function assertAuthorizable(
  authorized: Address,
  network: NetworkName,
  allowUnknownTarget: boolean | undefined,
): void {
  if (allowUnknownTarget) return;
  // Unconfigured entries resolve to the zero address, and leaving those in the
  // allowlist would make `authorized: 0x0` pass on any network where a listed
  // contract is not deployed.
  const known = AUTHORIZABLE_CONTRACTS.map((c) =>
    getContractAddressOptional(network, c).toLowerCase(),
  ).filter((a) => a !== ZERO_ADDRESS);
  if (!known.includes(authorized.toLowerCase())) {
    throw new Error(
      `${authorized} is not a known authorizable contract on ${network}. ` +
        `An authorization grants standing control of every position this ` +
        `account holds. Pass allowUnknownTarget: true only if you have ` +
        `verified this address yourself.`,
    );
  }
}

/**
 * Grant another contract permission to act on your Moolah positions.
 *
 * The grant is standing: it persists until revoked, and nothing on-chain
 * expires it. Prefer letting a flow builder emit this for you — it will only
 * do so when the grant is actually missing, and it attaches the matching
 * revoke.
 *
 * Only address-book contracts are accepted unless `allowUnknownTarget` is set.
 */
export function buildSetAuthorizationSteps(
  params: {
    chainId: ChainId;
    authorized: Address;
    allowUnknownTarget?: boolean;
  },
  network: NetworkName,
): StepParam[] {
  assertAuthorizable(params.authorized, network, params.allowUnknownTarget);
  return finalizeSteps([
    authorizationStep({ ...params, isAuthorized: true }, network),
  ]);
}

/**
 * Withdraw a previously granted authorization.
 *
 * This clears `isAuthorized` on-chain. It does **not** consume the signer's
 * `Moolah.nonce`, so it cannot cancel a signed-but-unsubmitted authorization —
 * a relayer holding one can still submit it afterwards and the grant lands.
 * To cancel an outstanding signature, burn its nonce with
 * {@link buildCancelSignedAuthorizationTypedData} instead. That is a race
 * against whoever holds the signature, and it is the only cancellation there
 * is.
 */
export function buildRevokeAuthorizationSteps(
  params: { chainId: ChainId; authorized: Address },
  network: NetworkName,
): StepParam[] {
  return finalizeSteps([
    authorizationStep({ ...params, isAuthorized: false }, network),
  ]);
}

/**
 * Move a variable-rate position into a fixed-term market.
 *
 * Two transactions when the PositionManager is not yet authorized, one when it
 * is. The migration itself is atomic on-chain — it runs inside a flash loan —
 * but the pair is not: the caller owns the wallet, so the authorization can
 * land and the migration then fail.
 *
 * That is the hazard this builder is shaped around. The authorization step
 * carries `reversalSteps` holding its own revoke, so a caller who stops after
 * step 0 has the undo in hand rather than a standing grant they did not mean
 * to leave behind. The reference frontend never revokes; we make it possible.
 *
 * Exactly one of `borrowAmount` or `borrowShares` must be non-zero. Shares
 * express "all of it" exactly; an amount expresses a partial migration.
 */
export async function buildMigrateToFixedTermSteps(
  params: {
    chainId: ChainId;
    outMarket: WriteMarketConfig;
    inMarket: WriteMarketConfig;
    collateralAmount: bigint;
    borrowAmount?: bigint;
    borrowShares?: bigint;
    termId: bigint;
    walletAddress: Address;
  },
  deps: AuthorizationBuilderDeps,
): Promise<StepParam[]> {
  const borrowAmount = params.borrowAmount ?? 0n;
  const borrowShares = params.borrowShares ?? 0n;

  if ((borrowAmount === 0n) === (borrowShares === 0n)) {
    throw new Error(
      "exactly one of `borrowAmount` or `borrowShares` must be non-zero",
    );
  }
  if (params.collateralAmount <= 0n) {
    throw new Error(
      "buildMigrateToFixedTermSteps: collateralAmount must be greater than zero",
    );
  }

  // These four are enforced on-chain. Checking them here turns a reverted
  // transaction into an error before the first one is sent — which matters
  // because the first one is the authorization.
  const out = params.outMarket.params;
  const inn = params.inMarket.params;
  if (out.loanToken.toLowerCase() !== inn.loanToken.toLowerCase()) {
    throw new Error(
      "buildMigrateToFixedTermSteps: markets must share a loan token",
    );
  }
  if (out.collateralToken.toLowerCase() !== inn.collateralToken.toLowerCase()) {
    throw new Error(
      "buildMigrateToFixedTermSteps: markets must share a collateral token",
    );
  }
  if (inn.lltv < out.lltv) {
    throw new Error(
      "buildMigrateToFixedTermSteps: the target market's LLTV must be at least the source market's",
    );
  }

  const { publicClient, network } = deps;
  const positionManager = getContractAddress(network, "positionManager");

  const isAuthorized = (await publicClient.readContract({
    address: getContractAddress(network, "moolah"),
    abi: MOOLAH_ABI,
    functionName: "isAuthorized",
    args: [params.walletAddress, positionManager],
  })) as boolean;

  const steps: DraftStep[] = [];

  if (!isAuthorized) {
    const [revoke] = buildRevokeAuthorizationSteps(
      { chainId: params.chainId, authorized: positionManager },
      network,
    );
    steps.push({
      ...authorizationStep(
        {
          chainId: params.chainId,
          authorized: positionManager,
          isAuthorized: true,
        },
        network,
      ),
      meta: {
        spender: positionManager,
        precondition: "PositionManager is not yet authorized for this account",
        observedState: { isAuthorized },
        // The grant is standing. If the migration below is abandoned, this
        // undoes it.
        reversalSteps: [revoke],
      },
    });
  }

  steps.push({
    step: "migrateToFixedTerm",
    params: buildCallParams({
      to: positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: "migrateCommonMarketToFixedTermMarket",
      args: [
        {
          loanToken: out.loanToken,
          collateralToken: out.collateralToken,
          oracle: out.oracle,
          irm: out.irm,
          lltv: out.lltv,
        },
        {
          loanToken: inn.loanToken,
          collateralToken: inn.collateralToken,
          oracle: inn.oracle,
          irm: inn.irm,
          lltv: inn.lltv,
        },
        params.collateralAmount,
        borrowAmount,
        borrowShares,
        params.termId,
      ],
      chainId: params.chainId,
    }),
    meta: { amount: params.collateralAmount },
  });

  return finalizeSteps(steps);
}
