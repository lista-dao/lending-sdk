#!/usr/bin/env node
/**
 * Verify what actually ships, not what the source tree says.
 *
 * Moving viem to a peer dependency fails in the *integrator's* build, not
 * ours: our CI resolves exactly one copy and is structurally blind to a second
 * one. So the check has to look at the published artifact — pack, extract,
 * and read the packed manifest. `npm pack --dry-run` lists files only and
 * cannot see dependency fields, which is why this packs for real.
 *
 * Checks per package:
 *   1. viem is declared as a peer dependency, with a range, not optional
 *   2. viem is absent from `dependencies` — a stray entry reintroduces the
 *      duplicate-copy hazard the peer move exists to remove
 *   3. every path in the `exports` map is present in the tarball, so a
 *      declared subpath cannot 404 at install time
 *   4. no workspace: protocol leaks into a published range
 *
 * Usage: node scripts/check-packaging.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PACKAGES = ["moolah-sdk-core", "moolah-lending-sdk"];
const failures = [];

const check = (pkg, name, ok, detail = "") => {
  if (!ok) failures.push(`${pkg}: ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${pkg}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
};

/** Every file path declared anywhere in an exports map. */
function exportedPaths(exportsField) {
  const out = [];
  const walk = (node) => {
    if (typeof node === "string") {
      if (node.startsWith("./")) out.push(node.slice(2));
      return;
    }
    if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(exportsField);
  return [...new Set(out)];
}

function packAndInspect(pkgName) {
  const pkgDir = resolve(`packages/${pkgName}`);
  const work = mkdtempSync(join(tmpdir(), `pack-${pkgName}-`));

  try {
    execFileSync("pnpm", ["pack", "--pack-destination", work], {
      cwd: pkgDir,
      stdio: "pipe",
    });
    const tarball = readdirSync(work).find((f) => f.endsWith(".tgz"));
    if (!tarball) throw new Error("pnpm pack produced no tarball");

    execFileSync("tar", ["-xzf", join(work, tarball), "-C", work], {
      stdio: "pipe",
    });
    const root = join(work, "package");
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    );

    const peer = manifest.peerDependencies?.viem;
    check(pkgName, "declares viem as a peer dependency", Boolean(peer), peer);
    check(
      pkgName,
      "viem peer range is a range, not a caret pin",
      typeof peer === "string" && peer.includes(">="),
      peer,
    );
    check(
      pkgName,
      "viem is not also a runtime dependency",
      manifest.dependencies?.viem === undefined,
      manifest.dependencies?.viem ?? "absent",
    );
    check(
      pkgName,
      "viem peer is required, not optional",
      manifest.peerDependenciesMeta?.viem?.optional !== true,
    );

    const workspaceLeaks = Object.entries(manifest.dependencies ?? {}).filter(
      ([, range]) => String(range).startsWith("workspace:"),
    );
    check(
      pkgName,
      "no workspace: protocol in published ranges",
      workspaceLeaks.length === 0,
      workspaceLeaks.map(([n]) => n).join(", "),
    );

    const declared = exportedPaths(manifest.exports);
    const packed = new Set();
    const walkDir = (dir, prefix = "") => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walkDir(join(dir, entry.name), rel);
        else packed.add(rel);
      }
    };
    walkDir(root);

    const missing = declared.filter((p) => !packed.has(p));
    check(
      pkgName,
      `every exported path is in the tarball (${declared.length} checked)`,
      declared.length > 0 && missing.length === 0,
      declared.length === 0
        ? "the manifest declares no exports, so this checked nothing"
        : missing.join(", "),
    );

    // Tests were shipping — roughly half the files in the tarball — because the
    // emit config included `src/__tests__`. Nothing in them is secret, but they
    // are published surface nobody asked for, and the count made it invisible.
    const strays = [...packed].filter((p) => /(^|\/)__tests__(\/|$)/.test(p));
    check(
      pkgName,
      `no test files in the tarball (${packed.size} files packed)`,
      strays.length === 0,
      strays.slice(0, 3).join(", "),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log("packing and inspecting published manifests ...");
for (const pkg of PACKAGES) packAndInspect(pkg);

console.log(
  failures.length === 0
    ? "\nOK — published packaging is correct"
    : `\nFAILED — ${failures.length} problem(s)`,
);
process.exit(failures.length === 0 ? 0 : 1);
