#!/usr/bin/env node
/**
 * Regenerate parity/frontend-write-surface.json from a lista-mono checkout.
 *
 * Every frontend write goes through one wrapper, and every call site has the
 * same shape: `<contract>.<method>(...).execute()`. That makes the method name
 * mechanically recoverable. The contract behind it is not — the variable
 * holding it may have been built several lines earlier, or picked by a
 * ternary — so instead of parsing TypeScript we disambiguate against the
 * frontend's own ABIs: a method belongs to the contract whose ABI declares it
 * as a state-changing function and whose `ContractNames` member appears in the
 * same file.
 *
 * That is a heuristic, and it is deliberately a loud one: a method that
 * resolves to no contract, or to more than one, is reported rather than
 * guessed at. Review those by hand before committing the snapshot.
 *
 * Usage:
 *   node scripts/extract-frontend-write-surface.mjs [--frontend <path>] [--write]
 *
 * Defaults to ../../lista-mono relative to this repo. Pass --write to update
 * the snapshot in place; otherwise it prints a diff against the committed one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const FRONTEND = resolve(
  flag("--frontend", process.env.LISTA_MONO_PATH ?? "../../lista-mono"),
);
const WRITE = args.includes("--write");
const SNAPSHOT = resolve("parity/frontend-write-surface.json");

if (!existsSync(FRONTEND)) {
  console.error(
    `frontend checkout not found at ${FRONTEND}\n` +
      `pass --frontend <path> or set LISTA_MONO_PATH`,
  );
  process.exit(2);
}

const ABI_DIR = join(FRONTEND, "packages/onchain/src/configuration/abis");
const APP_DIR = join(FRONTEND, "apps/lista/src");

/** ContractNames member -> the key used in our snapshot. */
const CONTRACT_ALIASES = {
  Moolah: "moolah",
  MoolahVault: "moolahVault",
  MoolahPublicLiquidation: "publicLiquidator",
  PositionManager: "positionManager",
  SmartProvider: "smartProvider",
  lendingBroker: "lendingBroker",
  nativeProvider: "nativeProvider",
  WBNB: "wbnb",
  ERC20: "erc20",
  TetherToken: "erc20",
};

/** Snapshot key -> the ABI file that declares that contract's functions. */
const CONTRACT_ABI_FILE = {
  moolah: "Moolah.abi.ts",
  moolahVault: "MoolahVault.abi.ts",
  publicLiquidator: "lendingPublicLiquidation.abi.ts",
  positionManager: "PositionManager.abi.ts",
  smartProvider: "SmartProvider.abi.ts",
  lendingBroker: "lendingBroker.abi.ts",
  nativeProvider: "BNBProvider.abi.ts",
  wbnb: "WBNB.abi.ts",
  erc20: "ERC20.abi.ts",
};

/** Load an ABI from the frontend's TS source and keep only its writes. */
function loadWrites(file) {
  const path = join(ABI_DIR, file);
  if (!existsSync(path)) return new Set();
  const body = readFileSync(path, "utf8")
    .replace(/^export const [A-Za-z0-9_]+ *= */m, "")
    .replace(/ as const/g, "")
    .replace(/;\s*$/, "");
  let abi;
  try {
    abi = new Function(`return (${body})`)();
  } catch {
    return new Set();
  }
  return new Set(
    abi
      .filter(
        (e) =>
          e.type === "function" &&
          (e.stateMutability === "nonpayable" ||
            e.stateMutability === "payable"),
      )
      .map((e) => e.name),
  );
}

const WRITES_BY_CONTRACT = Object.fromEntries(
  Object.entries(CONTRACT_ABI_FILE).map(([k, f]) => [k, loadWrites(f)]),
);

/** Method names whose call is immediately followed by `.execute(`. */
function methodsBeforeExecute(src) {
  const names = [];
  const re = /\)\s*\.execute\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // m.index points at the ")" closing the method call.
    let depth = 0;
    let i = m.index;
    for (; i >= 0; i -= 1) {
      const ch = src[i];
      if (ch === ")") depth += 1;
      else if (ch === "(") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (i < 0) continue;
    const before = src.slice(Math.max(0, i - 80), i);
    const name = before.match(/\.([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (name) names.push(name[1]);
  }
  return names;
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

const found = new Map(); // "contract.fn" -> Set of files
const ambiguous = [];
const unresolved = [];

for (const file of sourceFiles(APP_DIR)) {
  const src = readFileSync(file, "utf8");
  if (!src.includes(".execute(")) continue;

  const contractsInFile = new Set();
  for (const m of src.matchAll(/ContractNames\.([A-Za-z0-9_]+)/g)) {
    const alias = CONTRACT_ALIASES[m[1]];
    if (alias) contractsInFile.add(alias);
  }
  // Every write goes through an ERC20 approve somewhere, and the approve
  // helpers do not always name ContractNames.ERC20 locally.
  if (/\.approve\(/.test(src)) contractsInFile.add("erc20");
  if (contractsInFile.size === 0) continue;

  // Find each `.execute(`, then walk back from the `)` that precedes it to
  // its matching `(` and read the identifier in front. A regex cannot do this:
  // in `xs.forEach(x => c.foo(a).execute())` a lazy match captures `forEach`,
  // because the first `)` it can pair with `.execute(` belongs to `foo(a)`.
  for (const fn of methodsBeforeExecute(src)) {
    const owners = [...contractsInFile].filter((c) =>
      WRITES_BY_CONTRACT[c]?.has(fn),
    );
    const rel = file.slice(FRONTEND.length + 1);

    if (owners.length === 1) {
      const key = `${owners[0]}.${fn}`;
      if (!found.has(key)) found.set(key, new Set());
      found.get(key).add(rel);
    } else if (owners.length > 1) {
      // Not a failure to disambiguate: these call sites hold whichever
      // contract the market dictates (`moolahOrProvider.repay(...)`), so every
      // candidate is genuinely reachable and all of them belong in the surface.
      for (const owner of owners) {
        const key = `${owner}.${fn}`;
        if (!found.has(key)) found.set(key, new Set());
        found.get(key).add(rel);
      }
      ambiguous.push({ fn, candidates: owners, file: rel });
    } else {
      unresolved.push({ fn, file: rel });
    }
  }
}

const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: FRONTEND,
  encoding: "utf8",
}).trim();

const writes = [...found.keys()].sort().map((k) => {
  const [contract, fn] = k.split(".");
  return { contract, fn };
});

const snapshot = {
  $comment:
    "Every on-chain write the reference lending frontend performs. Generated by scripts/extract-frontend-write-surface.mjs from a lista-mono checkout: call sites have the shape <contract>.<method>(...).execute(), and the contract is resolved by matching the method against the frontend's own ABIs.",
  source: {
    repo: "lista-mono",
    host: "git.toolsapple.net",
    ref: "main",
    commit: head,
    method: "extract-frontend-write-surface.mjs",
  },
  generatedAt: new Date().toISOString(),
  writes,
};

console.log(
  `resolved ${writes.length} writes from ${FRONTEND} @ ${head.slice(0, 8)}`,
);
for (const { contract, fn } of writes) console.log(`  ${contract}.${fn}`);

if (ambiguous.length) {
  const seen = new Set();
  console.log(
    "\nrecorded under every candidate — the call site holds whichever contract the market dictates:",
  );
  for (const a of ambiguous) {
    const key = `${a.fn}:${a.candidates.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${a.fn}  ->  ${a.candidates.join(", ")}`);
  }
}
if (unresolved.length) {
  const byFn = new Map();
  for (const u of unresolved) {
    if (!byFn.has(u.fn)) byFn.set(u.fn, []);
    byFn.get(u.fn).push(u.file);
  }
  console.log(
    "\nunresolved — no in-scope contract's ABI declares these as writes:",
  );
  for (const [fn, files] of byFn)
    console.log(`  ${fn}  (${files.length} site(s), e.g. ${files[0]})`);

  // Refuse to write a snapshot that silently drops them. An unresolved write is
  // a frontend call this extractor could not attribute to a contract — leaving
  // it out makes the parity comparator report "no gap" over a gap it was never
  // told about, which is the one way that check can produce a confident false
  // negative. Add the contract to the in-scope list, or record the write in
  // parity/allowlist.json with a reason.
  if (WRITE) {
    console.error(
      "\nrefusing to write the snapshot: " +
        `${byFn.size} unresolved write(s) would vanish from parity coverage.`,
    );
    process.exit(1);
  }
}

if (WRITE) {
  const previous = existsSync(SNAPSHOT)
    ? JSON.parse(readFileSync(SNAPSHOT, "utf8")).writes.map(
        (w) => `${w.contract}.${w.fn}`,
      )
    : [];
  const current = writes.map((w) => `${w.contract}.${w.fn}`);
  const added = current.filter((k) => !previous.includes(k));
  const removed = previous.filter((k) => !current.includes(k));
  writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`\nsnapshot written. added: ${added.join(", ") || "none"}`);
  console.log(`removed: ${removed.join(", ") || "none"}`);
} else {
  console.log("\n(dry run — pass --write to update the snapshot)");
}
