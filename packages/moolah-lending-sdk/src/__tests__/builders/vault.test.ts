import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PublicClient, Address } from "viem";
import { zeroAddress } from "viem";
import {
  buildVaultDepositSteps,
  buildVaultWithdrawSteps,
} from "../../builders/vault";
import {
  Decimal,
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
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address;

const baseVaultInfo: VaultInfo = {
  assetInfo: { address: ASSET_TOKEN, decimals: 18, symbol: "ASSET" },
  totalAssets: new Decimal(0n, 18),
  totalSupply: new Decimal(0n, 18),
  isNative: false,
  isProvider: false,
  provider: zeroAddress,
};

describe("buildVaultDepositSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadContract.mockResolvedValue(0n);
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
    const nativeVaultInfo = {
      ...baseVaultInfo,
      isNative: true,
      provider: PROVIDER,
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
    expect(depositStep?.params.to).toBe(PROVIDER);
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
    mockReadContract.mockResolvedValue(10000n * 10n ** 18n);

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
    expect(steps.some((s) => s.step === "depositVault")).toBe(true);
  });
});

describe("buildVaultWithdrawSteps", () => {
  it("should build withdraw by assets step", () => {
    const steps = buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 500n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseVaultInfo,
      "bsc",
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("withdrawVault");
    expect(steps[0].params.functionName).toBe("withdraw");
  });

  it("should build withdraw by shares step", () => {
    const steps = buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        shares: 500n * 10n ** 18n,
        walletAddress: WALLET,
      },
      baseVaultInfo,
      "bsc",
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("withdrawVault");
    expect(steps[0].params.functionName).toBe("redeem");
  });

  it("should handle withdrawAll with user data", () => {
    const userData = {
      shares: { numerator: 1000n * 10n ** 18n },
    } as unknown as VaultUserData;

    const steps = buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        withdrawAll: true,
        walletAddress: WALLET,
      },
      baseVaultInfo,
      "bsc",
      userData,
    );

    expect(steps[0].params.functionName).toBe("redeem");
    expect(steps[0].params.args).toContain(1000n * 10n ** 18n);
  });

  it("should use receiver if provided", () => {
    const receiver = "0x6666666666666666666666666666666666666666" as Address;
    const steps = buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 500n,
        walletAddress: WALLET,
        receiver,
      },
      baseVaultInfo,
      "bsc",
    );

    expect(steps[0].params.args).toContain(receiver);
  });

  it("should use provider for native BNB with shares", () => {
    const nativeVaultInfo = {
      ...baseVaultInfo,
      isNative: true,
      provider: PROVIDER,
      assetInfo: { address: WBNB, decimals: 18, symbol: "WBNB" },
    };

    const steps = buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        shares: 500n,
        walletAddress: WALLET,
      },
      nativeVaultInfo,
      "bsc",
    );

    expect(steps[0].params.to).toBe(PROVIDER);
  });

  it("should use provider for native BNB with assets", () => {
    const nativeVaultInfo = {
      ...baseVaultInfo,
      isNative: true,
      provider: PROVIDER,
      assetInfo: { address: WBNB, decimals: 18, symbol: "WBNB" },
    };

    const steps = buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT_ADDRESS,
        assets: 500n,
        walletAddress: WALLET,
      },
      nativeVaultInfo,
      "bsc",
    );

    expect(steps[0].params.to).toBe(PROVIDER);
  });

  it("should throw when neither assets nor shares provided", () => {
    expect(() =>
      buildVaultWithdrawSteps(
        {
          chainId: 56,
          vaultAddress: VAULT_ADDRESS,
          walletAddress: WALLET,
        },
        baseVaultInfo,
        "bsc",
      ),
    ).toThrow("assets or shares is required for vault withdraw");
  });
});
