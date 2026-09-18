import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PublicClient, Address } from "viem";
import { zeroAddress } from "viem";
import {
  buildSmartSupplyDexLpSteps,
  buildSmartSupplyCollateralSteps,
  buildSmartWithdrawDexLpSteps,
  buildSmartWithdrawCollateralSteps,
  buildSmartWithdrawCollateralFixedSteps,
  buildSmartRepaySteps,
} from "../../builders/smart.js";
import {
  getContractAddress,
  type WriteSmartMarketConfig,
} from "@lista-dao/moolah-sdk-core";
import { NATIVE_ADDRESS } from "../../read/smart/getSmartMarketExtraInfo.js";

const mockReadContract = vi.fn();
const mockPublicClient = {
  readContract: mockReadContract,
} as unknown as PublicClient;

const LP_TOKEN = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN_A = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN_B = "0x3333333333333333333333333333333333333333" as Address;
const LOAN_TOKEN = "0x4444444444444444444444444444444444444444" as Address;
const WALLET = "0x5555555555555555555555555555555555555555" as Address;
const COLLATERAL_PROVIDER =
  "0x6666666666666666666666666666666666666666" as Address;
const LOAN_PROVIDER = "0x7777777777777777777777777777777777777777" as Address;
// `*IsNative` is now derived from chain fact (see resolveProviders.ts),
// not trusted from the config — tests meaning to exercise the native
// branch have to resolve to the real singleton / sentinel, not an
// arbitrary placeholder address.
const NATIVE_PROVIDER = getContractAddress("bsc", "nativeProvider");

const baseSmartConfig: WriteSmartMarketConfig = {
  params: {
    loanToken: LOAN_TOKEN,
    collateralToken: LP_TOKEN,
    oracle: "0x8888888888888888888888888888888888888888" as Address,
    irm: "0x9999999999999999999999999999999999999999" as Address,
    lltv: 800000000000000000n,
  },
  collateralProvider: COLLATERAL_PROVIDER,
  loanProvider: LOAN_PROVIDER,
  loanIsNative: false,
  tokenAIsNative: false,
  tokenBIsNative: false,
  lpInfo: { address: LP_TOKEN, decimals: 18, symbol: "LP" },
  loanInfo: { address: LOAN_TOKEN, decimals: 18, symbol: "LOAN" },
  tokenAInfo: { address: TOKEN_A, decimals: 18, symbol: "TOKA" },
  tokenBInfo: { address: TOKEN_B, decimals: 18, symbol: "TOKB" },
};

/**
 * Answers by function, not with one blanket value. The builders resolve
 * `providers` from the chain now, so a mock returning `0n` for every read hands
 * back a number where an address belongs.
 */
const chainSaying =
  (rest: unknown = 0n, tokens?: { token0?: Address; token1?: Address }) =>
  async ({
    functionName,
    args,
  }: {
    functionName: string;
    args?: readonly unknown[];
  }) => {
    if (functionName === "providers") {
      return args?.[1] === LOAN_TOKEN ? LOAN_PROVIDER : COLLATERAL_PROVIDER;
    }
    if (functionName === "token" && tokens) {
      return args?.[0] === 0n
        ? (tokens.token0 ?? rest)
        : (tokens.token1 ?? rest);
    }
    return rest;
  };

describe("buildSmartSupplyDexLpSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(chainSaying());
  });

  it("should build supply LP steps with approval", async () => {
    const steps = await buildSmartSupplyDexLpSteps(
      {
        chainId: 56,
        lpAmount: 1000n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseSmartConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.some((s) => s.step === "approve")).toBe(true);
    expect(steps.some((s) => s.step === "supplySmartDexLp")).toBe(true);

    const supplyStep = steps.find((s) => s.step === "supplySmartDexLp");
    expect(supplyStep?.params.to).toBe(COLLATERAL_PROVIDER);
    expect(supplyStep?.params.functionName).toBe("supplyDexLp");
  });

  it("should use onBehalf if provided", async () => {
    const onBehalf = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
    const steps = await buildSmartSupplyDexLpSteps(
      {
        chainId: 56,
        lpAmount: 1000n,
        walletAddress: WALLET,
        onBehalf,
      },
      baseSmartConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    const supplyStep = steps.find((s) => s.step === "supplySmartDexLp");
    expect(supplyStep?.params.args).toContain(onBehalf);
  });

  it("should skip approve when allowance is sufficient", async () => {
    mockReadContract.mockImplementation(chainSaying(10000n * 10n ** 18n));

    const steps = await buildSmartSupplyDexLpSteps(
      {
        chainId: 56,
        lpAmount: 100n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseSmartConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.filter((s) => s.step === "approve")).toHaveLength(0);
    expect(steps.some((s) => s.step === "supplySmartDexLp")).toBe(true);
  });
});

describe("buildSmartSupplyCollateralSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(chainSaying());
  });

  it("should build supply collateral steps with both token approvals", async () => {
    const steps = await buildSmartSupplyCollateralSteps(
      {
        chainId: 56,
        tokenAAmount: 500n * 10n ** 18n,
        tokenBAmount: 500n * 10n ** 18n,
        minLpAmount: 900n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseSmartConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    // Should have approvals for both tokens
    const approveSteps = steps.filter((s) => s.step === "approve");
    expect(approveSteps.length).toBeGreaterThanOrEqual(2);

    expect(steps.some((s) => s.step === "supplySmartCollateral")).toBe(true);
  });

  it("should skip approval for native token A", async () => {
    mockReadContract.mockImplementation(
      chainSaying(0n, { token0: NATIVE_ADDRESS }),
    );
    const nativeTokenAConfig = {
      ...baseSmartConfig,
      tokenAIsNative: true,
    };

    const steps = await buildSmartSupplyCollateralSteps(
      {
        chainId: 56,
        tokenAAmount: 500n,
        tokenBAmount: 500n,
        minLpAmount: 900n,
        walletAddress: WALLET,
      },
      nativeTokenAConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    // Should include value for native token
    const supplyStep = steps.find((s) => s.step === "supplySmartCollateral");
    expect(supplyStep?.params.value).toBe(500n);
  });

  it("should skip approval for native token B", async () => {
    mockReadContract.mockImplementation(
      chainSaying(0n, { token1: NATIVE_ADDRESS }),
    );
    const nativeTokenBConfig = {
      ...baseSmartConfig,
      tokenBIsNative: true,
    };

    const steps = await buildSmartSupplyCollateralSteps(
      {
        chainId: 56,
        tokenAAmount: 500n,
        tokenBAmount: 600n,
        minLpAmount: 900n,
        walletAddress: WALLET,
      },
      nativeTokenBConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    const supplyStep = steps.find((s) => s.step === "supplySmartCollateral");
    expect(supplyStep?.params.value).toBe(600n);
  });
});

describe("buildSmartWithdrawDexLpSteps", () => {
  it("should build withdraw LP step", async () => {
    const steps = await buildSmartWithdrawDexLpSteps(
      {
        chainId: 56,
        lpAmount: 500n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseSmartConfig,

      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("withdrawSmartDexLp");
    expect(steps[0].params.functionName).toBe("withdrawDexLp");
    expect(steps[0].params.to).toBe(COLLATERAL_PROVIDER);
  });

  it("should use receiver if provided", async () => {
    const receiver = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
    const steps = await buildSmartWithdrawDexLpSteps(
      {
        chainId: 56,
        lpAmount: 500n,
        walletAddress: WALLET,
        receiver,
      },
      baseSmartConfig,

      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps[0].params.args).toContain(receiver);
  });
});

describe("buildSmartWithdrawCollateralSteps", () => {
  it("should build withdraw collateral step", async () => {
    const steps = await buildSmartWithdrawCollateralSteps(
      {
        chainId: 56,
        tokenAAmount: 300n,
        tokenBAmount: 200n,
        maxLpBurn: 600n,
        walletAddress: WALLET,
      },
      baseSmartConfig,

      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("withdrawSmartCollateral");
    expect(steps[0].params.functionName).toBe("withdrawCollateralImbalance");
  });

  it("should use receiver if provided", async () => {
    const receiver = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;
    const steps = await buildSmartWithdrawCollateralSteps(
      {
        chainId: 56,
        tokenAAmount: 300n,
        tokenBAmount: 200n,
        maxLpBurn: 600n,
        walletAddress: WALLET,
        receiver,
      },
      baseSmartConfig,

      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps[0].params.args).toContain(receiver);
  });

  it("should use onBehalf if provided", async () => {
    const onBehalf = "0xdddddddddddddddddddddddddddddddddddddddd" as Address;
    const steps = await buildSmartWithdrawCollateralSteps(
      {
        chainId: 56,
        tokenAAmount: 300n,
        tokenBAmount: 200n,
        maxLpBurn: 600n,
        walletAddress: WALLET,
        onBehalf,
      },
      baseSmartConfig,

      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps[0].params.args).toContain(onBehalf);
  });
});

describe("buildSmartWithdrawCollateralFixedSteps", () => {
  it("should build withdraw collateral fixed step", async () => {
    const steps = await buildSmartWithdrawCollateralFixedSteps(
      {
        chainId: 56,
        lpAmount: 500n,
        minTokenAAmount: 200n,
        minTokenBAmount: 200n,
        walletAddress: WALLET,
      },
      baseSmartConfig,

      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("withdrawSmartCollateralFixed");
    expect(steps[0].params.functionName).toBe("withdrawCollateral");
  });

  it("should use receiver if provided", async () => {
    const receiver = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Address;
    const steps = await buildSmartWithdrawCollateralFixedSteps(
      {
        chainId: 56,
        lpAmount: 500n,
        minTokenAAmount: 200n,
        minTokenBAmount: 200n,
        walletAddress: WALLET,
        receiver,
      },
      baseSmartConfig,

      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps[0].params.args).toContain(receiver);
  });

  it("should use onBehalf if provided", async () => {
    const onBehalf = "0xffffffffffffffffffffffffffffffffffffffff" as Address;
    const steps = await buildSmartWithdrawCollateralFixedSteps(
      {
        chainId: 56,
        lpAmount: 500n,
        minTokenAAmount: 200n,
        minTokenBAmount: 200n,
        walletAddress: WALLET,
        onBehalf,
      },
      baseSmartConfig,

      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps[0].params.args).toContain(onBehalf);
  });
});

describe("buildSmartRepaySteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(chainSaying());
  });

  it("should build repay steps with approval", async () => {
    const steps = await buildSmartRepaySteps(
      {
        chainId: 56,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseSmartConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.some((s) => s.step === "approve")).toBe(true);
    expect(steps.some((s) => s.step === "repaySmartMarket")).toBe(true);
  });

  it("should handle native loan repay", async () => {
    // `loanIsNative` is now derived from the resolved loan provider matching
    // the network's nativeProvider singleton, not trusted from the config.
    mockReadContract.mockImplementation(async ({ functionName, args }) => {
      if (functionName === "providers") {
        return args?.[1] === LOAN_TOKEN ? NATIVE_PROVIDER : COLLATERAL_PROVIDER;
      }
      return 0n;
    });
    const nativeLoanConfig = {
      ...baseSmartConfig,
      loanIsNative: true,
    };

    const steps = await buildSmartRepaySteps(
      {
        chainId: 56,
        assets: 500n,
        walletAddress: WALLET,
      },
      nativeLoanConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    // Should not have approve step
    expect(steps.some((s) => s.step === "approve")).toBe(false);

    const repayStep = steps.find((s) => s.step === "repaySmartMarket");
    expect(repayStep?.params.to).toBe(NATIVE_PROVIDER);
  });

  it("should handle repayAll with user data", async () => {
    const mockUserData = {
      borrowShares: 1000n,
      decimals: { l: 18 },
      _getExtraRepayAmount: () => ({
        roundDown: () => ({ numerator: 1100n * 10n ** 18n }),
      }),
    };

    const steps = await buildSmartRepaySteps(
      {
        chainId: 56,
        repayAll: true,
        walletAddress: WALLET,
      },
      baseSmartConfig,
      { publicClient: mockPublicClient, network: "bsc" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for test
      mockUserData as any,
    );

    expect(steps.some((s) => s.step === "repaySmartMarket")).toBe(true);
  });

  it("should handle repayAll with native loan and user data", async () => {
    mockReadContract.mockImplementation(async ({ functionName, args }) => {
      if (functionName === "providers") {
        return args?.[1] === LOAN_TOKEN ? NATIVE_PROVIDER : COLLATERAL_PROVIDER;
      }
      return 0n;
    });
    const nativeLoanConfig = {
      ...baseSmartConfig,
      loanIsNative: true,
    };

    const mockUserData = {
      borrowShares: 1000n,
      decimals: { l: 18 },
      _getExtraRepayAmount: () => ({
        roundDown: () => ({ numerator: 500n }),
      }),
    };

    const steps = await buildSmartRepaySteps(
      {
        chainId: 56,
        repayAll: true,
        walletAddress: WALLET,
      },
      nativeLoanConfig,
      { publicClient: mockPublicClient, network: "bsc" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for test
      mockUserData as any,
    );

    const repayStep = steps.find((s) => s.step === "repaySmartMarket");
    // Native value should be set for native loan repay
    expect(repayStep?.params.value).toBe(500n);
  });

  it("sizes the native value off the resolved flag, not a stale forged one", async () => {
    // Same ordering hazard as the plain market repay: the config claims
    // non-native, chain resolution says otherwise, and `nativeValue` — sized
    // before that correction runs — has to end up agreeing with it.
    mockReadContract.mockImplementation(async ({ functionName, args }) => {
      if (functionName === "providers") {
        return args?.[1] === LOAN_TOKEN ? NATIVE_PROVIDER : COLLATERAL_PROVIDER;
      }
      return 0n;
    });
    const forgedConfig = {
      ...baseSmartConfig,
      loanIsNative: false,
    };

    const mockUserData = {
      borrowShares: 1000n,
      decimals: { l: 18 },
      _getExtraRepayAmount: () => ({
        roundDown: () => ({ numerator: 500n }),
      }),
    };

    const steps = await buildSmartRepaySteps(
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

    const repayStep = steps.find((s) => s.step === "repaySmartMarket");
    expect(repayStep?.params.value).toBe(500n);
  });

  it("should use moolah contract when no loan provider", async () => {
    const configNoProvider = {
      ...baseSmartConfig,
      loanProvider: zeroAddress,
    };

    const steps = await buildSmartRepaySteps(
      {
        chainId: 56,
        assets: 500n,
        walletAddress: WALLET,
      },
      configNoProvider,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    const repayStep = steps.find((s) => s.step === "repaySmartMarket");
    // Should use moolah contract address instead of zero address
    expect(repayStep?.params.to).not.toBe(zeroAddress);
  });
});

describe("a native pool token claim can never route value to the zero address", () => {
  // `tokenAIsNative` / `tokenBIsNative` are now derived from the collateral
  // provider's own `token(0)` / `token(1)` (see resolveProviders.ts), not
  // trusted from the config. When the collateral provider itself resolves to
  // `0x0` — an unregistered pair, a successful `Moolah.providers` read — the
  // token reads answer off that same dead address and the flags are silently
  // corrected to `false`, so a forged native claim here no longer needs a
  // guard that rejects the build: it falls back to the ordinary path.
  const noCollateralProvider = async ({
    functionName,
    args,
  }: {
    functionName: string;
    args?: readonly unknown[];
  }) => {
    if (functionName === "providers") {
      return args?.[1] === LOAN_TOKEN ? LOAN_PROVIDER : zeroAddress;
    }
    // A real node throws on `token(0)`/`token(1)` against the zero address —
    // no bytecode, no return data. A mock that answered `0n` here couldn't
    // catch a resolver that queried it anyway instead of short-circuiting.
    if (functionName === "token") {
      throw new Error("could not decode zero data");
    }
    return 0n;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(noCollateralProvider);
  });

  for (const [label, flags] of [
    ["token A", { tokenAIsNative: true }],
    ["token B", { tokenBIsNative: true }],
  ] as const) {
    it(`falls back to the ERC-20 path when a native ${label} claim has no chain provider`, async () => {
      const steps = await buildSmartSupplyCollateralSteps(
        {
          chainId: 56,
          tokenAAmount: 10n ** 18n,
          tokenBAmount: 10n ** 18n,
          minLpAmount: 0n,
          walletAddress: WALLET,
        },
        { ...baseSmartConfig, ...flags },
        { publicClient: mockPublicClient, network: "bsc" },
      );

      const supplyStep = steps.find((s) => s.step === "supplySmartCollateral");
      expect(supplyStep?.params.value).toBeUndefined();
    });
  }

  it("still builds when neither pool token is native", async () => {
    // The guard is about `value`, not about the provider being zero — an
    // ERC-20 supply to a dead provider wastes an approval and reverts, which
    // is recoverable. Throwing here too would reject configs for markets whose
    // provider is simply not registered yet.
    const steps = await buildSmartSupplyCollateralSteps(
      {
        chainId: 56,
        tokenAAmount: 10n ** 18n,
        tokenBAmount: 10n ** 18n,
        minLpAmount: 0n,
        walletAddress: WALLET,
      },
      baseSmartConfig,
      { publicClient: mockPublicClient, network: "bsc" },
    );
    expect(steps.some((s) => s.step === "supplySmartCollateral")).toBe(true);
  });
});

describe("the Smart exits resolve their provider too", () => {
  // Resolving the entries and not the exits is strictly worse than resolving
  // neither: the collateral goes in through the provider the chain names and
  // the withdrawal asks the one the cached config remembers. Nothing burns —
  // the position simply cannot be left.
  const STALE = "0x000000000000000000000000000000000000dead" as Address;
  const staleConfig = {
    ...baseSmartConfig,
    collateralProvider: STALE,
    loanProvider: STALE,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(chainSaying());
  });

  const deps = { publicClient: mockPublicClient, network: "bsc" as const };

  it("withdrawDexLp targets the chain's provider, not the config's", async () => {
    const [step] = await buildSmartWithdrawDexLpSteps(
      { chainId: 56, lpAmount: 1000n, walletAddress: WALLET },
      staleConfig,
      deps,
    );
    expect(step.params.to).toBe(COLLATERAL_PROVIDER);
  });

  it("withdrawCollateral targets the chain's provider", async () => {
    const [step] = await buildSmartWithdrawCollateralSteps(
      {
        chainId: 56,
        tokenAAmount: 1n,
        tokenBAmount: 1n,
        maxLpBurn: 10n,
        walletAddress: WALLET,
      },
      staleConfig,
      deps,
    );
    expect(step.params.to).toBe(COLLATERAL_PROVIDER);
  });

  it("withdrawCollateralFixed targets the chain's provider", async () => {
    const [step] = await buildSmartWithdrawCollateralFixedSteps(
      {
        chainId: 56,
        lpAmount: 1000n,
        minTokenAAmount: 0n,
        minTokenBAmount: 0n,
        walletAddress: WALLET,
      },
      staleConfig,
      deps,
    );
    expect(step.params.to).toBe(COLLATERAL_PROVIDER);
  });
});
