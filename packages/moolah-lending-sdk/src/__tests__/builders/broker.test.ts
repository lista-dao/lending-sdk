import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PublicClient, Address } from "viem";
import {
  buildBrokerBorrowSteps,
  buildBrokerRepaySteps,
} from "../../builders/broker";

const mockReadContract = vi.fn();
const mockPublicClient = {
  readContract: mockReadContract,
} as unknown as PublicClient;

const BROKER_ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const LOAN_TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const WALLET = "0x3333333333333333333333333333333333333333" as Address;

describe("buildBrokerBorrowSteps", () => {
  it("should build borrow step without termId", () => {
    const steps = buildBrokerBorrowSteps({
      chainId: 56,
      brokerAddress: BROKER_ADDRESS,
      amount: 1000n * 10n ** 18n,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("brokerBorrow");
    expect(steps[0].params.to).toBe(BROKER_ADDRESS);
    expect(steps[0].params.functionName).toBe("borrow");
    expect(steps[0].params.args).toHaveLength(1);
    expect(steps[0].params.args[0]).toBe(1000n * 10n ** 18n);
  });

  it("should build borrow step with termId", () => {
    const steps = buildBrokerBorrowSteps({
      chainId: 56,
      brokerAddress: BROKER_ADDRESS,
      amount: 1000n * 10n ** 18n,
      termId: 1n,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].params.args).toHaveLength(2);
    expect(steps[0].params.args[0]).toBe(1000n * 10n ** 18n);
    expect(steps[0].params.args[1]).toBe(1n);
  });

  it("should handle string chainId", () => {
    const steps = buildBrokerBorrowSteps({
      chainId: "56",
      brokerAddress: BROKER_ADDRESS,
      amount: 1000n,
    });

    expect(steps[0].params.chainId).toBe("56");
  });
});

describe("buildBrokerRepaySteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockResolvedValue(0n);
  });

  it("should build repay step without approval", async () => {
    const steps = await buildBrokerRepaySteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 500n * 10n ** 18n,
        walletAddress: WALLET,
      },
      mockPublicClient,
      "bsc",
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("brokerRepay");
    expect(steps[0].params.functionName).toBe("repay");
  });

  it("should build repay step with approval when loanToken provided", async () => {
    const steps = await buildBrokerRepaySteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 500n * 10n ** 18n,
        loanToken: LOAN_TOKEN,
        walletAddress: WALLET,
      },
      mockPublicClient,
      "bsc",
    );

    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps.some((s) => s.step === "approve")).toBe(true);
    expect(steps.some((s) => s.step === "brokerRepay")).toBe(true);
  });

  it("should build repay step without posId", async () => {
    const steps = await buildBrokerRepaySteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 500n,
        walletAddress: WALLET,
      },
      mockPublicClient,
      "bsc",
    );

    const repayStep = steps.find((s) => s.step === "brokerRepay");
    expect(repayStep?.params.args).toHaveLength(2);
  });

  it("should build repay step with posId", async () => {
    const steps = await buildBrokerRepaySteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 500n,
        posId: 42n,
        walletAddress: WALLET,
      },
      mockPublicClient,
      "bsc",
    );

    const repayStep = steps.find((s) => s.step === "brokerRepay");
    expect(repayStep?.params.args).toHaveLength(3);
    expect(repayStep?.params.args[1]).toBe(42n);
  });

  it("should use onBehalf if provided", async () => {
    const onBehalf = "0x4444444444444444444444444444444444444444" as Address;
    const steps = await buildBrokerRepaySteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 500n,
        onBehalf,
        walletAddress: WALLET,
      },
      mockPublicClient,
      "bsc",
    );

    const repayStep = steps.find((s) => s.step === "brokerRepay");
    expect(repayStep?.params.args).toContain(onBehalf);
  });

  it("should use walletAddress as onBehalf when not provided", async () => {
    const steps = await buildBrokerRepaySteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 500n,
        walletAddress: WALLET,
      },
      mockPublicClient,
      "bsc",
    );

    const repayStep = steps.find((s) => s.step === "brokerRepay");
    expect(repayStep?.params.args).toContain(WALLET);
  });
});
