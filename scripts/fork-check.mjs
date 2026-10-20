#!/usr/bin/env node
/**
 * Mainnet-fork verification for flows that have no testnet target.
 *
 * The cross-market migration is configured on ten BSC market pairs and two on
 * Ethereum, and on zero testnet markets — the PositionManager is deployed on
 * chain 97 but no market there sets `convertToMarketId`. So the flow cannot be
 * exercised on a testnet at all, and forking mainnet is the only way to run it
 * against real state without real funds.
 *
 * What this proves, using SDK-built calldata end to end:
 *   1. `isAuthorized` reads what the builder thinks it reads
 *   2. an unauthorized account gets a two-step sequence, and its first step
 *      actually grants — the read flips to true
 *   3. the migration call, made *while authorized*, reverts inside the contract
 *      body with decodable error data rather than as a missing function, which
 *      is what a mis-encoded call would produce
 *   4. the reversal carried on that authorization step — the actual object off
 *      `meta.reversalSteps`, not an equivalent one built fresh — revokes it
 *
 * Requires anvil (foundry). Starts and stops its own fork.
 *
 * Usage: node scripts/fork-check.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  decodeErrorResult,
  isHex,
  keccak256,
  encodeAbiParameters,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { MoolahSDK } from "@lista-dao/moolah-lending-sdk";
import { redactUrl } from "./lib/fork.mjs";
import {
  MOOLAH_ABI,
  POSITION_MANAGER_ABI,
  getContractAddress,
} from "@lista-dao/moolah-sdk-core";

const PORT = 8601;
const RPC = `http://127.0.0.1:${PORT}`;
const UPSTREAM = process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org";

/**
 * A configured migration pair on BSC, from /api/moolah/market/{id}. The
 * variable market names the fixed-term market it converts into.
 */
const OUT_MARKET =
  "0x8a1fffce64f5b29d59e7ebfd7a927e29acdb932cc73508c9861157eeef9b8e1a";
const IN_MARKET =
  "0x86e6bfa9e590d003ce03e34a79a4986120c4ced545ab62db484e43acb049c6a1";

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
};

async function withAnvil(fn) {
  const proc = spawn(
    "anvil",
    ["--fork-url", UPSTREAM, "--port", String(PORT), "--silent"],
    { stdio: "ignore" },
  );
  try {
    let up = false;
    for (let i = 0; i < 20 && !up; i += 1) {
      await sleep(1500);
      try {
        const res = await fetch(RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_chainId",
            params: [],
          }),
        });
        up = res.ok;
      } catch {
        /* still starting */
      }
    }
    // Without this the loop could fail all twenty probes and the checks would
    // run anyway against a dead port. The shared library's copy gets this
    // right; this one had drifted.
    if (!up) throw new Error(`anvil did not come up on ${RPC}`);
    return await fn();
  } finally {
    proc.kill();
  }
}

async function main() {
  console.log(`forking BSC from ${redactUrl(UPSTREAM)} ...`);

  await withAnvil(async () => {
    const publicClient = createPublicClient({
      chain: bsc,
      transport: http(RPC),
    });
    const chainId = await publicClient.getChainId();
    record("fork reports BSC chain id", chainId === 56, String(chainId));

    // anvil's first prefunded account
    const [account] = await publicClient.request({ method: "eth_accounts" });
    const wallet = createWalletClient({
      account,
      chain: bsc,
      transport: http(RPC),
    });

    const sdk = new MoolahSDK({ rpcUrls: { 56: RPC } });
    const moolah = getContractAddress("bsc", "moolah");
    const positionManager = getContractAddress("bsc", "positionManager");

    const isAuthorized = () =>
      publicClient.readContract({
        address: moolah,
        abi: MOOLAH_ABI,
        functionName: "isAuthorized",
        args: [account, positionManager],
      });

    record("starts unauthorized", (await isAuthorized()) === false);

    /** Send one built step and wait for it. */
    const send = async (step) => {
      const hash = await wallet.sendTransaction({
        to: step.params.to,
        data: step.params.data,
        value: step.params.value,
      });
      return publicClient.waitForTransactionReceipt({ hash });
    };

    // 2. Build the migration while still unauthorized, so the builder emits the
    //    authorization step — the one carrying its own undo. Building it after
    //    a separate grant produced a one-step sequence and left the reversal
    //    untested, which is the whole point of the flow's shape.
    const migrationSteps = await sdk
      .buildMigrateToFixedTermParams({
        chainId: 56,
        outMarketId: OUT_MARKET,
        inMarketId: IN_MARKET,
        collateralAmount: 1n,
        borrowShares: 1n,
        termId: 0n,
        walletAddress: account,
        outMarket: {
          params: await marketParams(publicClient, moolah, OUT_MARKET),
        },
        inMarket: {
          params: await marketParams(publicClient, moolah, IN_MARKET),
        },
      })
      .catch(() => null);

    if (!migrationSteps) {
      record("migration steps build", false, "builder rejected the fixture");
      return;
    }
    record(
      "an unauthorized account gets the authorization step",
      migrationSteps.length === 2 &&
        migrationSteps[0].step === "setAuthorization",
      migrationSteps.map((s) => s.step).join(" -> "),
    );

    const [authStep, migrate] = migrationSteps;
    await send(authStep);
    record("authorization step grants", (await isAuthorized()) === true);

    // 3. The migration call, made *while authorized* — otherwise this asserts
    //    nothing about encoding, only that an unauthorized call is refused.
    //    The fixture is deliberately nonsensical (1 wei of collateral, 1
    //    borrow share), so it must revert; what is being established is that it
    //    reverts from inside the contract with decodable error data, rather
    //    than as a missing function, which is what a mis-encoded call gives.
    const err = await publicClient
      .call({ account, to: migrate.params.to, data: migrate.params.data })
      .then(() => null)
      .catch((e) => e);

    const raw = err?.walk?.((e) => isHex(e?.data))?.data ?? err?.data;
    // `0x` is hex and is what an empty revert returns, so `Boolean(raw)` alone
    // accepts exactly the case this is meant to exclude. And four arbitrary
    // bytes are not much better — any mis-encoding that still reaches code
    // produces some selector. Require the data to decode against the
    // PositionManager's own error surface: that is what distinguishes "the
    // contract rejected these arguments" from "something reverted".
    let named = null;
    if (typeof raw === "string" && raw.length >= 10) {
      try {
        named = decodeErrorResult({ abi: POSITION_MANAGER_ABI, data: raw }).errorName;
      } catch {
        // Solidity's own Error(string) and Panic(uint256) are in no contract
        // ABI but are unambiguously the contract's own revert. Decoded, not
        // selector-matched: a bare `0x08c379a0` with no arguments is malformed
        // data that happens to start with the right four bytes, and accepting
        // it would put back the hole this replaced.
        try {
          named = decodeErrorResult({ abi: SOLIDITY_BUILTIN_ERRORS, data: raw })
            .errorName;
        } catch {
          named = null;
        }
      }
    }
    record(
      "migration call is rejected by the contract, by name",
      named !== null,
      named
        ? `reverted with ${named}`
        : `undecodable revert data ${String(raw ?? "none").slice(0, 10)}`,
    );

    // 4. The reversal attached to the authorization step — the actual one, off
    //    `meta.reversalSteps`, not a freshly built revoke that happens to do
    //    the same thing. README sells this as part of the execution contract;
    //    until now nothing had ever executed one.
    const attached = authStep.meta?.reversalSteps ?? [];
    record(
      "the authorization step carries its own undo",
      attached.length === 1 && attached[0].step === "revokeAuthorization",
      attached.map((s) => s.step).join(", ") || "none",
    );
    for (const step of attached) await send(step);
    record("the attached reversal revokes", (await isAuthorized()) === false);

    // ---- EIP-712 signed authorization -------------------------------------
    // The riskiest thing in this iteration: Moolah's domain has no name and no
    // version, so viem's conventional helpers do not apply and a wrong struct
    // hash fails silently rather than loudly. Nothing short of signing against
    // the live contract proves the encoding.

    // anvil's well-known first key, so we can sign as well as send.
    const signer = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    );
    record(
      "signer matches the prefunded account",
      signer.address.toLowerCase() === String(account).toLowerCase(),
    );

    const onChainSeparator = await publicClient.readContract({
      address: moolah,
      abi: MOOLAH_ABI,
      functionName: "domainSeparator",
    });
    const DOMAIN_TYPEHASH = keccak256(
      toHex("EIP712Domain(uint256 chainId,address verifyingContract)"),
    );
    const computedSeparator = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [DOMAIN_TYPEHASH, 56n, moolah],
      ),
    );
    record(
      "domain separator matches the contract",
      onChainSeparator === computedSeparator,
      onChainSeparator.slice(0, 10),
    );

    const nonce = await sdk.getAuthorizationNonce(56, signer.address);
    const authorization = {
      authorizer: signer.address,
      authorized: positionManager,
      isAuthorized: true,
      nonce,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };
    const typedData = sdk.buildAuthorizationTypedData(56, authorization);
    const signature = await signer.signTypedData(typedData);

    const [sigStep] = await sdk.buildSetAuthorizationWithSigParams({
      chainId: 56,
      authorization,
      signature,
    });

    // Submitted by a DIFFERENT account: the point is that the authorizer does
    // not send, and does not pay.
    const [, relayer] = await publicClient.request({ method: "eth_accounts" });
    const relayerWallet = createWalletClient({
      account: relayer,
      chain: bsc,
      transport: http(RPC),
    });
    const sigHash = await relayerWallet.sendTransaction({
      to: sigStep.params.to,
      data: sigStep.params.data,
    });
    await publicClient.waitForTransactionReceipt({ hash: sigHash });

    record(
      "signed authorization grants when relayed by another account",
      (await isAuthorized()) === true,
    );
    record(
      "nonce advanced, so the signature cannot be replayed",
      (await sdk.getAuthorizationNonce(56, signer.address)) === nonce + 1n,
    );

    // The nonce has advanced, so the same signature must no longer validate.
    // anvil accepts the transaction and reverts it on-chain rather than
    // rejecting it at send time, so the receipt is what to check.
    // Deliberately not wrapped in a catch-all: a catch that turns any throw
    // into a pass would record replay protection as working after an RPC
    // hiccup, a nonce collision, or anvil dying. The receipt is the evidence.
    const replayHash = await relayerWallet.sendTransaction({
      to: sigStep.params.to,
      data: sigStep.params.data,
    });
    const replayReceipt = await publicClient.waitForTransactionReceipt({
      hash: replayHash,
    });
    record(
      "replaying the same signature is rejected",
      replayReceipt.status === "reverted",
      `receipt status ${replayReceipt.status}`,
    );

    // ---- cancelling a signed authorization --------------------------------
    //
    // The hazard the signature path trades for gasless grants: a signature is a
    // bearer instrument, and `setAuthorization(x, false)` does not consume the
    // nonce, so a plain revoke cannot cancel one that has not landed. Until
    // this release the revoke docstring pointed at a helper that did not exist,
    // which left a user who signed to the wrong target with nothing to do.
    //
    // What works is burning the nonce out from under it. Sign a grant, do not
    // submit it, cancel, then try to submit it anyway.
    await (async () => {
      const grantNonce = await sdk.getAuthorizationNonce(56, signer.address);
      const unsent = {
        authorizer: signer.address,
        authorized: positionManager,
        isAuthorized: true,
        nonce: grantNonce,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const unsentSig = await signer.signTypedData(
        sdk.buildAuthorizationTypedData(56, unsent),
      );

      const cancelData = await sdk.buildCancelSignedAuthorizationTypedData({
        chainId: 56,
        authorizer: signer.address,
        nonce: grantNonce,
      });
      record(
        "the cancellation is built against the same nonce",
        cancelData.message.nonce === grantNonce &&
          cancelData.message.isAuthorized === false,
        `nonce ${grantNonce}`,
      );

      const cancelSig = await signer.signTypedData(cancelData);
      const [cancelStep] = await sdk.buildSetAuthorizationWithSigParams({
        chainId: 56,
        authorization: cancelData.message,
        signature: cancelSig,
      });
      const cancelHash = await relayerWallet.sendTransaction({
        to: cancelStep.params.to,
        data: cancelStep.params.data,
      });
      await publicClient.waitForTransactionReceipt({ hash: cancelHash });
      record(
        "cancelling burns the nonce",
        (await sdk.getAuthorizationNonce(56, signer.address)) ===
          grantNonce + 1n,
      );

      // The account is already authorized here, from the signed grant above,
      // so comparing `isAuthorized` before and after proves nothing either way.
      // The nonce is what carries the claim: a submitted signature advances it,
      // so a nonce that does not move is a signature that did not land.
      const nonceBefore = await sdk.getAuthorizationNonce(56, signer.address);
      const [revived] = await sdk.buildSetAuthorizationWithSigParams({
        chainId: 56,
        authorization: unsent,
        signature: unsentSig,
      });
      const revivedHash = await relayerWallet.sendTransaction({
        to: revived.params.to,
        data: revived.params.data,
      });
      const revivedReceipt = await publicClient.waitForTransactionReceipt({
        hash: revivedHash,
      });
      const nonceAfter = await sdk.getAuthorizationNonce(56, signer.address);
      record(
        "the cancelled signature can no longer be submitted",
        revivedReceipt.status === "reverted" && nonceAfter === nonceBefore,
        `receipt status ${revivedReceipt.status}, nonce still ${nonceAfter}`,
      );
    })();
  });

  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length === 0
      ? `\nOK — ${results.length} fork checks passed`
      : `\nFAILED — ${failed.length}/${results.length}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

/** Solidity's built-in reverts, which belong to no contract's ABI. */
const SOLIDITY_BUILTIN_ERRORS = [
  {
    type: "error",
    name: "Error",
    inputs: [{ name: "message", type: "string" }],
  },
  { type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] },
];

/** Any live market's params; the migration fixture only needs a valid shape. */
async function marketParams(publicClient, moolah, marketId) {
  const [loanToken, collateralToken, oracle, irm, lltv] =
    await publicClient.readContract({
      address: moolah,
      abi: MOOLAH_ABI,
      functionName: "idToMarketParams",
      args: [marketId],
    });
  return { loanToken, collateralToken, oracle, irm, lltv };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
