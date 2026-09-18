import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PublicClient, Address } from "viem";
import { zeroAddress } from "viem";
import {
  buildSupplySteps,
  buildBorrowSteps,
  buildRepaySteps,
  buildWithdrawSteps,
} from "../../builders/market.js";
import {
  getContractAddress,
  type WriteMarketConfig,
} from "@lista-dao/moolah-sdk-core";

const mockReadContract = vi.fn();
const mockPublicClient = {
  readContract: mockReadContract,
} as unknown as PublicClient;

const COLLATERAL_TOKEN =
  "0x1111111111111111111111111111111111111111" as Address;
const LOAN_TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const WALLET = "0x3333333333333333333333333333333333333333" as Address;
const PROVIDER = "0x4444444444444444444444444444444444444444" as Address;
// `isNative` is now derived from the resolved provider matching this
// singleton, not trusted from the config — see resolveProviders.ts. Tests
// that mean to exercise the native branch have to resolve to this address,
// not an arbitrary one.
const NATIVE_PROVIDER = getContractAddress("bsc", "nativeProvider");

const baseMarketConfig: WriteMarketConfig = {
  params: {
    loanToken: LOAN_TOKEN,
    collateralToken: COLLATERAL_TOKEN,
    oracle: "0x5555555555555555555555555555555555555555" as Address,
    irm: "0x6666666666666666666666666666666666666666" as Address,
    lltv: 800000000000000000n,
  },
  collateralInfo: { address: COLLATERAL_TOKEN, decimals: 18, symbol: "COLL" },
  loanInfo: { address: LOAN_TOKEN, decimals: 18, symbol: "LOAN" },
  collateralProvider: zeroAddress,
  loanProvider: zeroAddress,
  collateralIsNative: false,
  loanIsNative: false,
};

/**
 * A mock that answers by function, not with one blanket value.
 *
 * The builders now resolve `providers` from the chain rather than trusting the
 * config, so a mock returning `0n` for every read hands back `0n` where an
 * address belongs. `chainProviders` says what `Moolah.providers` should report
 * for this market; everything else (allowance, market state) stays at zero.
 */
const chainSaying =
  (
    providers: { loan?: Address; collateral?: Address } = {},
    rest: unknown = 0n,
  ) =>
  async ({
    functionName,
    args,
  }: {
    functionName: string;
    args?: readonly unknown[];
  }) => {
    if (functionName === "providers") {
      return args?.[1] === LOAN_TOKEN
        ? (providers.loan ?? zeroAddress)
        : (providers.collateral ?? zeroAddress);
    }
    return rest;
  };

describe("buildSupplySteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(chainSaying());
  });

  it("should build supply steps with approval", async () => {
    const steps = await buildSupplySteps(
      {
        chainId: 56,
        assets: 1000n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseMarketConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps.some((s) => s.step === "approve")).toBe(true);
    expect(steps.some((s) => s.step === "supply")).toBe(true);
  });

  it("should use onBehalf if provided", async () => {
    const onBehalf = "0x7777777777777777777777777777777777777777" as Address;
    const steps = await buildSupplySteps(
      {
        chainId: 56,
        assets: 1000n,
        walletAddress: WALLET,
        onBehalf,
      },
      baseMarketConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    const supplyStep = steps.find((s) => s.step === "supply");
    expect(supplyStep?.params.args).toContain(onBehalf);
  });

  it("should use collateralProvider when set", async () => {
    mockReadContract.mockImplementation(chainSaying({ collateral: PROVIDER }));
    // The provider comes from `Moolah.providers` now, not from the config, so
    // the chain is what has to name it.
    mockReadContract.mockImplementation(chainSaying({ collateral: PROVIDER }));
    const configWithProvider = {
      ...baseMarketConfig,
      collateralProvider: PROVIDER,
    };

    const steps = await buildSupplySteps(
      {
        chainId: 56,
        assets: 1000n,
        walletAddress: WALLET,
      },
      configWithProvider,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    const supplyStep = steps.find((s) => s.step === "supply");
    expect(supplyStep?.params.to).toBe(PROVIDER);
  });

  it("should handle native collateral", async () => {
    const nativeConfig = {
      ...baseMarketConfig,
      collateralIsNative: true,
      collateralProvider: NATIVE_PROVIDER,
    };
    // `collateralIsNative` is now derived from the resolved provider matching
    // the network's nativeProvider singleton, not trusted from the config.
    mockReadContract.mockImplementation(
      chainSaying({ collateral: NATIVE_PROVIDER }),
    );

    const steps = await buildSupplySteps(
      {
        chainId: 56,
        assets: 1000n,
        walletAddress: WALLET,
      },
      nativeConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    // Should not have approve step for native
    expect(steps.some((s) => s.step === "approve")).toBe(false);
    const supplyStep = steps.find((s) => s.step === "supply");
    expect(supplyStep?.params.value).toBe(1000n);
  });

  it("should skip approve when allowance is sufficient", async () => {
    mockReadContract.mockImplementation(chainSaying({}, 10000n * 10n ** 18n));

    const steps = await buildSupplySteps(
      {
        chainId: 56,
        assets: 100n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseMarketConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.filter((s) => s.step === "approve")).toHaveLength(0);
    expect(steps.some((s) => s.step === "supply")).toBe(true);
  });
});

describe("buildBorrowSteps", () => {
  it("should build borrow step", async () => {
    const steps = await buildBorrowSteps(
      {
        chainId: 56,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseMarketConfig,
      "bsc",
      mockPublicClient,
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("borrow");
    expect(steps[0].params.functionName).toBe("borrow");
  });

  it("should use receiver if provided", async () => {
    const receiver = "0x8888888888888888888888888888888888888888" as Address;
    const steps = await buildBorrowSteps(
      {
        chainId: 56,
        assets: 500n,
        walletAddress: WALLET,
        receiver,
      },
      baseMarketConfig,
      "bsc",
      mockPublicClient,
    );

    expect(steps[0].params.args).toContain(receiver);
  });

  it("should use loanProvider when set", async () => {
    mockReadContract.mockImplementation(chainSaying({ loan: PROVIDER }));
    const configWithProvider = {
      ...baseMarketConfig,
      loanProvider: PROVIDER,
    };

    const steps = await buildBorrowSteps(
      {
        chainId: 56,
        assets: 500n,
        walletAddress: WALLET,
      },
      configWithProvider,
      "bsc",
      mockPublicClient,
    );

    expect(steps[0].params.to).toBe(PROVIDER);
  });
});

describe("buildRepaySteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(chainSaying());
  });

  it("should build repay steps with approval", async () => {
    const steps = await buildRepaySteps(
      {
        chainId: 56,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseMarketConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.some((s) => s.step === "approve")).toBe(true);
    expect(steps.some((s) => s.step === "repay")).toBe(true);
  });

  it("should handle native loan repay", async () => {
    mockReadContract.mockImplementation(chainSaying({ loan: NATIVE_PROVIDER }));
    const nativeConfig = {
      ...baseMarketConfig,
      loanIsNative: true,
      loanProvider: NATIVE_PROVIDER,
      loanInfo: {
        ...baseMarketConfig.loanInfo,
        address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address,
      },
    };

    const steps = await buildRepaySteps(
      {
        chainId: 56,
        assets: 500n,
        walletAddress: WALLET,
      },
      nativeConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    // Should not have approve step for native
    expect(steps.some((s) => s.step === "approve")).toBe(false);
    const repayStep = steps.find((s) => s.step === "repay");
    expect(repayStep?.params.value).toBe(500n);
  });

  it("should handle repayAll with user data", async () => {
    const mockUserData = {
      borrowShares: 1000n,
      decimals: { l: 18 },
      _getExtraRepayAmount: () => ({
        roundDown: () => ({ numerator: 1100n * 10n ** 18n }),
      }),
    };

    const steps = await buildRepaySteps(
      {
        chainId: 56,
        repayAll: true,
        walletAddress: WALLET,
      },
      baseMarketConfig,
      { publicClient: mockPublicClient, network: "bsc" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for test
      mockUserData as any,
    );

    expect(steps.some((s) => s.step === "repay")).toBe(true);
  });

  it("should handle repayAll with native loan and user data", async () => {
    mockReadContract.mockImplementation(chainSaying({ loan: NATIVE_PROVIDER }));
    const nativeConfig = {
      ...baseMarketConfig,
      loanIsNative: true,
      loanProvider: NATIVE_PROVIDER,
      loanInfo: {
        ...baseMarketConfig.loanInfo,
        address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address,
      },
    };

    const mockUserData = {
      borrowShares: 1000n,
      decimals: { l: 18 },
      _getExtraRepayAmount: () => ({
        roundDown: () => ({ numerator: 500n }),
      }),
    };

    const steps = await buildRepaySteps(
      {
        chainId: 56,
        repayAll: true,
        walletAddress: WALLET,
      },
      nativeConfig,
      { publicClient: mockPublicClient, network: "bsc" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for test
      mockUserData as any,
    );

    const repayStep = steps.find((s) => s.step === "repay");
    // Native value should be set for native loan repayAll
    expect(repayStep?.params.value).toBe(500n);
  });

  it("sizes the native value off the resolved flag, not a stale forged one", async () => {
    // The config claims non-native, but the chain resolves the loan provider
    // to the real nativeProvider — `withResolvedProviders` corrects the flag,
    // so the branch taken (native) and the value it carries must agree, even
    // though `nativeValue` is computed before that correction runs.
    mockReadContract.mockImplementation(chainSaying({ loan: NATIVE_PROVIDER }));
    const forgedConfig = {
      ...baseMarketConfig,
      loanIsNative: false,
      loanInfo: {
        ...baseMarketConfig.loanInfo,
        address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address,
      },
    };

    const mockUserData = {
      borrowShares: 1000n,
      decimals: { l: 18 },
      _getExtraRepayAmount: () => ({
        roundDown: () => ({ numerator: 500n }),
      }),
    };

    const steps = await buildRepaySteps(
      {
        chainId: 56,
        repayAll: true,
        walletAddress: WALLET,
      },
      forgedConfig,
      { publicClient: mockPublicClient, network: "bsc" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for test
      mockUserData as any,
    );

    const repayStep = steps.find((s) => s.step === "repay");
    expect(repayStep?.params.value).toBe(500n);
  });

  it("should use shares when provided, and approve what they cost", async () => {
    // Repaying by shares says how much debt to clear, not how many tokens it
    // takes. Sizing the approval from `assets` (zero on this path) emitted no
    // approve step at all, and the repayment reverted inside `transferFrom` —
    // found by running it on a fork, not by reading it.
    mockReadContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "market") {
          // totalSupplyAssets, totalSupplyShares, totalBorrowAssets,
          // totalBorrowShares, lastUpdate, fee
          return [0n, 0n, 1_000n, 2_000n, 1n, 0n];
        }
        if (functionName === "providers") return zeroAddress;
        return 0n;
      },
    );

    const steps = await buildRepaySteps(
      {
        chainId: 56,
        shares: 500n,
        walletAddress: WALLET,
      },
      baseMarketConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    const repayStep = steps.find((s) => s.step === "repay");
    expect(repayStep?.params.args).toContain(500n);
    // Priced through the protocol's virtual assets and shares — a bare
    // 500/2000 * 1000 ratio would say 250 and under-approve a thin market.
    const approve = steps.find((s) => s.step === "approve");
    expect(approve?.meta?.amount).toBe(2n);
  });

  it("refuses a share-denominated repay it cannot price", async () => {
    mockReadContract.mockImplementation(chainSaying());
    await expect(
      buildRepaySteps(
        { chainId: 56, shares: 500n, walletAddress: WALLET },
        baseMarketConfig,
        { publicClient: mockPublicClient, network: "bsc" },
      ),
    ).rejects.toThrow(/could not read the market state/);
  });

  it("should skip approve when allowance is sufficient", async () => {
    mockReadContract.mockImplementation(chainSaying({}, 10000n * 10n ** 18n));

    const steps = await buildRepaySteps(
      {
        chainId: 56,
        assets: 100n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseMarketConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.filter((s) => s.step === "approve")).toHaveLength(0);
    expect(steps.some((s) => s.step === "repay")).toBe(true);
  });

  it("should use loanProvider when not zero address", async () => {
    mockReadContract.mockImplementation(chainSaying({ loan: PROVIDER }));
    const configWithProvider = {
      ...baseMarketConfig,
      loanProvider: PROVIDER,
    };

    const steps = await buildRepaySteps(
      {
        chainId: 56,
        assets: 500n,
        walletAddress: WALLET,
      },
      configWithProvider,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    const repayStep = steps.find((s) => s.step === "repay");
    expect(repayStep?.params.to).toBe(PROVIDER);
  });
});

describe("buildWithdrawSteps", () => {
  it("should build withdraw step", async () => {
    const steps = await buildWithdrawSteps(
      {
        chainId: 56,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseMarketConfig,
      "bsc",
      mockPublicClient,
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("withdraw");
    expect(steps[0].params.functionName).toBe("withdrawCollateral");
  });

  it("should use receiver if provided", async () => {
    const receiver = "0x9999999999999999999999999999999999999999" as Address;
    const steps = await buildWithdrawSteps(
      {
        chainId: 56,
        assets: 500n,
        walletAddress: WALLET,
        receiver,
      },
      baseMarketConfig,
      "bsc",
      mockPublicClient,
    );

    expect(steps[0].params.args).toContain(receiver);
  });

  it("should use collateralProvider when set", async () => {
    mockReadContract.mockImplementation(chainSaying({ collateral: PROVIDER }));
    const configWithProvider = {
      ...baseMarketConfig,
      collateralProvider: PROVIDER,
    };

    const steps = await buildWithdrawSteps(
      {
        chainId: 56,
        assets: 500n,
        walletAddress: WALLET,
      },
      configWithProvider,
      "bsc",
      mockPublicClient,
    );

    expect(steps[0].params.to).toBe(PROVIDER);
  });
});

describe("a config's native claim can never route value to the zero address", () => {
  // `*IsNative` is now derived from the resolved provider matching the
  // network's nativeProvider singleton (see resolveProviders.ts), not
  // trusted from the config. A config forging `isNative: true` for a market
  // whose chain-registered provider is `0x0` no longer needs a guard that
  // rejects the build — the flag is silently corrected to `false`, and the
  // step falls back to the ordinary ERC-20 path against Moolah directly.
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(chainSaying());
  });

  it("falls back to the ERC-20 path when a native collateral claim has no chain provider", async () => {
    const steps = await buildSupplySteps(
      { chainId: 56, assets: 1000n, walletAddress: WALLET },
      { ...baseMarketConfig, collateralIsNative: true },
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.some((s) => s.step === "approve")).toBe(true);
    const supplyStep = steps.find((s) => s.step === "supply");
    expect(supplyStep?.params.to).toBe(getContractAddress("bsc", "moolah"));
    expect(supplyStep?.params.value).toBeUndefined();
  });

  it("falls back to the ERC-20 path when a native loan-repay claim has no chain provider", async () => {
    const steps = await buildRepaySteps(
      { chainId: 56, assets: 1000n, walletAddress: WALLET },
      {
        ...baseMarketConfig,
        loanIsNative: true,
        loanInfo: {
          address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address,
          decimals: 18,
          symbol: "WBNB",
        },
        params: {
          ...baseMarketConfig.params,
          loanToken: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address,
        },
      },
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.some((s) => s.step === "approve")).toBe(true);
    const repayStep = steps.find((s) => s.step === "repay");
    expect(repayStep?.params.to).toBe(getContractAddress("bsc", "moolah"));
    expect(repayStep?.params.value).toBeUndefined();
  });
});
