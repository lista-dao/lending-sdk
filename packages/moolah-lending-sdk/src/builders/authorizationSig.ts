import type { Address, Hex, PublicClient } from "viem";
import { hexToNumber, slice } from "viem";
import {
  MOOLAH_ABI,
  getContractAddress,
  type NetworkName,
} from "@lista-dao/moolah-sdk-core";
import type { ChainId, StepParam } from "../types.js";
import { buildCallParams, finalizeSteps } from "../utils.js";
import { assertAuthorizable } from "./authorization.js";

/** The struct Moolah hashes for `setAuthorizationWithSig`. */
export interface MoolahAuthorization {
  /** Account granting the permission. Must be the signer. */
  authorizer: Address;
  /** Contract being authorized. */
  authorized: Address;
  /** true grants, false revokes. */
  isAuthorized: boolean;
  /** The authorizer's current `Moolah.nonce`. Single use, strictly ordered. */
  nonce: bigint;
  /** Unix seconds after which the signature is refused. */
  deadline: bigint;
}

export interface AuthorizationSignature {
  v: number;
  r: Hex;
  s: Hex;
}

/**
 * EIP-712 type definition for an authorization.
 *
 * Matches the contract's typehash exactly. Field order is part of the hash, so
 * this list cannot be reordered.
 */
export const MOOLAH_AUTHORIZATION_TYPES = {
  Authorization: [
    { name: "authorizer", type: "address" },
    { name: "authorized", type: "address" },
    { name: "isAuthorized", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Build the typed data a wallet signs to authorize without sending a
 * transaction.
 *
 * Moolah's EIP-712 domain is not the usual one: it is
 * `EIP712Domain(uint256 chainId,address verifyingContract)` with **no name and
 * no version**, and the on-chain getter is `domainSeparator()` rather than the
 * conventional `DOMAIN_SEPARATOR()`. Signers derive the domain type from the
 * fields present, so the domain returned here deliberately carries only those
 * two — adding a name or version would change the separator and produce a
 * signature the contract silently rejects.
 *
 * Verify the result against `Moolah.domainSeparator()` if you are adapting
 * this for another deployment.
 */
export const DEFAULT_AUTHORIZATION_TTL_SECONDS = 3600n;

export function buildAuthorizationTypedData(
  authorization: MoolahAuthorization,
  params: {
    chainId: number;
    network: NetworkName;
    /** Override the one-hour cap on how far ahead `deadline` may sit. */
    maxTtlSeconds?: bigint;
    /** Authorize a target the address book does not name. */
    allowUnknownTarget?: boolean;
    /** Injectable clock, for tests. */
    now?: bigint;
  },
) {
  // The same allowlist the transaction path applies, and it matters more here:
  // a signature is a bearer instrument with no undo, so a target arriving from
  // a URL or an API field must not become signable by accident. Only grants are
  // checked — signing a revoke of an unknown target is always safe.
  if (authorization.isAuthorized) {
    assertAuthorizable(
      authorization.authorized,
      params.network,
      params.allowUnknownTarget,
    );
  }

  const now = params.now ?? BigInt(Math.floor(Date.now() / 1000));
  const ttl = params.maxTtlSeconds ?? DEFAULT_AUTHORIZATION_TTL_SECONDS;
  if (authorization.deadline <= now) {
    throw new Error(
      "buildAuthorizationTypedData: deadline is already in the past",
    );
  }
  if (authorization.deadline - now > ttl) {
    throw new Error(
      `buildAuthorizationTypedData: deadline is ${authorization.deadline - now}s ` +
        `away, beyond the ${ttl}s cap. A signed grant cannot be cancelled before ` +
        `it expires — revoking does not consume the nonce — so a distant ` +
        `deadline is a standing grant anyone holding the signature can use. ` +
        `Pass maxTtlSeconds to widen this deliberately.`,
    );
  }

  return {
    domain: {
      chainId: params.chainId,
      verifyingContract: getContractAddress(params.network, "moolah"),
    },
    types: MOOLAH_AUTHORIZATION_TYPES,
    primaryType: "Authorization",
    message: authorization,
  } as const;
}

/**
 * Read the signer's current authorization nonce.
 *
 * Nonces are consumed in order and each signature is single use, so a
 * signature built against a stale nonce is rejected rather than replayed.
 */
export async function getAuthorizationNonce(
  authorizer: Address,
  deps: { publicClient: PublicClient; network: NetworkName },
): Promise<bigint> {
  return (await deps.publicClient.readContract({
    address: getContractAddress(deps.network, "moolah"),
    abi: MOOLAH_ABI,
    functionName: "nonce",
    args: [authorizer],
  })) as bigint;
}

/**
 * Normalise a recovery id to the 27/28 the contract's `ecrecover` needs.
 *
 * Some signers return 0/1 (the yParity bit) rather than 27/28 — viem's
 * `secp256k1.sign().recovery`, ethers v6's `Signature.yParity`, `@noble/curves`
 * all do. A `uint8` accepts either shape happily, encodes without complaint,
 * and `ecrecover(digest, 1, r, s)` returns `address(0)` on-chain: the
 * signatory check fails and the transaction reverts, burning whoever
 * submitted it — a relayer, on the signature path this function exists for.
 *
 * Applied to both entry points below. It used to run only on the raw-hex
 * path, inside {@link splitAuthorizationSignature} — a caller handing in an
 * already-split `{v, r, s}` tuple bypassed it entirely, and nothing surfaced
 * that a `v` outside `{27, 28}` had come in.
 */
function normalizeRecoveryId(v: number): number {
  const normalized = v < 27 ? v + 27 : v;
  if (normalized !== 27 && normalized !== 28) {
    throw new Error(
      `Invalid signature recovery id: ${v}. Expected 0, 1, 27 or 28.`,
    );
  }
  return normalized;
}

/** Split a 65-byte signature into the (v, r, s) tuple the contract takes. */
export function splitAuthorizationSignature(
  signature: Hex,
): AuthorizationSignature {
  if (signature.length !== 132) {
    throw new Error(
      `splitAuthorizationSignature: expected a 65-byte signature, got ${(signature.length - 2) / 2} bytes`,
    );
  }
  const v = hexToNumber(slice(signature, 64, 65));
  return {
    r: slice(signature, 0, 32),
    s: slice(signature, 32, 64),
    v: normalizeRecoveryId(v),
  };
}

/**
 * Submit a signed authorization.
 *
 * The value of the signature path is that the authorizer does not send a
 * transaction: someone else pays the gas, and a relayer can submit the grant
 * and the action together.
 *
 * It trades one hazard for another rather than removing it. A signature is a
 * bearer instrument: whoever holds it can submit it until the deadline, and
 * `setAuthorization(x, false)` does **not** consume the nonce, so a plain
 * revoke cannot cancel one that has not landed yet. The only cancellation is
 * to burn the nonce with a competing signed authorization at the same nonce.
 * That is why the deadline is capped by default.
 *
 * Accepts either a raw 65-byte signature or an already-split tuple.
 */
export function buildSetAuthorizationWithSigSteps(
  params: {
    chainId: ChainId;
    authorization: MoolahAuthorization;
    signature: Hex | AuthorizationSignature;
    /** Submit a grant to a target the address book does not name. */
    allowUnknownTarget?: boolean;
  },
  network: NetworkName,
): StepParam[] {
  // Checked here too, not only where the typed data was built: a signature can
  // reach this function from anywhere, including a different process.
  if (params.authorization.isAuthorized) {
    assertAuthorizable(
      params.authorization.authorized,
      network,
      params.allowUnknownTarget,
    );
  }

  // Both branches go through the same normaliser now — a signature that
  // arrives already split (the common shape once a caller has signed it
  // themselves and passed the result across a process boundary) used to skip
  // it entirely. See {@link normalizeRecoveryId}.
  const signature =
    typeof params.signature === "string"
      ? splitAuthorizationSignature(params.signature)
      : { ...params.signature, v: normalizeRecoveryId(params.signature.v) };

  return finalizeSteps([
    {
      step: params.authorization.isAuthorized
        ? "setAuthorization"
        : "revokeAuthorization",
      params: buildCallParams({
        to: getContractAddress(network, "moolah"),
        abi: MOOLAH_ABI,
        functionName: "setAuthorizationWithSig",
        args: [params.authorization, signature],
        chainId: params.chainId,
      }),
      meta: {
        spender: params.authorization.authorized,
        precondition: "signed off-chain; any account may submit this",
      },
    },
  ]);
}

/**
 * Cancel a signed authorization that has not been submitted.
 *
 * This is the only cancellation there is. `setAuthorization(x, false)` clears
 * the flag on-chain but does not touch the signer's nonce, so a relayer holding
 * an unsubmitted signature can land the grant *after* the revoke and it sticks.
 *
 * What works is burning the nonce the outstanding signature was built against:
 * sign a second authorization at the same nonce, and whichever lands first
 * consumes it while the other becomes permanently invalid. This one is a
 * self-grant of `false` — a no-op if it lands, which is the point.
 *
 * It is a race. Submit it with a priority fee, and treat the outstanding
 * signature as live until the nonce has actually advanced.
 */
export async function buildCancelSignedAuthorizationTypedData(
  params: {
    authorizer: Address;
    /** The nonce the outstanding signature used. */
    nonce: bigint;
    chainId: number;
    network: NetworkName;
    /** How long the cancelling signature stays valid. */
    ttlSeconds?: bigint;
    now?: bigint;
  },
  deps: { publicClient: PublicClient },
) {
  const current = await getAuthorizationNonce(params.authorizer, {
    publicClient: deps.publicClient,
    network: params.network,
  });
  // Three states, and conflating them gives an all-clear at exactly the moment
  // there is something to act on.
  if (current > params.nonce) {
    // The nonce is spent, which means the signature was *submitted*. Whatever
    // it granted is standing on-chain right now. "Nothing left to cancel" is
    // true and useless — cancelling is no longer the remedy, revoking is.
    throw new Error(
      `buildCancelSignedAuthorizationTypedData: nonce ${params.nonce} has been ` +
        `consumed (current is ${current}), which means that signature was ` +
        `already submitted. Anything it granted is live now. Check ` +
        `Moolah.isAuthorized(${params.authorizer}, <target>) and clear it with ` +
        `buildRevokeAuthorizationParams — cancelling cannot help any more.`,
    );
  }
  if (current < params.nonce) {
    // The signature is not dead, it is not yet reachable. Burning this nonce
    // would not even be possible — nonces are consumed in order, so a
    // signature at a higher nonce simply becomes valid as the counter arrives.
    throw new Error(
      `buildCancelSignedAuthorizationTypedData: nonce ${params.nonce} has not ` +
        `been reached yet (current is ${current}), so that signature is still ` +
        `live and will become submittable as the counter reaches it. Nonces are ` +
        `consumed in order: burn ${current} through ${params.nonce}, lowest ` +
        `first.`,
    );
  }

  const now = params.now ?? BigInt(Math.floor(Date.now() / 1000));
  return buildAuthorizationTypedData(
    {
      authorizer: params.authorizer,
      // Self-target: a grant to yourself confers nothing, so this is inert
      // whether or not it lands. It exists to spend the nonce.
      authorized: params.authorizer,
      isAuthorized: false,
      nonce: params.nonce,
      deadline: now + (params.ttlSeconds ?? 300n),
    },
    {
      chainId: params.chainId,
      network: params.network,
      now,
      // The signing cap exists because a distant deadline on a grant is a
      // standing grant nobody can cancel. This *is* the cancellation and
      // confers nothing, so the cap has nothing to protect.
      maxTtlSeconds: params.ttlSeconds ?? 300n,
    },
  );
}
