#!/usr/bin/env node
/**
 * ABI-vs-chain conformance check.
 *
 * Unit tests cannot catch a mis-transcribed ABI: they encode with the same
 * (wrong) ABI they assert against. This check is the only thing that does.
 *
 * For every function in our ABIs it computes the 4-byte selector and looks for
 * it in the deployed contract's runtime bytecode, following EIP-1967 proxies to
 * the implementation. A solc dispatcher embeds each selector as a constant, so
 * presence is a reliable signal and absence is a real finding — verified
 * against a control selector that must never be found.
 *
 * It also checks contract *identity*, which selector presence cannot: several
 * Moolah contracts expose `MOOLAH()`, so a transposed address either has no
 * such function or points at a different deployment. Without this, a typo in
 * the address book passes types, tests, lint and the selector check alike.
 *
 * Read-only. No key, no funds, no state change.
 *
 * Usage: node scripts/abi-conformance.mjs [--json]
 */
import { createPublicClient, http, toFunctionSelector } from "viem";
import { bsc, mainnet } from "viem/chains";
import {
  CONTRACT_ADDRESSES,
  MOOLAH_ABI,
  MOOLAH_VAULT_ABI,
  SMART_PROVIDER_ABI,
  LENDING_BROKER_ABI,
  PUBLIC_LIQUIDATOR_ABI,
  INTEREST_RATE_MODEL_ABI,
  FIXED_RATE_IRM_ABI,
  NATIVE_PROVIDER_ABI,
  POSITION_MANAGER_ABI,
  BROKER_RATE_CALCULATOR_ABI,
  STABLE_SWAP_POOL_ABI,
} from "@lista-dao/moolah-sdk-core";

const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ZERO = "0x0000000000000000000000000000000000000000";

/** Must never be found. If it is, the detection method is unsound. */
const CONTROL_SELECTOR = toFunctionSelector(
  "function __moolahSdkConformanceControl__(uint256)",
);

const NETWORKS = {
  bsc: {
    chain: bsc,
    rpc: process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org",
  },
  ethereum: {
    chain: mainnet,
    rpc: process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
  },
};

/** Address-book keys that hold a statically-known deployment we can check. */
const SUBJECTS = [
  { contract: "moolah", abi: MOOLAH_ABI },
  { contract: "moolahPublicLiquidation", abi: PUBLIC_LIQUIDATOR_ABI },
  { contract: "interestRateModel", abi: INTEREST_RATE_MODEL_ABI },
  { contract: "fixedRateIrm", abi: FIXED_RATE_IRM_ABI },
  { contract: "nativeProvider", abi: NATIVE_PROVIDER_ABI },
  { contract: "positionManager", abi: POSITION_MANAGER_ABI },
  { contract: "brokerRateCalculator", abi: BROKER_RATE_CALCULATOR_ABI },
];

/**
 * Contracts that name the Moolah instance they belong to.
 *
 * Reading it back and comparing against the address book proves the address is
 * the contract we think it is, not merely *a* contract with matching
 * selectors. This is the check that catches a transposed character.
 */
const IDENTITY_SUBJECTS = [
  "moolahPublicLiquidation",
  "positionManager",
  "moolahVaultFactory",
];

const MOOLAH_GETTER_ABI = [
  {
    inputs: [],
    name: "MOOLAH",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

/**
 * Per-market / per-vault contracts have no address-book entry, so they are
 * checked against a known live instance instead.
 */
const DYNAMIC_SUBJECTS = {
  bsc: [
    {
      contract: "lendingBroker",
      abi: LENDING_BROKER_ABI,
      address: "0xca5929b8ff8b1a4b9b8d77dfc5340977bfa425b3",
    },
    {
      // Gauntlet x Lista DAO U Vault, the largest on the U market.
      contract: "moolahVault",
      abi: MOOLAH_VAULT_ABI,
      address: "0x9a17fd5cb8efc25d11567e713ae795a89775a759",
    },
    {
      // The SmartProvider behind the USDT/USDC stable-swap markets.
      contract: "smartProvider",
      abi: SMART_PROVIDER_ABI,
      address: "0x5fd3971104cf3bab1dc89ef904da26f54f75c06b",
    },
    {
      contract: "stableSwapPool",
      abi: STABLE_SWAP_POOL_ABI,
      address: "0xf5448fc2beb9324900d08225fe4530ba3bbf654f",
    },
  ],
  ethereum: [
    {
      contract: "lendingBroker",
      abi: LENDING_BROKER_ABI,
      address: "0x39acab377a7ca24c1bf4b2ae5294f57519d8719b",
    },
    {
      contract: "moolahVault",
      abi: MOOLAH_VAULT_ABI,
      address: "0x28643ffd79256719d6acbcf25cb44576caebcf12",
    },
  ],
};

async function runtimeCode(client, address) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return null;
  // Follow an EIP-1967 proxy to its implementation, where the dispatcher lives.
  const slot = await client.getStorageAt({
    address,
    slot: EIP1967_IMPL_SLOT,
  });
  if (slot && BigInt(slot) !== 0n) {
    const impl = `0x${slot.slice(-40)}`;
    const implCode = await client.getCode({ address: impl });
    if (implCode && implCode !== "0x") return { code: implCode, impl };
  }
  return { code, impl: null };
}

async function main() {
  const asJson = process.argv.includes("--json");
  const report = {
    checked: 0,
    missing: [],
    skipped: [],
    identity: [],
    networks: {},
    // Subjects the RPC could not answer for. Distinct from `skipped`, which
    // records things deliberately not checked: unreachable means this run
    // proves nothing about them, and that is a failure, not a footnote.
    unreachable: [],
  };

  for (const [network, { chain, rpc }] of Object.entries(NETWORKS)) {
    const client = createPublicClient({ chain, transport: http(rpc) });
    const subjects = [
      ...SUBJECTS.map((s) => ({
        ...s,
        address: CONTRACT_ADDRESSES[network]?.[s.contract],
      })),
      ...(DYNAMIC_SUBJECTS[network] ?? []),
    ];
    report.networks[network] = [];

    for (const { contract, abi, address } of subjects) {
      if (!address || address === ZERO) {
        report.skipped.push(`${network}.${contract} (not configured)`);
        continue;
      }
      let result;
      try {
        result = await runtimeCode(client, address);
      } catch (err) {
        // A network that could not be reached is not a network that passed.
        // Left as a skip, an unset CI secret or a rate-limited node quietly
        // removes a third of the coverage and the verdict line is unchanged —
        // "OK — every ABI function resolves" over a run that checked two of
        // three chains.
        report.unreachable.push(
          `${network}.${contract} (rpc error: ${err.message})`,
        );
        continue;
      }
      if (!result) {
        report.missing.push({
          network,
          contract,
          address,
          fn: "*",
          reason: "no bytecode at address",
        });
        continue;
      }
      const { code } = result;

      if (code.includes(CONTROL_SELECTOR.slice(2))) {
        throw new Error(
          `Control selector found in ${network}.${contract} — detection is unsound, aborting.`,
        );
      }

      for (const entry of abi.filter((e) => e.type === "function")) {
        const sig = `function ${entry.name}(${entry.inputs.map(toType).join(",")})`;
        const selector = toFunctionSelector(sig).slice(2);
        report.checked += 1;
        if (!code.includes(selector)) {
        const key = `${network}.${contract}.${entry.name}`;
        report.missing.push({
          network,
          contract,
          address,
          fn: entry.name,
          selector: `0x${selector}`,
        });
        }
      }
      report.networks[network].push(contract);
    }

    // Identity: does this address agree about which Moolah it serves?
    const expectedMoolah = CONTRACT_ADDRESSES[network]?.moolah;
    for (const contract of IDENTITY_SUBJECTS) {
      const address = CONTRACT_ADDRESSES[network]?.[contract];
      if (!address || address === ZERO || !expectedMoolah) continue;
      try {
        const reported = await client.readContract({
          address,
          abi: MOOLAH_GETTER_ABI,
          functionName: "MOOLAH",
        });
        const ok =
          String(reported).toLowerCase() === expectedMoolah.toLowerCase();
        report.identity.push({ network, contract, ok, reported });
        if (!ok) {
          report.missing.push({
            network,
            contract,
            address,
            fn: "MOOLAH()",
            reason: `reports ${reported}, address book says ${expectedMoolah}`,
          });
        }
      } catch (err) {
        // A configured address that cannot answer MOOLAH() is a finding, not a
        // skip: either nothing is deployed there or it is a different
        // contract. Only a transport failure is excusable — otherwise the
        // check silently passes on exactly the typo it exists to catch.
        const transport =
          /HttpRequestError|TimeoutError|fetch failed|socket|ECONN/i.test(
            `${err.name} ${err.message}`,
          );
        if (transport) {
          // Unreachable, not skipped. Recording it as a skip let the run print
          // "9 contract identities confirmed" over a check that never
          // happened, and the exit code ignores skips.
          report.unreachable.push(
            `${network}.${contract} identity (rpc: ${err.shortMessage ?? err.message})`,
          );
        } else {
          report.identity.push({
            network,
            contract,
            ok: false,
            reported: null,
          });
          report.missing.push({
            network,
            contract,
            address,
            fn: "MOOLAH()",
            reason: `no readable MOOLAH() at this address (${err.shortMessage ?? err.message})`,
          });
        }
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const identityOk = report.identity.filter((i) => i.ok).length;
    console.log(
      `checked ${report.checked} selectors and ${report.identity.length} contract identities (${identityOk} confirmed)`,
    );
    for (const s of report.skipped) console.log(`  skip    ${s}`);
    for (const u of report.unreachable) console.log(`  UNREACHABLE ${u}`);
    for (const m of report.missing) {
      console.log(
        `  MISSING ${m.network}.${m.contract}.${m.fn} ${m.selector ?? ""} ${m.reason ?? ""}`,
      );
    }
    const reached = Object.keys(NETWORKS).filter(
      (n) => !report.unreachable.some((u) => u.startsWith(`${n}.`)),
    );
    console.log(
      report.missing.length === 0 && report.unreachable.length === 0
        ? `OK — every ABI function resolves on its configured deployment ` +
            `(${reached.join(", ")})`
        : report.unreachable.length > 0
          ? `FAILED — ${report.unreachable.length} subject(s) unreachable; ` +
            `this run proves nothing about them`
          : `FAILED — ${report.missing.length} selector(s) not found`,
    );
  }
  process.exit(
    report.missing.length === 0 && report.unreachable.length === 0 ? 0 : 1,
  );
}

/** Flatten a tuple input into its canonical signature form. */
function toType(input) {
  if (input.type.startsWith("tuple")) {
    const inner = input.components.map(toType).join(",");
    return `(${inner})${input.type.slice("tuple".length)}`;
  }
  return input.type;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
