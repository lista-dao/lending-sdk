/**
 * Compile every TypeScript block in the docs.
 *
 * Three separate bugs have been filed for README examples that do not compile
 * — `writeContract(step.params)` against a step that names its target `to`
 * (BUG-SDK-001), four strict-mode errors across the quick-start and liquidation
 * sections (BUG-SDK-003), and `g.zones` typing as `unknown` because
 * `ApiMarketGroup` never declared the field. Each was found by a person
 * reading the file. Nothing in the repo compiles the examples, so there was
 * nothing to stop a fourth.
 *
 * The examples an integrator copies are as load-bearing as the code, and they
 * are the first thing anyone runs. This extracts each fenced block, gives it
 * the ambient values the prose implies, and type-checks the lot against the
 * project's own tsconfig.
 *
 * **The ambient declarations are real types on purpose.** An earlier one-off
 * version of this check declared `groups` as `any[]`, which is exactly what
 * hid the `zones` defect: `any` makes every property access legal, so the
 * harness passed while the documented snippet did not compile for a reader.
 * A stub here must be as specific as the thing it stands in for, or the check
 * is worse than nothing — it certifies what it cannot see.
 *
 * Usage: `node scripts/check-docs.mjs [--keep]`
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".docs-typecheck");
const KEEP = process.argv.includes("--keep");

const DOCS = [
  "README.md",
  "MIGRATION.md",
  "packages/moolah-lending-sdk/README.md",
  "packages/moolah-sdk-core/README.md",
];

/**
 * Values the prose supplies before a snippet starts.
 *
 * Every one is the type the real thing has. Adding an entry is how you teach
 * the check about a new example; widening one to `any` defeats it.
 */
const AMBIENT = {
  // values
  sdk: `const sdk: import("@lista-dao/moolah-lending-sdk").MoolahSDK`,
  steps: `const steps: import("@lista-dao/moolah-lending-sdk").StepParam[]`,
  step: `const step: import("@lista-dao/moolah-lending-sdk").StepParam`,
  groups: `const groups: import("@lista-dao/moolah-sdk-core").ApiMarketGroup[]`,
  group: `const group: import("@lista-dao/moolah-sdk-core").ApiMarketGroup`,
  userData: `const userData: Awaited<ReturnType<import("@lista-dao/moolah-lending-sdk").MoolahSDK["getMarketUserData"]>>`,
  walletClient: `const walletClient: import("viem").WalletClient<import("viem").Transport, import("viem").Chain, import("viem").Account>`,
  publicClient: `const publicClient: import("viem").PublicClient`,
  myViemClient: `const myViemClient: import("viem").PublicClient`,
  marketId: "const marketId: `0x${string}`",
  vaultAddress: `const vaultAddress: import("viem").Address`,
  walletAddress: `const walletAddress: import("viem").Address`,
  userAddress: `const userAddress: import("viem").Address`,
  borrower: `const borrower: import("viem").Address`,
  loanToken: `const loanToken: import("viem").Address`,
  brokerAddress: `const brokerAddress: import("viem").Address`,
  positionManager: `const positionManager: import("viem").Address`,
  somethingElse: `const somethingElse: import("viem").Address`,
  seizedAssets: "const seizedAssets: bigint",
  rawCollateral: "const rawCollateral: bigint",
  amount: `const amount: import("@lista-dao/moolah-sdk-core").Decimal`,
  onBehalf: `const onBehalf: import("viem").Address`,
  receiver: `const receiver: import("viem").Address`,
  chainId: "const chainId: 56",
  // `types: []` keeps @types/node out, and the project targets no DOM lib.
  console: "const console: { log(...args: unknown[]): void; error(...args: unknown[]): void }",
  ratePerSecond: "const ratePerSecond: bigint",
  utilization: "const utilization: bigint",
  rateAtTarget: "const rateAtTarget: bigint",
  lastUpdate: "const lastUpdate: number",
  fee: "const fee: bigint",
  brokerPositions: `const brokerPositions: Awaited<ReturnType<import("@lista-dao/moolah-lending-sdk").MoolahSDK["getBrokerUserPositions"]>>`,
  position: `const position: import("@lista-dao/moolah-sdk-core").FixedLoanPosition`,
  // classes and functions, referenced as values
  Decimal: `const Decimal: typeof import("@lista-dao/moolah-sdk-core").Decimal`,
  MoolahSDK: `const MoolahSDK: typeof import("@lista-dao/moolah-lending-sdk").MoolahSDK`,
  parseUnits: `const parseUnits: typeof import("viem").parseUnits`,
  buildSetAuthorizationSteps: `const buildSetAuthorizationSteps: typeof import("@lista-dao/moolah-lending-sdk/builders").buildSetAuthorizationSteps`,
  brokerPositionsToUserFixedTermData: `const brokerPositionsToUserFixedTermData: typeof import("@lista-dao/moolah-sdk-core").brokerPositionsToUserFixedTermData`,
  // types
  Address: `type Address = import("viem").Address`,
  Abi: `type Abi = import("viem").Abi`,
  ChainId: `type ChainId = import("@lista-dao/moolah-lending-sdk").ChainId`,
};

/** Pull every ```typescript / ```ts block out of a markdown file. */
function blocksOf(markdown) {
  const out = [];
  const re = /```(?:typescript|ts)([^\n]*)\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const line = markdown.slice(0, m.index).split("\n").length;
    // Anything after the language — `\`\`\`ts no-check` — opts the block out.
    // It lives in the fence rather than in a comment so a reader of the
    // rendered page never sees the plumbing.
    out.push({ code: m[2], line, optOut: m[1].trim() !== "" });
  }
  return out;
}

/** Names the block binds itself — ambient declarations must not shadow them. */
function boundNames(code) {
  const names = new Set();
  for (const m of code.matchAll(
    /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
  ))
    names.add(m[1]);
  // `const { to, data } = …` and `const [a, b] = …`
  for (const m of code.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g))
    for (const part of m[1].split(","))
      names.add(part.split(":").pop().trim().replace(/^\.\.\./, ""));
  for (const m of code.matchAll(/\bimport\s*\{([^}]*)\}/g))
    for (const part of m[1].split(","))
      names.add(part.split(/\s+as\s+/).pop().trim());
  for (const m of code.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from/g))
    names.add(m[1]);
  names.delete("");
  return names;
}

// The snippets import the packages by name, which resolves through each
// `exports` map into `dist` — not `src`. So this checks the docs against the
// *built* types, and a stale or missing build silently checks the wrong thing.
for (const pkg of ["moolah-sdk-core", "moolah-lending-sdk"]) {
  if (!existsSync(join(ROOT, "packages", pkg, "dist", "index.d.ts"))) {
    console.error(
      `packages/${pkg}/dist is missing — run \`pnpm build\` first.\n` +
        `These snippets resolve the packages through their exports map, so ` +
        `without a build they would be checked against nothing.`,
    );
    process.exit(1);
  }
}

const files = [];
let skipped = 0;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const doc of DOCS) {
  let markdown;
  try {
    markdown = readFileSync(join(ROOT, doc), "utf8");
  } catch {
    continue;
  }
  blocksOf(markdown).forEach(({ code, line, optOut }, i) => {
    // A block opts out when it illustrates a shape rather than offering
    // something to copy — an API diff written with `{ ..., assets: 100n }` is
    // prose, and forcing it to compile would mean rewriting it into something
    // less clear.
    if (optOut) {
      skipped++;
      return;
    }
    const bound = boundNames(code);
    const prelude = Object.entries(AMBIENT)
      .filter(([name]) => !bound.has(name) && new RegExp(`\\b${name}\\b`).test(code))
      .map(([, decl]) => `declare ${decl};`)
      .join("\n");

    const name = `${doc.replace(/[/.]/g, "_")}__${i}.ts`;
    writeFileSync(
      join(OUT, name),
      `${prelude}\n${code}\nexport {};\n`,
      "utf8",
    );
    files.push({ name, doc, line });
  });
}

writeFileSync(
  join(OUT, "tsconfig.json"),
  JSON.stringify(
    {
      extends: "../tsconfig.json",
      compilerOptions: {
        noEmit: true,
        // The only rule relaxed, and only because a documentation fragment
        // legitimately ends after declaring something — the reader is what
        // uses it next. `strict` and `noImplicitAny`, which are what every
        // defect this check exists for tripped, stay on.
        noUnusedLocals: false,
        composite: false,
        declaration: false,
        declarationMap: false,
        types: [],
      },
      include: ["*.ts"],
    },
    null,
    2,
  ),
  "utf8",
);

console.log(
  `checking ${files.length} TypeScript blocks from ${DOCS.length} documents` +
    (skipped ? ` (${skipped} opted out)` : ""),
);

try {
  execFileSync(
    "node",
    [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(OUT, "tsconfig.json")],
    { cwd: ROOT, stdio: "pipe", encoding: "utf8" },
  );
  console.log("OK — every documented example compiles");
  if (!KEEP) rmSync(OUT, { recursive: true, force: true });
} catch (err) {
  const raw = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
  // tsc reports the generated file; say which document and which block, since
  // that is what has to be edited.
  const mapped = raw.replace(/^([^\s(]+)\((\d+),/gm, (whole, file, lineNo) => {
    // Exact basename: `packages/..._README_md__3.ts` also *ends with*
    // `README_md__3.ts`, so a loose match blames the root README for a
    // package README's error.
    const base = file.split(/[\\/]/).pop();
    const hit = files.find((f) => base === f.name);
    return hit
      ? `${hit.doc} (block starting at line ${hit.line}), generated line ${lineNo}:`
      : whole;
  });
  console.error(mapped || "tsc failed with no output");
  console.error(
    `\nGenerated sources kept at ${relative(ROOT, OUT)} — rerun with --keep to inspect them.`,
  );
  if (!KEEP) rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
}
