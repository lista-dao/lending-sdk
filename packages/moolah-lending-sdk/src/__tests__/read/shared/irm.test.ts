import { describe, it, expect, vi } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  type PublicClient,
} from "viem";
import { classifyIrm } from "../../../read/shared/irm.js";

/**
 * Restored after a wholesale test-file deletion (`chainFindings.test.ts`)
 * dropped this describe block along with content that genuinely was
 * BSC-Testnet-specific elsewhere in that file. `classifyIrm` takes no
 * network at all — nothing here ever depended on which chain, only on the
 * IRM's own behaviour — so nothing needed to change to bring it back.
 *
 * The bug this guards against: a live Smart Lending market pointed at a
 * FixedRateIrm deployment in neither address-book slot. Classifying by
 * address alone put it on the adaptive-curve path, `rateAtTarget` reverted,
 * and the entire market read failed.
 */

const IRM = "0x5c62dFe696382806f548622a314ACa66E755462A" as const;
const MARKET =
  "0x058073a21fea8dd3aa250713a56ad7526cc27c8f74e85f5433821c6fe5d03e1b" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const reverted = () =>
  new BaseError("The contract function reverted.", {
    cause: new ContractFunctionRevertedError({
      abi: [],
      functionName: "rateAtTarget",
    }),
  });

const client = (rateAtTarget: "ok" | "reverts" | "unreachable") =>
  ({
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName !== "rateAtTarget") return 0n;
      if (rateAtTarget === "ok") return 40_476_150n;
      if (rateAtTarget === "reverts") throw reverted();
      throw new Error("HTTP request failed. Status: 429");
    }),
  }) as unknown as PublicClient;

describe("classifyIrm — behavioural classification, not address lookup", () => {
  it("calls an unknown IRM fixed-rate when rateAtTarget reverts", async () => {
    const reading = await classifyIrm(client("reverts"), IRM, MARKET, ZERO);
    expect(reading.isFixedRate).toBe(true);
    expect(reading.classifiedBy).toBe("probe");
    expect(reading.rateAtTarget).toBe(0n);
  });

  it("calls an unknown IRM adaptive-curve when rateAtTarget answers", async () => {
    const reading = await classifyIrm(client("ok"), IRM, MARKET, ZERO);
    expect(reading.isFixedRate).toBe(false);
    expect(reading.rateAtTarget).toBe(40_476_150n);
  });

  // The defect this guards: a rate-limited node rejects the same way a
  // revert does. Treating that as evidence would silently reclassify a live
  // adaptive market as fixed-rate. The error must reach the caller, who can
  // retry it.
  it("does not mistake an unreachable node for a fixed-rate IRM", async () => {
    await expect(
      classifyIrm(client("unreachable"), IRM, MARKET, ZERO),
    ).rejects.toThrow(/429/);
  });

  it("short-circuits the probe on an address-book match", async () => {
    const c = client("ok");
    const reading = await classifyIrm(c, IRM, MARKET, IRM);
    expect(reading.isFixedRate).toBe(true);
    expect(reading.classifiedBy).toBe("address");
    const calls = (c.readContract as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ functionName: string }]>;
    expect(calls.some(([a]) => a.functionName === "rateAtTarget")).toBe(false);
  });

  // But it still reads the cap and the floor. Skipping those on the fast
  // path lost the real values for every fixed-rate market the address book
  // names.
  it("still reads the cap and floor on an address-book match", async () => {
    const c = client("ok");
    await classifyIrm(c, IRM, MARKET, IRM);
    const called = (
      (c.readContract as ReturnType<typeof vi.fn>).mock.calls as Array<
        [{ functionName: string }]
      >
    ).map(([a]) => a.functionName);
    expect(called).toContain("rateCap");
    expect(called).toContain("rateFloor");
  });

  it("matches the address book case-insensitively", async () => {
    const reading = await classifyIrm(
      client("ok"),
      IRM.toLowerCase() as `0x${string}`,
      MARKET,
      IRM,
    );
    expect(reading.isFixedRate).toBe(true);
  });
});
