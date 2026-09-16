import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PublicClient, Address } from "viem";
import { zeroAddress } from "viem";
import {
  buildVaultDepositSteps,
  buildVaultWithdrawSteps,
} from "../../builders/vault.js";
import {
  Decimal,
  getContractAddress,
  type VaultInfo,
  type VaultUserData,
} from "@lista-dao/moolah-sdk-core";

const mockReadContract = vi.fn();
const mockPublicClient = {
  readContract: mockReadContract,
} as unknown as PublicClient;

const VAULT_ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const ASSET_TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const WALLET = "0x3333333333333333333333333333333333333333" as Address;
const PROVIDER = "0x4444444444444444444444444444444444444444" as Address;
// `isNative` is now derived from the resolved provider matching this
// singleton, not trusted from the config — see resolveProviders.ts.
const NATIVE_PROVIDER = getContractAddress("bsc", "nativeProvider");
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address;

const baseVaultInfo: VaultInfo = {
  assetInfo: { address: ASSET_TOKEN, decimals: 18, symbol: "ASSET" },
  totalAssets: new Decimal(0n, 18),
  totalSupply: new Decimal(0n, 18),
  isNative: false,
  isProvider: false,
  provider: zeroAddress,
};

/**
 * The vault builders resolve `provider()` from the vault itself now, so the
 * mock has to answer it rather than returning one value for every read.
 */
const vaultSaying =
  (provider: Address, rest: unknown = 0n) =>
  async ({ functionName }: { functionName: string }) =>
    functionName === "provider" ? provider : rest;

/**
 * The withdraw path resolves `provider()` too, so its tests need a client that
 * answers by function name rather than one blanket value. A mock that returns a
 * bigint for every read hands the resolver a number where an address belongs,
 * and the assertion that follows never notices.
 */
const withdrawDeps = {
  publicClient: {
    readContract: vi.fn(vaultSaying(zeroAddress)),
  } as unknown as PublicClient,
  network: "bsc" as const,
};

/**
 * The same, for a vault that really does route through a provider. The
 * resolver reads `provider()` off the vault, so a config claiming one is not
 * enough to produce a provider-targeted step — which is the point.
 */
const withdrawDepsVia = (provider: Address) => ({
  publicClient: {
    readContract: vi.fn(vaultSaying(provider)),
  } as unknown as PublicClient,
  network: "bsc" as const,
});

describe("buildVaultDepositSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockImplementation(vaultSaying(zeroAddress));
  });

  it("should build deposit steps with approval", async () => {
    const steps = await buildVaultDepositSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 1000n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseVaultInfo,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.some((s) => s.step === "approve")).toBe(true);
    expect(steps.some((s) => s.step === "depositVault")).toBe(true);
  });

  it("should use receiver if provided", async () => {
    const receiver = "0x5555555555555555555555555555555555555555" as Address;
    const steps = await buildVaultDepositSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 1000n,
        walletAddress: WALLET,
        receiver,
      },
      baseVaultInfo,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    const depositStep = steps.find((s) => s.step === "depositVault");
    expect(depositStep?.params.args).toContain(receiver);
  });

  it("should use provider when set", async () => {
    mockReadContract.mockImplementation(vaultSaying(PROVIDER));
    const vaultWithProvider = {
      ...baseVaultInfo,
      provider: PROVIDER,
    };

    const steps = await buildVaultDepositSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 1000n,
        walletAddress: WALLET,
      },
      vaultWithProvider,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    const depositStep = steps.find((s) => s.step === "depositVault");
    expect(depositStep?.params.to).toBe(PROVIDER);
  });

  it("should handle native BNB deposit with provider", async () => {
    mockReadContract.mockImplementation(vaultSaying(NATIVE_PROVIDER));
    const nativeVaultInfo = {
      ...baseVaultInfo,
      isNative: true,
      provider: NATIVE_PROVIDER,
      assetInfo: { address: WBNB, decimals: 18, symbol: "WBNB" },
    };

    const steps = await buildVaultDepositSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 1000n,
        walletAddress: WALLET,
      },
      nativeVaultInfo,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    // Should not have approve for native
    expect(steps.some((s) => s.step === "approve")).toBe(false);
    const depositStep = steps.find((s) => s.step === "depositVault");
    expect(depositStep?.params.value).toBe(1000n);
    expect(depositStep?.params.to).toBe(NATIVE_PROVIDER);
  });

  it("should handle native BNB deposit without provider", async () => {
    const nativeVaultInfo = {
      ...baseVaultInfo,
      isNative: true,
      provider: zeroAddress,
      assetInfo: { address: WBNB, decimals: 18, symbol: "WBNB" },
    };

    const steps = await buildVaultDepositSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 1000n,
        walletAddress: WALLET,
      },
      nativeVaultInfo,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    const depositStep = steps.find((s) => s.step === "depositVault");
    expect(depositStep?.params.to).toBe(VAULT_ADDRESS);
  });

  it("should skip approve when allowance is sufficient", async () => {
    // Dispatched, not blanket. `mockResolvedValue` answered `provider()` with
    // a bigint as well as `allowance`, so the resolver got a number where an
    // address belongs and the assertions below — which only count steps —
    // never looked at the target it produced.
    mockReadContract.mockImplementation(
      vaultSaying(zeroAddress, 10000n * 10n ** 18n),
    );

    const steps = await buildVaultDepositSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 100n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseVaultInfo,
      { publicClient: mockPublicClient, network: "bsc" },
    );

    expect(steps.filter((s) => s.step === "approve")).toHaveLength(0);
    const deposit = steps.find((s) => s.step === "depositVault");
    expect(deposit?.params.to).toBe(VAULT_ADDRESS);
  });
});

describe("buildVaultWithdrawSteps", () => {
  it("should build withdraw by assets step", async () => {
    const steps = await buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseVaultInfo,
      withdrawDeps,
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("withdrawVault");
    expect(steps[0].params.functionName).toBe("withdraw");
  });

  it("should build withdraw by shares step", async () => {
    const steps = await buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        shares: 500n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseVaultInfo,
      withdrawDeps,
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("withdrawVault");
    expect(steps[0].params.functionName).toBe("redeem");
  });

  it("should handle withdrawAll with user data", async () => {
    const userData = {
      shares: { numerator: 1000n * 10n ** 18n },
    } as unknown as VaultUserData;

    const steps = await buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        withdrawAll: true,
        walletAddress: WALLET,
      },
      baseVaultInfo,
      withdrawDeps,
      userData,
    );

    expect(steps[0].params.functionName).toBe("redeem");
    expect(steps[0].params.args).toContain(1000n * 10n ** 18n);
  });

  it("should use receiver if provided", async () => {
    const receiver = "0x6666666666666666666666666666666666666666" as Address;
    const steps = await buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 500n,
        walletAddress: WALLET,
        receiver,
      },
      baseVaultInfo,
      withdrawDeps,
    );

    expect(steps[0].params.args).toContain(receiver);
  });

  it("should use provider for native BNB with shares", async () => {
    const nativeVaultInfo = {
      ...baseVaultInfo,
      isNative: true,
      provider: PROVIDER,
      assetInfo: { address: WBNB, decimals: 18, symbol: "WBNB" },
    };

    const steps = await buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        shares: 500n,
        walletAddress: WALLET,
      },
      nativeVaultInfo,
      withdrawDepsVia(PROVIDER),
    );

    expect(steps[0].params.to).toBe(PROVIDER);
  });

  it("should use provider for native BNB with assets", async () => {
    const nativeVaultInfo = {
      ...baseVaultInfo,
      isNative: true,
      provider: PROVIDER,
      assetInfo: { address: WBNB, decimals: 18, symbol: "WBNB" },
    };

    const steps = await buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 500n,
        walletAddress: WALLET,
      },
      nativeVaultInfo,
      withdrawDepsVia(PROVIDER),
    );

    expect(steps[0].params.to).toBe(PROVIDER);
  });

  it("should throw when neither assets nor shares provided", async () => {
    await expect(
      buildVaultWithdrawSteps(
        {
          chainId: 56,
          vaultAddress: VAULT_ADDRESS,
          walletAddress: WALLET,
        },
        baseVaultInfo,
        withdrawDeps,
      ),
    ).rejects.toThrow("assets or shares is required for vault withdraw");
  });
});
