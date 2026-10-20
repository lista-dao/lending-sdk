import { describe, it, expect, vi } from "vitest";
import { brokerClient } from "./helpers/brokerClient.js";
import type { PublicClient } from "viem";
import { finalizeSteps, type DraftStep } from "../utils.js";
import { buildApproveSteps } from "../builders/approve.js";
import { buildBrokerRepaySteps } from "../builders/broker.js";

const TOKEN = "0x0000000000000000000000000000000000000011" as const;
const SPENDER = "0x0000000000000000000000000000000000000022" as const;
const OWNER = "0x0000000000000000000000000000000000000033" as const;

function clientWithAllowance(allowance: bigint): PublicClient {
  return {
    readContract: vi.fn().mockResolvedValue(allowance),
  } as unknown as PublicClient;
}

const draft = (step: string): DraftStep =>
  ({ step, params: {} }) as unknown as DraftStep;

describe("step sequencing", () => {
  it("numbers steps from zero, in order", () => {
    const steps = finalizeSteps([draft("approve"), draft("supply")]);
    expect(steps.map((s) => s.index)).toEqual([0, 1]);
  });

  it("is idempotent, so builders can embed other builders' output", () => {
    const once = finalizeSteps([draft("approve"), draft("supply")]);
    const twice = finalizeSteps(once);
    expect(twice.map((s) => s.index)).toEqual([0, 1]);
    expect(twice).toEqual(once);
  });

  it("renumbers when a list is composed into a longer one", () => {
    const inner = finalizeSteps([draft("approve")]);
    const outer = finalizeSteps([...inner, draft("repay")]);
    expect(outer.map((s) => [s.step, s.index])).toEqual([
      ["approve", 0],
      ["repay", 1],
    ]);
  });

  it("returns an empty array rather than a placeholder step", () => {
    expect(finalizeSteps([])).toEqual([]);
  });
});

describe("approve steps carry the state they were derived from", () => {
  const base = {
    chainId: 56,
    owner: OWNER,
    token: TOKEN,
    spender: SPENDER,
    amount: 1000n,
  };

  it("emits nothing when the existing allowance already covers the amount", async () => {
    const steps = await buildApproveSteps(
      base,
      clientWithAllowance(5000n),
      "bsc",
    );
    expect(steps).toEqual([]);
  });

  it("records the observed allowance on every emitted step", async () => {
    const steps = await buildApproveSteps(base, clientWithAllowance(0n), "bsc");
    expect(steps).toHaveLength(1);
    expect(steps[0].meta?.observedState).toEqual({ allowance: 0n });
    expect(steps[0].meta?.precondition).toBeTruthy();
    expect(steps[0].index).toBe(0);
  });

  it("emits the USDT reset pair in order, both carrying the observation", async () => {
    const steps = await buildApproveSteps(
      {
        ...base,
        token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      },
      clientWithAllowance(1n),
      "ethereum",
    );
    expect(steps.map((s) => [s.index, s.meta?.reset ?? false])).toEqual([
      [0, true],
      [1, false],
    ]);
    for (const step of steps) {
      expect(step.meta?.observedState).toEqual({ allowance: 1n });
    }
  });

  it("emits no steps for a zero amount without reading the chain", async () => {
    const client = clientWithAllowance(0n);
    const steps = await buildApproveSteps(
      { ...base, amount: 0n },
      client,
      "bsc",
    );
    expect(steps).toEqual([]);
    expect(client.readContract).not.toHaveBeenCalled();
  });
});

describe("composed builders produce one contiguous sequence", () => {
  it("indexes an approve step ahead of the action it enables", async () => {
    const steps = await buildBrokerRepaySteps(
      {
        chainId: 56,
        brokerAddress: SPENDER,
        amount: 100n,
        loanToken: TOKEN,
        walletAddress: OWNER,
      },
      brokerClient({ broker: SPENDER, network: "bsc" }),
      "bsc",
    );
    // Trailing approve is the clear: repay amounts carry headroom on purpose,
    // so the allowance outlives the repayment unless it is returned.
    expect(steps.map((s) => [s.step, s.index])).toEqual([
      ["approve", 0],
      ["brokerRepay", 1],
      ["approve", 2],
    ]);
  });
});
