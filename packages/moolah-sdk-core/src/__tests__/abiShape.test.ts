import { describe, it, expect } from "vitest";
import { MOOLAH_VAULT_ABI, PUBLIC_LIQUIDATOR_ABI } from "../index.js";

/**
 * Cheap sanity checks that specific ABI entries this SDK depends on are
 * still declared. `abi-conformance.mjs` proves each selector resolves in
 * the *deployed bytecode* — a different, stronger, but chain-dependent
 * question. This is the unit-level guard against a regeneration or a hand
 * edit silently dropping one of these entries from the local ABI array,
 * without needing an RPC endpoint to catch it. Restored after a wholesale
 * test-file deletion dropped it along with genuinely BSC-Testnet-specific
 * content elsewhere in that file — nothing here ever depended on a network.
 */
describe("the ABIs carry the views a caller needs to size a request", () => {
  // A Moolah vault is only as liquid as the markets underneath it. Without
  // maxWithdraw a caller cannot tell a liquidity bound from a bad call: the
  // withdrawal simply reverts.
  it("exposes every ERC-4626 ceiling on the vault", () => {
    const names = new Set(
      MOOLAH_VAULT_ABI.filter((e) => e.type === "function").map((e) => e.name),
    );
    for (const fn of ["maxDeposit", "maxMint", "maxWithdraw", "maxRedeem"]) {
      expect(names).toContain(fn);
    }
  });

  // The liquidator serves an admin-curated allowlist and refuses everything
  // else with NotWhitelisted(). Reading it is the difference between
  // refusing to build a doomed call and paying gas to discover the same
  // thing.
  it("exposes the liquidator's market allowlist", () => {
    const names = new Set(
      PUBLIC_LIQUIDATOR_ABI.filter((e) => e.type === "function").map(
        (e) => e.name,
      ),
    );
    expect(names).toContain("marketWhitelist");
  });

  it("can decode NotWhitelisted, so the revert is not a bare selector", () => {
    const errors = PUBLIC_LIQUIDATOR_ABI.filter((e) => e.type === "error").map(
      (e) => e.name,
    );
    expect(errors).toContain("NotWhitelisted");
  });
});
