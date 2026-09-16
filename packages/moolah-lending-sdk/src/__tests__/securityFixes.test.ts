/**
 * Regression tests for the holes a pre-release security review found.
 *
 * Each of these was a path by which an address the SDK never verified could
 * become an approval spender, or a standing grant over every position the
 * caller holds.
 */
import { describe, it, expect, vi } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  type PublicClient,
} from "viem";
import { MOOLAH_ABI, getContractAddress } from "@lista-dao/moolah-sdk-core";
import { buildBrokerRepaySteps } from "../builders/broker.js";
import {
  buildAuthorizationTypedData,
  buildSetAuthorizationWithSigSteps,
  buildCancelSignedAuthorizationTypedData,
} from "../builders/authorizationSig.js";
import { buildVaultMintSteps } from "../builders/vault.js";
import { buildVaultWithdrawSteps } from "../builders/vault.js";
import { brokerClient } from "./helpers/brokerClient.js";
import type { VaultInfo } from "@lista-dao/moolah-sdk-core";

const BROKER = "0x0659063d10e05aa0d3d52d79e71a5a9d6d1b283a" as const;
const IMPOSTOR = "0x00000000000000000000000000000000deadbeef" as const;
const USER = "0x0000000000000000000000000000000000000033" as const;
const TOKEN = "0x0000000000000000000000000000000000000011" as const;
const VAULT = "0x0000000000000000000000000000000000000055" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const POSITION_MANAGER = "0x8eBFa9e687aF71EC2e87A0380F73b9f57FDf3ec0" as const;

const repay = (client: PublicClient) =>
  buildBrokerRepaySteps(
    {
      chainId: 56,
      brokerAddress: BROKER,
      amount: 1000n,
      loanToken: TOKEN,
      walletAddress: USER,
    },
    client,
    "bsc",
  );

describe("a broker must be the broker Moolah registered", () => {
  // The broker is the only approval spender in this SDK that arrives from the
  // REST API rather than from the chain. A format check accepts every
  // well-formed address, which is every address an attacker would supply.
  it("accepts a broker that survives the round trip", async () => {
    const steps = await repay(brokerClient({ broker: BROKER, network: "bsc" }));
    expect(steps.map((s) => s.step)).toContain("brokerRepay");
  });

  it("refuses a broker Moolah does not name for that market", async () => {
    // An impostor can claim any MARKET_ID it likes — and then Moolah returns
    // the real broker for that market, and the mismatch is the catch.
    await expect(
      repay(
        brokerClient({
          broker: BROKER,
          network: "bsc",
          registeredBroker: IMPOSTOR,
        }),
      ),
    ).rejects.toThrow(/Moolah\.brokers\(\) says/);
  });

  it("refuses a broker that belongs to a different Moolah", async () => {
    await expect(
      repay(
        brokerClient({
          broker: BROKER,
          network: "bsc",
          claimedMoolah: IMPOSTOR,
        }),
      ),
    ).rejects.toThrow(/belongs to Moolah/);
  });

  it("refuses an address that is not a LendingBroker at all", async () => {
    // A real contract-level failure, not a bare Error. The distinction is the
    // point: the old test asserted the "not a LendingBroker" message using an
    // error that carried no contract evidence at all, which is exactly the
    // reasoning the next case forbids.
    const notABroker = {
      readContract: vi.fn().mockRejectedValue(
        new BaseError("The contract function reverted.", {
          cause: new ContractFunctionRevertedError({
            abi: [],
            functionName: "MARKET_ID",
          }),
        }),
      ),
    } as unknown as PublicClient;
    await expect(repay(notABroker)).rejects.toThrow(/is not a LendingBroker/);
  });

  it("does not call an unreachable node 'not a LendingBroker'", async () => {
    // A 429 says nothing about whether the address is a broker. Reporting it
    // as a verdict about the contract is how a retryable error becomes a
    // permanent-looking one.
    const unreachable = {
      readContract: vi
        .fn()
        .mockRejectedValue(new Error("HTTP request failed. Status: 429")),
    } as unknown as PublicClient;
    await expect(repay(unreachable)).rejects.toThrow(/429/);
  });

  it("refuses a genuine broker that serves a different market", async () => {
    // Registered by *some* market is not registered by *this* one. Nothing is
    // stolen — the spender is a real protocol contract — but the repayment
    // lands somewhere the caller did not choose.
    await expect(
      buildBrokerRepaySteps(
        {
          chainId: 56,
          brokerAddress: BROKER,
          amount: 1000n,
          loanToken: TOKEN,
          walletAddress: USER,
          marketId: `0x${"ab".repeat(32)}`,
        },
        brokerClient({ broker: BROKER, network: "bsc" }),
        "bsc",
      ),
    ).rejects.toThrow(/serves market .*, not 0xabab/);
  });
});

describe("the signature path applies the same allowlist as the transaction path", () => {
  // The guard existed on `buildSetAuthorizationSteps` and nowhere else, so the
  // signature path — the one with no undo, because a revoke does not consume
  // the nonce — would sign a grant to any address at all.
  const authorization = (authorized: `0x${string}`, isAuthorized = true) => ({
    authorizer: USER,
    authorized,
    isAuthorized,
    nonce: 0n,
    deadline: 1_800_000_600n,
  });
  const clock = { now: 1_800_000_000n };

  it("refuses to produce signable data for an unknown target", () => {
    expect(() =>
      buildAuthorizationTypedData(authorization(IMPOSTOR), {
        chainId: 56,
        network: "bsc",
        ...clock,
      }),
    ).toThrow(/not a known authorizable contract/);
  });

  it("refuses to submit a signed grant to an unknown target", () => {
    expect(() =>
      buildSetAuthorizationWithSigSteps(
        {
          chainId: 56,
          authorization: authorization(IMPOSTOR),
          signature: {
            v: 27,
            r: `0x${"11".repeat(32)}`,
            s: `0x${"22".repeat(32)}`,
          },
        },
        "bsc",
      ),
    ).toThrow(/not a known authorizable contract/);
  });

  it("allows the PositionManager", () => {
    expect(() =>
      buildAuthorizationTypedData(authorization(POSITION_MANAGER), {
        chainId: 56,
        network: "bsc",
        ...clock,
      }),
    ).not.toThrow();
  });

  it("allows an unknown target only when opted into explicitly", () => {
    expect(() =>
      buildAuthorizationTypedData(authorization(IMPOSTOR), {
        chainId: 56,
        network: "bsc",
        allowUnknownTarget: true,
        ...clock,
      }),
    ).not.toThrow();
  });

  it("does not gate a revoke, which is always safe to sign", () => {
    expect(() =>
      buildAuthorizationTypedData(authorization(IMPOSTOR, false), {
        chainId: 56,
        network: "bsc",
        ...clock,
      }),
    ).not.toThrow();
  });
});

describe("a signed authorization can actually be cancelled", () => {
  // The revoke docstring pointed at a helper that did not exist, so a user who
  // signed a grant to the wrong target had no SDK-supported action at all: a
  // plain revoke lands, looks successful, and the relayer's signature still
  // works afterwards.
  const client = (nonce: bigint) =>
    ({
      readContract: vi.fn().mockResolvedValue(nonce),
    }) as unknown as PublicClient;

  it("burns the nonce the outstanding signature was built against", async () => {
    const typedData = await buildCancelSignedAuthorizationTypedData(
      {
        authorizer: USER,
        nonce: 7n,
        chainId: 56,
        network: "bsc",
        now: 1_800_000_000n,
      },
      { publicClient: client(7n) },
    );
    expect(typedData.message.nonce).toBe(7n);
    expect(typedData.message.isAuthorized).toBe(false);
    // Self-targeted, so it confers nothing if it lands. It exists to spend the
    // nonce, and a self-grant is the one target that is inert either way.
    expect(typedData.message.authorized).toBe(USER);
    expect(typedData.domain.verifyingContract).toBe(
      getContractAddress("bsc", "moolah"),
    );
  });

  // Three states, and the dangerous one is not "already consumed" — it is
  // "already consumed, therefore the signature was submitted, therefore the
  // grant is live right now". Telling the user there is nothing left to cancel
  // is true about the signature and an all-clear about the wrong thing.
  it("says the grant is live when the nonce was already spent", async () => {
    await expect(
      buildCancelSignedAuthorizationTypedData(
        { authorizer: USER, nonce: 7n, chainId: 56, network: "bsc" },
        { publicClient: client(8n) },
      ),
    ).rejects.toThrow(/already submitted[\s\S]*buildRevokeAuthorizationParams/);
  });

  // And the opposite state: the signature is not dead, it is not yet reachable.
  // Burning this nonce would advance the counter *towards* it.
  it("says the signature is still live when its nonce has not been reached", async () => {
    await expect(
      buildCancelSignedAuthorizationTypedData(
        { authorizer: USER, nonce: 9n, chainId: 56, network: "bsc" },
        { publicClient: client(7n) },
      ),
    ).rejects.toThrow(/has not been reached yet[\s\S]*lowest\s*first/);
  });

  it("does not refuse its own ttl above the one-hour signing cap", async () => {
    // The cap exists because a distant deadline on a *grant* is an
    // uncancellable standing grant. A cancel confers nothing, so the cap has
    // nothing to protect here and must not block it.
    const typedData = await buildCancelSignedAuthorizationTypedData(
      {
        authorizer: USER,
        nonce: 7n,
        chainId: 56,
        network: "bsc",
        ttlSeconds: 7200n,
        now: 1_800_000_000n,
      },
      { publicClient: client(7n) },
    );
    expect(typedData.message.deadline).toBe(1_800_007_200n);
  });
});

describe("a vault's provider decides how it is entered, and how it is left", () => {
  const HONEST_PROVIDER = "0x0000000000000000000000000000000000000088" as const;
  /** A client that answers `provider()` with nothing, for the plain paths. */
  const noProvider = {
    publicClient: {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "provider" ? ZERO : 0n,
      ),
    } as unknown as PublicClient,
    network: "bsc" as const,
  };
  const base = {
    assetInfo: { address: TOKEN, symbol: "T", decimals: 18 },
    isNative: false,
    isProvider: false,
    provider: ZERO,
  } as unknown as VaultInfo;

  it("refuses mint only for a native-provider vault", async () => {
    await expect(
      buildVaultMintSteps(
        { chainId: 56, vaultAddress: VAULT, shares: 100n, walletAddress: USER },
        { ...base, isNative: true, isProvider: true, provider: IMPOSTOR },
        {
          publicClient: {
            readContract: vi.fn(
              async ({ functionName }: { functionName: string }) =>
                functionName === "provider" ? IMPOSTOR : 0n,
            ),
          } as unknown as PublicClient,
          network: "bsc",
        },
      ),
    ).rejects.toThrow(/no mint entry point/);
  });

  it("does not let the provider-routing override bypass a native mint refusal", async () => {
    await expect(
      buildVaultMintSteps(
        {
          chainId: 56,
          vaultAddress: VAULT,
          shares: 100n,
          walletAddress: USER,
          allowProviderRouting: true,
        },
        { ...base, isNative: true, isProvider: true, provider: IMPOSTOR },
        {
          publicClient: {
            readContract: vi.fn(
              async ({ functionName }: { functionName: string }) =>
                functionName === "provider" ? IMPOSTOR : 0n,
            ),
          } as unknown as PublicClient,
          network: "bsc",
        },
      ),
    ).rejects.toThrow(/no mint entry point/);
  });

  it("refuses a non-native provider too, but says why it is different", async () => {
    // Not because the provider is known to lack `mint` — because nothing has
    // established that it has one. Guessing wrong sends a real approve and
    // then aborts before the clear step, leaving the allowance standing.
    await expect(
      buildVaultMintSteps(
        { chainId: 56, vaultAddress: VAULT, shares: 100n, walletAddress: USER },
        { ...base, isProvider: true, provider: IMPOSTOR },
        {
          publicClient: {
            readContract: vi.fn(
              async ({ functionName }: { functionName: string }) =>
                functionName === "provider" ? IMPOSTOR : 0n,
            ),
          } as unknown as PublicClient,
          network: "bsc",
        },
      ),
    ).rejects.toThrow(/has not established that the provider implements mint/);
  });

  it("routes through the provider when the caller has verified it", async () => {
    const steps = await buildVaultMintSteps(
      {
        chainId: 56,
        vaultAddress: VAULT,
        shares: 100n,
        walletAddress: USER,
        maxAssets: 5000n,
        allowProviderRouting: true,
      },
      { ...base, isProvider: true, provider: IMPOSTOR },
      {
        publicClient: {
          readContract: vi.fn(
            async ({ functionName }: { functionName: string }) =>
              functionName === "provider" ? IMPOSTOR : 0n,
          ),
        } as unknown as PublicClient,
        network: "bsc",
      },
    );
    const mint = steps.find((s) => s.step === "vaultMint")!;
    expect(mint.params.to).toBe(IMPOSTOR);
    expect(steps[0].meta?.spender).toBe(IMPOSTOR);
  });

  it("rejects a zero-share redeem instead of encoding a no-op", async () => {
    // `redeem(0)` succeeds, moves nothing, and makes
    // `after - before === requested` true on both sides — a green assertion
    // that proves nothing.
    await expect(
      buildVaultWithdrawSteps(
        { chainId: 56, vaultAddress: VAULT, shares: 0n, walletAddress: USER },
        base,
        noProvider,
      ),
    ).rejects.toThrow(/greater than zero/);
  });

  it("says so plainly when withdrawAll finds nothing to withdraw", async () => {
    await expect(
      buildVaultWithdrawSteps(
        {
          chainId: 56,
          vaultAddress: VAULT,
          withdrawAll: true,
          walletAddress: USER,
        },
        base,
        noProvider,
        { shares: { numerator: 0n } } as never,
      ),
    ).rejects.toThrow(/nothing to withdraw/);
  });

  it("rejects a zero-asset withdrawal", async () => {
    await expect(
      buildVaultWithdrawSteps(
        { chainId: 56, vaultAddress: VAULT, assets: 0n, walletAddress: USER },
        base,
        noProvider,
      ),
    ).rejects.toThrow(/greater than zero/);
  });

  it("withdraws through the provider the vault names, not the config's", async () => {
    // The regression this file exists for, in its exit form. Deposit resolved
    // and withdraw did not, so a config cached across a provider migration put
    // the assets in through the new provider and asked the old one to release
    // them — a position you can enter and cannot leave.
    const steps = await buildVaultWithdrawSteps(
      {
        chainId: 56,
        vaultAddress: VAULT,
        assets: 1000n,
        walletAddress: USER,
      },
      { ...base, isNative: true, provider: IMPOSTOR } as never,
      {
        publicClient: {
          readContract: vi.fn(
            async ({ functionName }: { functionName: string }) =>
              functionName === "provider" ? HONEST_PROVIDER : 0n,
          ),
        } as unknown as PublicClient,
        network: "bsc",
      },
    );
    expect(steps.every((s) => s.params.to !== IMPOSTOR)).toBe(true);
    expect(steps.some((s) => s.params.to === HONEST_PROVIDER)).toBe(true);
  });
});

describe("MOOLAH_ABI models the read the broker check depends on", () => {
  it("has brokers(bytes32)", () => {
    const names = MOOLAH_ABI.filter((e) => e.type === "function").map(
      (e) => e.name,
    );
    expect(names).toContain("brokers");
  });
});

describe("the class API can reach the options the builders expose", () => {
  // The facade copied params field by field in one place, which silently
  // dropped two options. An earlier version of this test only inspected its
  // own input object and would have passed with the bug still in place — so it
  // exercises the builder the facade forwards to instead.
  it("keepAllowance suppresses the reclaim step", async () => {
    const withClear = await buildBrokerRepaySteps(
      {
        chainId: 56,
        brokerAddress: BROKER,
        amount: 1000n,
        loanToken: TOKEN,
        walletAddress: USER,
      },
      brokerClient({ broker: BROKER, network: "bsc" }),
      "bsc",
    );
    const withoutClear = await buildBrokerRepaySteps(
      {
        chainId: 56,
        brokerAddress: BROKER,
        amount: 1000n,
        loanToken: TOKEN,
        walletAddress: USER,
        keepAllowance: true,
      },
      brokerClient({ broker: BROKER, network: "bsc" }),
      "bsc",
    );
    expect(withClear.map((s) => s.step)).toEqual([
      "approve",
      "brokerRepay",
      "approve",
    ]);
    expect(withoutClear.map((s) => s.step)).toEqual(["approve", "brokerRepay"]);
  });

  it("marketId binds the broker to the market being repaid", async () => {
    await expect(
      buildBrokerRepaySteps(
        {
          chainId: 56,
          brokerAddress: BROKER,
          amount: 1000n,
          loanToken: TOKEN,
          walletAddress: USER,
          marketId: `0x${"ab".repeat(32)}`,
        },
        brokerClient({ broker: BROKER, network: "bsc" }),
        "bsc",
      ),
    ).rejects.toThrow(/serves market/);
  });
});

describe("what a supplied config still decides, and what it no longer can", () => {
  // The providers used to be checked here and are not any more: every builder
  // that targets one resolves it from `Moolah.providers` itself, so the
  // config's copy is inert. Asserting on an inert field can only produce false
  // rejections — a correctly-cached config from before a provider migration
  // would be refused, including the one building an exit. What a config still
  // decides is the market and the approved token addresses, and those are
  // checked below.
  const HONEST = "0x0000000000000000000000000000000000000099" as const;
  const PARAMS = {
    loanToken: TOKEN,
    collateralToken: "0x0000000000000000000000000000000000000002",
    oracle: "0x0000000000000000000000000000000000000003",
    irm: "0x0000000000000000000000000000000000000004",
    lltv: 800000000000000000n,
  } as const;

  const config = (loanProvider: string, collateralProvider: string) => ({
    params: PARAMS,
    loanProvider,
    collateralProvider,
  });

  it("no longer rejects a config whose providers disagree with the chain", async () => {
    // This is the behaviour change, asserted rather than assumed. A stale
    // provider is not an error: the builders overwrite it. Rejecting here
    // would strand anyone holding a config cached across a migration.
    const { assertMarketConfigMatchesMarket } =
      await import("../configTrust.js");
    const { marketIdOf } = await import("../builders/sharePricing.js");
    expect(() =>
      assertMarketConfigMatchesMarket(
        marketIdOf(PARAMS as never),
        config(IMPOSTOR, IMPOSTOR) as never,
      ),
    ).not.toThrow();
  });

  it("refuses a config that describes a different market entirely", async () => {
    const { assertMarketConfigMatchesMarket } =
      await import("../configTrust.js");
    expect(() =>
      assertMarketConfigMatchesMarket(
        `0x${"cd".repeat(32)}`,
        config(HONEST, HONEST) as never,
      ),
    ).toThrow(/describes market .*, not 0xcdcd/);
  });

  it("refuses token metadata that disagrees with the market params", async () => {
    // The builders approve `loanInfo.address`, not `params.loanToken`, so a
    // config with genuine params and forged metadata approves one token and
    // calls a market that pulls another. Resolution cannot reach this one —
    // there is nothing on chain to resolve a config's own metadata against.
    const { assertMarketConfigMatchesMarket } =
      await import("../configTrust.js");
    const { marketIdOf } = await import("../builders/sharePricing.js");
    expect(() =>
      assertMarketConfigMatchesMarket(marketIdOf(PARAMS as never), {
        ...config(HONEST, HONEST),
        loanInfo: { address: IMPOSTOR, symbol: "X", decimals: 18 },
      } as never),
    ).toThrow(/loan token metadata/);
  });

  it("refuses a vault config naming an asset the vault does not", async () => {
    // With no provider the vault itself is both spender and target, so the
    // asset is what decides which token gets approved to it — and unlike the
    // provider, nothing downstream re-reads it.
    const { assertVaultConfigAsset } = await import("../configTrust.js");
    await expect(
      assertVaultConfigAsset(
        VAULT,
        {
          assetInfo: { address: IMPOSTOR, symbol: "X", decimals: 18 },
        } as never,
        {
          readContract: vi.fn(
            async ({ functionName }: { functionName: string }) =>
              functionName === "asset" ? TOKEN : ZERO,
          ),
        } as unknown as PublicClient,
      ),
    ).rejects.toThrow(/asset in the supplied vault config/);
  });
});

describe("a Smart Lending config's pool tokens are approval subjects too", () => {
  // `WriteSmartMarketConfig` has no `collateralInfo` — it has `lpInfo`,
  // `tokenAInfo` and `tokenBInfo` — so a metadata check written against the
  // plain market's field name silently did nothing for every Smart config,
  // while `buildSmartSupplyCollateralSteps` approved `tokenAInfo.address` and
  // `tokenBInfo.address`. A check that hangs off an optional field stops
  // existing when the shape changes underneath it.
  const PROVIDER = "0x0000000000000000000000000000000000000077" as const;
  const TOKEN_A = "0x000000000000000000000000000000000000000a" as const;
  const TOKEN_B = "0x000000000000000000000000000000000000000b" as const;

  // `providers` first — the check resolves the provider itself now rather than
  // trusting the config to name it.
  const providerSaying = (a: string, b: string, lp: string = LP) =>
    ({
      readContract: vi.fn(
        async ({
          functionName,
          args,
        }: {
          functionName: string;
          args?: readonly unknown[];
        }) =>
          functionName === "providers"
            ? PROVIDER
            : functionName === "dexLP"
              ? lp
              : args?.[0] === 0n
                ? a
                : b,
      ),
    }) as unknown as PublicClient;

  const LP = "0x00000000000000000000000000000000000000c1" as const;
  const SMART_PARAMS = {
    loanToken: TOKEN,
    collateralToken: "0x0000000000000000000000000000000000000002",
    oracle: "0x0000000000000000000000000000000000000003",
    irm: "0x0000000000000000000000000000000000000004",
    lltv: 800000000000000000n,
  } as const;
  const smartConfig = (a: string, b: string) => ({
    params: SMART_PARAMS,
    tokenAInfo: { address: a, symbol: "A", decimals: 18 },
    tokenBInfo: { address: b, symbol: "B", decimals: 18 },
    lpInfo: { address: LP, symbol: "LP", decimals: 18 },
  });

  it("accepts tokens the provider confirms", async () => {
    const { assertSmartConfigTokens } = await import("../configTrust.js");
    await expect(
      assertSmartConfigTokens(
        smartConfig(TOKEN_A, TOKEN_B) as never,
        providerSaying(TOKEN_A, TOKEN_B),
        "bsc",
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a substituted tokenA", async () => {
    const { assertSmartConfigTokens } = await import("../configTrust.js");
    await expect(
      assertSmartConfigTokens(
        smartConfig(IMPOSTOR, TOKEN_B) as never,
        providerSaying(TOKEN_A, TOKEN_B),
        "bsc",
      ),
    ).rejects.toThrow(/names .* as tokenA/);
  });

  it("refuses a substituted tokenB", async () => {
    const { assertSmartConfigTokens } = await import("../configTrust.js");
    await expect(
      assertSmartConfigTokens(
        smartConfig(TOKEN_A, IMPOSTOR) as never,
        providerSaying(TOKEN_A, TOKEN_B),
        "bsc",
      ),
    ).rejects.toThrow(/names .* as tokenB/);
  });

  it("checks the pool LP token against the provider, not against params", async () => {
    // The market's collateral token is the provider's wrapper; `lpInfo` is the
    // pool's LP. Two different addresses — comparing them rejects every valid
    // Smart config, which is what running the harness caught.
    const { assertSmartConfigTokens } = await import("../configTrust.js");
    await expect(
      assertSmartConfigTokens(
        {
          params: SMART_PARAMS,
          tokenAInfo: { address: TOKEN_A, symbol: "A", decimals: 18 },
          tokenBInfo: { address: TOKEN_B, symbol: "B", decimals: 18 },
          lpInfo: { address: IMPOSTOR, symbol: "LP", decimals: 18 },
        } as never,
        providerSaying(TOKEN_A, TOKEN_B, LP),
        "bsc",
      ),
    ).rejects.toThrow(/pool LP token/);
  });
});
