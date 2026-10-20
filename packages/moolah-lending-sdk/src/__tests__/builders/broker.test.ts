import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getContractAddress,
  LENDING_BROKER_ABI,
} from "@lista-dao/moolah-sdk-core";
import { decodeFunctionData, type PublicClient, type Address } from "viem";
import {
  buildBrokerBorrowSteps,
  buildBrokerRepaySteps,
  buildBrokerRepayAllSteps,
  buildConvertDynamicToFixedSteps,
  buildBrokerRefinanceMaturedSteps,
} from "../../builders/broker.js";

const decode = (data: `0x${string}`) =>
  decodeFunctionData({ abi: LENDING_BROKER_ABI, data });

const mockReadContract = vi.fn();
const mockPublicClient = {
  readContract: mockReadContract,
} as unknown as PublicClient;

const BROKER_ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const MARKET_ID =
  "0x058073a21fea8dd3aa250713a56ad7526cc27c8f74e85f5433821c6fe5d03e1b" as const;
const LOAN_TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const WALLET = "0x3333333333333333333333333333333333333333" as Address;

const brokerAware = async ({ functionName }: { functionName: string }) => {
  if (functionName === "MARKET_ID") return MARKET_ID;
  if (functionName === "MOOLAH") return getContractAddress("bsc", "moolah");
  if (functionName === "brokers") return BROKER_ADDRESS;
  return 0n;
};

describe("buildBrokerBorrowSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(brokerAware);
  });

  it("should build borrow step without termId", async () => {
    const steps = await buildBrokerBorrowSteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 1000n * 10n ** 18n,
      },
      mockPublicClient,
      "bsc",
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("brokerBorrow");
    expect(steps[0].params.to).toBe(BROKER_ADDRESS);
    expect(steps[0].params.functionName).toBe("borrow");
    expect(steps[0].params.args).toHaveLength(1);
    expect(steps[0].params.args[0]).toBe(1000n * 10n ** 18n);
  });

  it("should build borrow step with termId", async () => {
    const steps = await buildBrokerBorrowSteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 1000n * 10n ** 18n,
        termId: 1n,
      },
      mockPublicClient,
      "bsc",
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].params.args).toHaveLength(2);
    expect(steps[0].params.args[0]).toBe(1000n * 10n ** 18n);
    expect(steps[0].params.args[1]).toBe(1n);
  });

  it("should handle string chainId", async () => {
    const steps = await buildBrokerBorrowSteps(
      {
        chainId: "56",
        brokerAddress: BROKER_ADDRESS,
        amount: 1000n,
      },
      mockPublicClient,
      "bsc",
    );

    expect(steps[0].params.chainId).toBe("56");
  });
});

describe("buildBrokerRepaySteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The builder proves the broker is registered before approving to it, so
    // the mock has to answer the round trip as well as the allowance.
    mockReadContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "MARKET_ID") return MARKET_ID;
        if (functionName === "MOOLAH")
          return getContractAddress("bsc", "moolah");
        if (functionName === "brokers") return BROKER_ADDRESS;
        return 0n;
      },
    );
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

/**
 * Restored after a wholesale test-file deletion dropped 16 tests alongside
 * the one that was genuinely obsolete (a BSC-Testnet-specific `repayAll`
 * refusal — moot now that `NetworkName` no longer admits "bscTestnet" at
 * all, so the guard it tested was correctly removed as dead code). These
 * three builders otherwise had zero remaining coverage for their own
 * argument validation and step encoding.
 */
describe("buildConvertDynamicToFixedSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(brokerAware);
  });

  it("is a single step with no approval and no authorization", async () => {
    const steps = await buildConvertDynamicToFixedSteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        amount: 500n,
        termId: 3600n,
      },
      mockPublicClient,
      "bsc",
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("convertDynamicToFixed");
    expect(steps[0].index).toBe(0);
    const { functionName, args } = decode(steps[0].params.data);
    expect(functionName).toBe("convertDynamicToFixed");
    expect(args).toEqual([500n, 3600n]);
  });

  it("rejects a zero amount, which the contract reverts on", async () => {
    await expect(
      buildConvertDynamicToFixedSteps(
        {
          chainId: 56,
          brokerAddress: BROKER_ADDRESS,
          amount: 0n,
          termId: 600n,
        },
        mockPublicClient,
        "bsc",
      ),
    ).rejects.toThrow(/greater than zero/);
  });
});

describe("buildBrokerRefinanceMaturedSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(brokerAware);
  });

  it("encodes the position id list", async () => {
    const steps = await buildBrokerRefinanceMaturedSteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        user: WALLET,
        positionIds: [1n, 4n, 9n],
      },
      mockPublicClient,
      "bsc",
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("brokerRefinanceMatured");
    expect(decode(steps[0].params.data).args).toEqual([WALLET, [1n, 4n, 9n]]);
  });

  it("rejects an empty id list", async () => {
    await expect(
      buildBrokerRefinanceMaturedSteps(
        {
          chainId: 56,
          brokerAddress: BROKER_ADDRESS,
          user: WALLET,
          positionIds: [],
        },
        mockPublicClient,
        "bsc",
      ),
    ).rejects.toThrow(/must not be empty/);
  });
});

describe("buildBrokerRepayAllSteps", () => {
  const clientWithAllowance = (allowance: bigint): PublicClient =>
    ({
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => {
          if (functionName === "allowance") return allowance;
          return brokerAware({ functionName });
        },
      ),
    }) as unknown as PublicClient;

  it("approves the broker first, then repays", async () => {
    const steps = await buildBrokerRepayAllSteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        onBehalf: WALLET,
        maxRepayAmount: 1000n,
        loanToken: LOAN_TOKEN,
        walletAddress: WALLET,
      },
      clientWithAllowance(0n),
      "bsc",
    );
    expect(steps.map((s) => [s.step, s.index])).toEqual([
      ["approve", 0],
      ["brokerRepayAll", 1],
      ["approve", 2],
    ]);
    expect(decode(steps[1].params.data).args).toEqual([WALLET]);
    expect(steps[1].params.value).toBeUndefined();
    // The approval was sized for a debt that keeps growing, so the broker
    // takes less than was approved; the remainder goes back rather than
    // standing.
    expect(steps[2].meta?.amount).toBe(0n);
    expect(steps[2].meta?.spender).toBe(BROKER_ADDRESS);
  });

  it("skips the approval when the allowance already covers the ceiling", async () => {
    const steps = await buildBrokerRepayAllSteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        onBehalf: WALLET,
        maxRepayAmount: 1000n,
        loanToken: LOAN_TOKEN,
        walletAddress: WALLET,
      },
      clientWithAllowance(10_000n),
      "bsc",
    );
    expect(steps.map((s) => s.step)).toEqual(["brokerRepayAll"]);
  });

  it("sends value instead of approving for a native loan token", async () => {
    const client = clientWithAllowance(0n);
    const steps = await buildBrokerRepayAllSteps(
      {
        chainId: 56,
        brokerAddress: BROKER_ADDRESS,
        onBehalf: WALLET,
        maxRepayAmount: 1000n,
        isNativeLoanToken: true,
      },
      client,
      "bsc",
    );
    expect(steps.map((s) => s.step)).toEqual(["brokerRepayAll"]);
    expect(steps[0].params.value).toBe(1000n);
    const read = (client.readContract as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ functionName: string }]>;
    expect(read.map(([a]) => a.functionName)).not.toContain("allowance");
    expect(read.map(([a]) => a.functionName)).toContain("brokers");
  });

  it("rejects a zero ceiling", async () => {
    await expect(
      buildBrokerRepayAllSteps(
        {
          chainId: 56,
          brokerAddress: BROKER_ADDRESS,
          onBehalf: WALLET,
          maxRepayAmount: 0n,
        },
        clientWithAllowance(0n),
        "bsc",
      ),
    ).rejects.toThrow(/greater than zero/);
  });

  it("requires loanToken and walletAddress unless the loan is native", async () => {
    await expect(
      buildBrokerRepayAllSteps(
        {
          chainId: 56,
          brokerAddress: BROKER_ADDRESS,
          onBehalf: WALLET,
          maxRepayAmount: 1000n,
        },
        clientWithAllowance(0n),
        "bsc",
      ),
    ).rejects.toThrow(/loanToken|walletAddress/);
  });
});
