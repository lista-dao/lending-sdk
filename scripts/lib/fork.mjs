/**
 * Shared plumbing for the mainnet-fork harnesses.
 *
 * A fork is the only venue for three of this release's flows. Liquidation needs
 * an unhealthy position, which no testnet will hand you on demand; Smart Lending
 * and the vaults need real pools and real depositors. Forking gives all of that
 * against the actually-deployed contracts, and lets us move state that mainnet
 * would never let us move.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  pad,
  toHex,
} from "viem";

export const DEFAULT_UPSTREAM =
  process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org";

/**
 * An RPC URL with its path removed.
 *
 * Most provider endpoints carry the API key in the path, so printing the URL
 * publishes the credential — to a terminal, to a CI log that is only masked if
 * the secret was registered, and to anyone reading `ps`. The host is the part
 * worth seeing anyway.
 */
export function redactUrl(url) {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}/…`;
  } catch {
    return "<malformed RPC URL>";
  }
}

/** Start an anvil fork, run `fn`, and always tear the fork down. */
export async function withAnvil(fn, { port = 8601, upstream = DEFAULT_UPSTREAM } = {}) {
  const rpcUrl = `http://127.0.0.1:${port}`;
  // Every miss in the fork cache is a round trip upstream, and the storage-slot
  // search below makes a lot of them. Give anvil room to retry rather than
  // letting a rate-limited provider surface as a mystery timeout.
  const proc = spawn(
    "anvil",
    [
      "--fork-url", upstream,
      "--port", String(port),
      "--silent",
      "--retries", "10",
      "--timeout", "120000",
    ],
    { stdio: "ignore" },
  );
  try {
    let up = false;
    for (let i = 0; i < 25 && !up; i += 1) {
      await sleep(1200);
      try {
        up = (await raw(rpcUrl, "eth_chainId", [])) !== undefined;
      } catch {
        /* still starting */
      }
    }
    if (!up) throw new Error(`anvil did not come up on ${rpcUrl}`);
    return await fn(rpcUrl);
  } finally {
    proc.kill();
  }
}

/** A raw JSON-RPC call, for the anvil_* and evm_* methods viem does not model. */
export async function raw(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

/** ERC-20 Transfer, for finding holders when the storage layout is opaque. */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Give an account a token balance, whatever the token's storage looks like.
 *
 * Writing the balance slot is the cheap path, but it only works when balances
 * live in a plainly numbered mapping. Tokens on OZ v5 upgradeable keep them
 * under an ERC-7201 namespaced root instead, where the slot is a hash constant
 * no search over small integers will ever reach — the U token is one. So fall
 * back to taking the funds from someone who has them: scan recent Transfer
 * logs for counterparties, pick one rich enough, and impersonate it.
 */
export async function fundToken(
  rpcUrl,
  publicClient,
  token,
  holder,
  amount,
  options = {},
) {
  try {
    return await dealToken(rpcUrl, publicClient, token, holder, amount);
  } catch {
    /* opaque layout — take the long way round */
  }

  const head = await publicClient.getBlockNumber();
  // Structural holders first — a pool or a provider holds its own LP by
  // construction, where the log scan only finds whoever happened to trade
  // recently. Relying on the window alone made this fail on a quiet block.
  const seen = new Set(options.candidates ?? []);

  for (const window of [4_000n, 50_000n]) {
    const logs = await publicClient.request({
      method: "eth_getLogs",
      params: [
        {
          address: token,
          topics: [TRANSFER_TOPIC],
          fromBlock: toHex(head - window),
          toBlock: toHex(head),
        },
      ],
    });
    for (const log of logs) {
      for (const topic of log.topics.slice(1, 3)) {
        if (topic) seen.add(`0x${topic.slice(26)}`);
      }
    }
    if (seen.size > 4) break;
  }

  // Richest first: a big holder is likelier to be a pool or treasury that can
  // actually part with the amount, and likelier to survive whatever transfer
  // restrictions the token imposes.
  const holders = [];
  for (const candidate of seen) {
    if (candidate === "0x0000000000000000000000000000000000000000") continue;
    const balance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [candidate],
    });
    if (balance >= amount) holders.push({ candidate, balance });
  }
  holders.sort((a, b) => (b.balance > a.balance ? 1 : -1));

  for (const { candidate } of holders) {
    // Plenty of reasons a given holder cannot pay: a blocklist, a transfer
    // hook, a contract with no fallback. Try the next one rather than letting
    // one unlucky pick fail the whole run.
    try {
      await raw(rpcUrl, "anvil_impersonateAccount", [candidate]);
      await raw(rpcUrl, "anvil_setBalance", [candidate, toHex(10n ** 18n)]);
      const wallet = createWalletClient({
        account: candidate,
        chain: publicClient.chain,
        transport: http(rpcUrl, { timeout: 180_000 }),
      });
      const hash = await wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "transfer",
        args: [holder, amount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") return `whale ${candidate.slice(0, 10)}`;
    } catch {
      /* try the next holder */
    } finally {
      await raw(rpcUrl, "anvil_stopImpersonatingAccount", [candidate]).catch(
        () => {},
      );
    }
  }

  throw new Error(`fundToken: no way to give ${holder} ${amount} of ${token}`);
}

/**
 * Give an account a token balance by writing the balance slot directly.
 *
 * There is no portable way to ask a token where it keeps balances, so find the
 * slot by trying: write a probe value at `keccak256(holder . slot)` for each
 * candidate and see whether `balanceOf` changes. Anything written at a wrong
 * guess is put back before moving on, so a miss leaves no trace.
 *
 * This is how the harness funds itself without needing a whale to impersonate,
 * and without the whale's balance becoming part of what the test depends on.
 */
export async function dealToken(rpcUrl, publicClient, token, holder, amount) {
  const balanceOf = () =>
    publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [holder],
    });

  // Without this, a holder who already happens to hold exactly `amount` makes
  // the first candidate slot look like a hit: the probe is "confirmed" by a
  // balance that was already there, and the write is never undone.
  if ((await balanceOf()) === amount) return "already held";

  const probe = pad(toHex(amount), { size: 32 });
  for (let slotIndex = 0; slotIndex < 40; slotIndex += 1) {
    const slot = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [holder, BigInt(slotIndex)],
      ),
    );
    const previous = await raw(rpcUrl, "eth_getStorageAt", [
      token,
      slot,
      "latest",
    ]);
    await raw(rpcUrl, "anvil_setStorageAt", [token, slot, probe]);

    // The restore has to survive a throw. A miss that leaves the probe behind
    // sets an arbitrary word of the token — totalSupply, a fee parameter, half
    // of a packed pair — and every later assertion runs against a token the
    // harness itself corrupted.
    let hit = false;
    try {
      hit = (await balanceOf()) === amount;
    } finally {
      if (!hit) {
        await raw(rpcUrl, "anvil_setStorageAt", [token, slot, previous]);
      }
    }
    if (hit) return `balance slot ${slotIndex}`;
  }
  throw new Error(`dealToken: could not locate the balance slot of ${token}`);
}

/** A result recorder shared by every harness, so output reads the same. */
export function recorder() {
  const results = [];
  const record = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };
  return { results, record };
}

export function reportAndExit(results, label) {
  // A run that asserted nothing is not a run that passed. Without this, a
  // mistyped --only prints "OK — 0 checks passed" and exits 0, which is exactly
  // what a release gate must never do.
  if (results.length === 0) {
    console.log(`\nFAILED — no ${label} ran at all`);
    process.exit(1);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length === 0
      ? `\nOK — ${results.length} ${label} passed`
      : `\nFAILED — ${failed.length}/${results.length} ${label}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

/**
 * Read `--only <section>` and refuse anything that is not a section.
 *
 * Three ways to get this wrong silently: a typo runs nothing, `--only=x` is not
 * matched by `includes("--only")` so the filter is ignored and everything runs,
 * and a trailing `--only` yields undefined and does the same.
 */
export function parseOnly(argv, sections) {
  const flag = argv.findIndex((a) => a === "--only" || a.startsWith("--only="));
  if (flag === -1) return null;
  const value = argv[flag].startsWith("--only=")
    ? argv[flag].slice("--only=".length)
    : argv[flag + 1];
  if (!value || !sections.includes(value)) {
    console.error(
      `--only takes one of: ${sections.join(", ")}${value ? ` (got "${value}")` : ""}`,
    );
    process.exit(2);
  }
  return value;
}

/**
 * OZ v5 `AccessControlUpgradeable` keeps its state under an ERC-7201 namespace
 * rather than at a numbered slot: `keccak256(abi.encode(uint256(keccak256(
 * "openzeppelin.storage.AccessControl")) - 1)) & ~0xff`.
 */
const ACCESS_CONTROL_STORAGE_LOCATION =
  "0x02dd7bc7dec4dceedda775e58dd541e08a116c6c53815c0bd028192f7b626800";

/**
 * Grant a role by writing it, rather than by finding someone who can grant it.
 *
 * Admin keys are not knowable from a fork, and hunting the current holder makes
 * the test depend on who that happens to be today. Writing the flag directly
 * keeps the test about the protocol's behaviour once the role is held.
 *
 * Tries the ERC-7201 namespace first and falls back to plain numbered slots,
 * verifying with `hasRole` either way, so a miss fails loudly.
 */
export async function grantRoleOnFork(rpcUrl, publicClient, contract, role, account) {
  const roleAbi = [
    {
      inputs: [
        { name: "role", type: "bytes32" },
        { name: "account", type: "address" },
      ],
      name: "hasRole",
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "view",
      type: "function",
    },
  ];
  const has = () =>
    publicClient.readContract({
      address: contract,
      abi: roleAbi,
      functionName: "hasRole",
      args: [role, account],
    });

  // Already held? Then writing a slot and seeing `hasRole` true proves nothing
  // about the slot, and the write is never undone.
  if (await has()) return "already held";

  const bases = [
    ACCESS_CONTROL_STORAGE_LOCATION,
    ...Array.from({ length: 60 }, (_, i) => pad(toHex(i), { size: 32 })),
  ];
  for (const base of bases) {
    const roleSlot = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        [role, base],
      ),
    );
    const slot = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }],
        [account, roleSlot],
      ),
    );
    const previous = await raw(rpcUrl, "eth_getStorageAt", [
      contract,
      slot,
      "latest",
    ]);
    await raw(rpcUrl, "anvil_setStorageAt", [
      contract,
      slot,
      pad(toHex(1n), { size: 32 }),
    ]);
    let hit = false;
    try {
      hit = await has();
    } finally {
      if (!hit) {
        await raw(rpcUrl, "anvil_setStorageAt", [contract, slot, previous]);
      }
    }
    if (hit) return base;
  }
  throw new Error(`grantRoleOnFork: could not grant ${role} on ${contract}`);
}
