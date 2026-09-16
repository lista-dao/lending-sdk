#!/usr/bin/env node
/**
 * Measure how far the SDK has drifted from the reference frontend.
 *
 * This exists because the gap it closes reopened silently once already: the
 * repo sat untouched for six months while the frontend kept shipping, and the
 * only way anyone noticed was a manual audit. A parity release without a
 * parity meter is an event, not a capability.
 *
 * The frontend lives on a different host, so recurrence and freshness are
 * decoupled deliberately: this runs on every CI pass against a committed
 * snapshot, and the snapshot's age is itself checked. A stale snapshot warns
 * loudly and eventually fails. A webhook, by contrast, fails silently — which
 * is the exact failure this is meant to catch.
 *
 * What it measures is *presence*: a frontend write with no SDK builder. It
 * cannot see a builder that exists but encodes different arguments — that is
 * what the ABI conformance and calldata tests are for. Do not read a zero here
 * as "the SDK is correct"; read it as "nothing is missing".
 *
 * Usage: node scripts/parity-check.mjs [--json]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const WARN_AFTER_DAYS = 30;
const FAIL_AFTER_DAYS = 90;

// Resolved against the repo root (this script's own location), not
// process.cwd(). Every other script here uses import.meta.dirname for the
// same reason: `resolve("packages/...")` only finds these paths when the
// process happens to be launched from the repo root, and breaks silently —
// wrong files, not an error — from anywhere else.
const ROOT = resolve(import.meta.dirname, "..");
const BUILDERS_DIR = resolve(ROOT, "packages/moolah-lending-sdk/src/builders");
const SNAPSHOT = resolve(ROOT, "parity/frontend-write-surface.json");
const ALLOWLIST = resolve(ROOT, "parity/allowlist.json");

/**
 * Which SDK contract a builder's target belongs to.
 *
 * Builders name their target by ABI constant, which is the closest thing the
 * source has to a contract identity.
 */
const ABI_TO_CONTRACT = {
  ERC20_APPROVE_ABI: "erc20",
  ERC20_ABI: "erc20",
  MOOLAH_ABI: "moolah",
  MOOLAH_VAULT_ABI: "moolahVault",
  SMART_PROVIDER_ABI: "smartProvider",
  LENDING_BROKER_ABI: "lendingBroker",
  PUBLIC_LIQUIDATOR_ABI: "publicLiquidator",
  POSITION_MANAGER_ABI: "positionManager",
  NATIVE_PROVIDER_ABI: "nativeProvider",
};

/** Every (contract, fn) pair the SDK can build calldata for. */
function sdkWriteSurface() {
  const found = new Set();
  for (const file of readdirSync(BUILDERS_DIR)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(join(BUILDERS_DIR, file), "utf8");
    // buildCallParams({ ... abi: X_ABI, functionName: "y" ... }) — abi and
    // functionName are always adjacent literals in these call sites.
    const re = /abi:\s*([A-Z_0-9]+)\s*,\s*functionName:\s*"([A-Za-z0-9_]+)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const contract = ABI_TO_CONTRACT[m[1]];
      if (contract) found.add(`${contract}.${m[2]}`);
    }
  }
  return found;
}

function daysSince(iso) {
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

function main() {
  const asJson = process.argv.includes("--json");
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const allowlist = JSON.parse(readFileSync(ALLOWLIST, "utf8"));

  const allowed = new Map(
    (allowlist.omissions ?? []).map((o) => [`${o.contract}.${o.fn}`, o.reason]),
  );
  const sdk = sdkWriteSurface();

  const missing = [];
  const excused = [];
  for (const { contract, fn } of snapshot.writes) {
    const key = `${contract}.${fn}`;
    if (sdk.has(key)) continue;
    if (allowed.has(key)) excused.push({ key, reason: allowed.get(key) });
    else missing.push(key);
  }

  const age = daysSince(snapshot.generatedAt);
  const stale = age > FAIL_AFTER_DAYS;
  const aging = age > WARN_AFTER_DAYS;

  const report = {
    generatedAt: snapshot.generatedAt,
    snapshotAgeDays: age,
    frontendWrites: snapshot.writes.length,
    sdkWrites: sdk.size,
    missing,
    excused,
    stale,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `frontend writes: ${snapshot.writes.length}  |  SDK writes: ${sdk.size}  |  snapshot age: ${age}d`,
    );
    for (const e of excused) console.log(`  allowed  ${e.key} — ${e.reason}`);
    for (const key of missing) console.log(`  MISSING  ${key}`);
    if (stale) {
      console.log(
        `  STALE    snapshot is ${age} days old (fails past ${FAIL_AFTER_DAYS})`,
      );
    } else if (aging) {
      console.log(
        `  warning  snapshot is ${age} days old; regenerate it past ${FAIL_AFTER_DAYS}`,
      );
    }
    console.log(
      missing.length === 0 && !stale
        ? "OK — no unexplained gap against the frontend"
        : `FAILED — ${missing.length} unexplained gap(s)${stale ? ", snapshot stale" : ""}`,
    );
  }

  writeFileSync("parity-report.json", JSON.stringify(report, null, 2));
  process.exit(missing.length === 0 && !stale ? 0 : 1);
}

main();
