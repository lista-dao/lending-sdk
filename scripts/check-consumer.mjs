/**
 * Install the packages the way npm will ship them, and typecheck a consumer.
 *
 * `check-packaging.mjs` reads the tarball's manifest and file list: it proves
 * every declared export path exists. It cannot prove the published `.d.ts`
 * files are usable, because nothing outside this repo ever compiles against
 * them — inside the workspace, TypeScript reads `src/`.
 *
 * That gap shipped a real defect. `initMoolahSDK` was annotated with an inline
 * `import("./types")`, TypeScript carried the extensionless specifier into
 * `index.d.ts`, and every consumer on `moduleResolution: node16`/`nodenext`
 * without `skipLibCheck` got TS2835 from inside our own types — a build
 * failure they have no way to fix.
 *
 * So: pack, install into a throwaway project, and compile a file that imports
 * from every subpath, with `skipLibCheck: false` so our declarations are
 * actually checked. Then run it — because types compiling is not the same as
 * a module graph that loads — by asking `tsc` to emit plain JS and executing
 * that with `node`, not `--experimental-strip-types`. That flag needs Node
 * 22.6+; CI and the release workflow both pin Node 20, where it is a
 * "bad option" and this check failed outright. Type-stripping was never
 * something this check needed to prove — only the compiled output loading —
 * so it is gone.
 *
 * Uses `pnpm pack`, which rewrites `workspace:*` to a real range the way
 * `pnpm publish` does. `npm pack` does not, and a consumer installing that
 * tarball fails with "Unsupported URL Type workspace:".
 *
 * Usage: node scripts/check-consumer.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES = ["moolah-sdk-core", "moolah-lending-sdk"];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The file a new integrator writes: one import from every published subpath. */
const CONSUMER = `import { MoolahSDK, initMoolahSDK, buildCancelSignedAuthorizationTypedData } from "@lista-dao/moolah-lending-sdk";
import { buildApproveSteps } from "@lista-dao/moolah-lending-sdk/builders";
import { Decimal, getContractAddress, type NetworkName } from "@lista-dao/moolah-sdk-core";
import { toDisplayAmount, parseUiMultiplier } from "@lista-dao/moolah-sdk-core/display";
import { MOOLAH_ABI } from "@lista-dao/moolah-sdk-core/abis";

const net: NetworkName = "bsc";
const sdk = new MoolahSDK({ rpcUrls: { 56: "https://bsc-dataseed.binance.org" } });
const also = initMoolahSDK({ rpcUrls: { 56: "https://bsc-dataseed.binance.org" } });

const must = (label: string, ok: boolean) => {
  if (!ok) throw new Error(label);
};

// Values, not literal-typed comparisons: the published types are precise
// enough that \`MOOLAH_ABI.length === 0\` is a compile error, not a check.
const abiEntries: number = MOOLAH_ABI.length;

must("address", getContractAddress(net, "moolah").startsWith("0x"));
must("abi", abiEntries > 0);
must("decimal string", Decimal.parse("123.456", 18).toFixed(3) === "123.456");
must("decimal number", Decimal.parse(123.456, 18).toFixed(3) === "123.456");
must("display", toDisplayAmount(100n, parseUiMultiplier("1")) !== undefined);
must("sdk method", typeof sdk.buildLiquidateParams === "function");
must("init helper", typeof also.buildLiquidateParams === "function");
must("signed-authorization cancellation builder", typeof buildCancelSignedAuthorizationTypedData === "function");
must("builders subpath", typeof buildApproveSteps === "function");
console.log("consumer ok");
`;

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    noEmit: true,
    // The whole point: check the .d.ts files we publish.
    skipLibCheck: false,
  },
  include: ["src/**/*.ts"],
};

/**
 * A second, emit-enabled config for the same source. Kept separate from
 * TSCONFIG rather than toggled, so the type-check step's `noEmit: true` is
 * never accidentally weakened by whatever the run step needs.
 */
const TSCONFIG_EMIT = {
  compilerOptions: {
    ...TSCONFIG.compilerOptions,
    noEmit: false,
    declaration: false,
    outDir: "dist",
  },
  include: ["src/**/*.ts"],
};

let dir;
try {
  dir = mkdtempSync(join(tmpdir(), "moolah-consumer-"));
  const app = join(dir, "app");
  mkdirSync(join(app, "src"), { recursive: true });

  const tarballs = {};
  for (const pkg of PACKAGES) {
    run("pnpm", ["pack", "--pack-destination", dir], join(ROOT, "packages", pkg));
  }
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".tgz")) continue;
    if (file.includes("lending-sdk")) tarballs.lending = file;
    else if (file.includes("sdk-core")) tarballs.core = file;
  }
  check(
    "both packages pack",
    Boolean(tarballs.core && tarballs.lending),
    [tarballs.core, tarballs.lending].filter(Boolean).join(", "),
  );
  if (!tarballs.core || !tarballs.lending) throw new Error("pack failed");

  writeFileSync(
    join(app, "package.json"),
    JSON.stringify(
      {
        name: "moolah-consumer-check",
        private: true,
        version: "1.0.0",
        type: "module",
        dependencies: {
          "@lista-dao/moolah-sdk-core": `file:../${tarballs.core}`,
          "@lista-dao/moolah-lending-sdk": `file:../${tarballs.lending}`,
          viem: "^2.22.10",
        },
        devDependencies: { typescript: "5.9.2" },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(app, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2));
  writeFileSync(
    join(app, "tsconfig.emit.json"),
    JSON.stringify(TSCONFIG_EMIT, null, 2),
  );
  writeFileSync(join(app, "src", "main.ts"), CONSUMER);

  run("npm", ["install", "--no-audit", "--no-fund", "--silent"], app);
  check("a clean npm install resolves both tarballs", true);

  let tscOut = "";
  let tscOk = true;
  try {
    run(join(app, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], app);
  } catch (error) {
    tscOk = false;
    tscOut = String(error.stdout ?? error.message)
      .split("\n")
      .filter(Boolean)
      .slice(0, 4)
      .join(" | ");
  }
  check(
    "a consumer compiles against the published types (nodenext, skipLibCheck off)",
    tscOk,
    tscOut,
  );

  let runOk = true;
  let runOut = "";
  try {
    // Compile to plain JS rather than asking `node` to strip types itself —
    // `--experimental-strip-types` needs Node 22.6+, and this has to run
    // wherever CI does, which is pinned to Node 20.
    run(
      join(app, "node_modules", ".bin", "tsc"),
      ["-p", "tsconfig.emit.json"],
      app,
    );
    runOut = run(process.execPath, ["dist/main.js"], app).trim();
  } catch (error) {
    runOk = false;
    runOut = String(error.stdout ?? error.stderr ?? error.message)
      .split("\n")
      .filter(Boolean)
      .slice(0, 3)
      .join(" | ");
  }
  check("the published module graph actually loads", runOk && runOut.includes("consumer ok"), runOut);
} catch (error) {
  check("consumer check completed", false, String(error.message).slice(0, 200));
} finally {
  if (dir) rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? "\nOK — the published packages install, compile and load for a consumer"
    : `\nFAILED — ${failed.length} of ${results.length} consumer checks`,
);
process.exit(failed.length === 0 ? 0 : 1);
