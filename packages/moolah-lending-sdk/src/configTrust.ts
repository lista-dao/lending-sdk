import type { Address, PublicClient } from "viem";
import { marketIdOf } from "./builders/sharePricing.js";
import {
  MOOLAH_ABI,
  MOOLAH_VAULT_ABI,
  getContractAddress,
  type NetworkName,
  SMART_PROVIDER_ABI,
  type VaultInfo,
  type WriteMarketConfig,
  type WriteSmartMarketConfig,
} from "@lista-dao/moolah-sdk-core";

/**
 * What a supplied config still decides, now that providers are resolved.
 *
 * This function used to compare `loanProvider` / `collateralProvider` against
 * `Moolah.providers` and throw on a mismatch. That check is gone, and its
 * removal is the point rather than a regression: every builder that targets a
 * provider now reads it from the chain itself (see `resolveProviders.ts`), so
 * the config's copy is not load-bearing and cannot be. Asserting on a field
 * nothing reads can only produce false rejections — during a provider
 * migration it would reject every correctly-cached config, including the ones
 * building an exit, which is exactly the failure mode resolving was chosen to
 * avoid. Keeping both was having it neither way.
 *
 * What a config does still decide is the **market** and the **token addresses
 * that get approved**, and neither is recoverable by resolution:
 *
 *  - `params` names the market. Only the facade can check that, because only
 *    the facade is told which market the caller meant.
 *  - `loanInfo.address` / `collateralInfo.address` are approval subjects, and
 *    must agree with `params`. Free to check.
 *
 * A Smart market's `tokenAInfo` / `tokenBInfo` / `lpInfo` appear nowhere in
 * `params` and need {@link assertSmartConfigTokens}.
 *
 * Callers who resolve configs themselves can skip all of it with
 * `trustedConfig: true`.
 */
export function assertMarketConfigMatchesMarket(
  marketId: `0x${string}`,
  config: Pick<WriteMarketConfig, "params">,
): void {
  // Bind the config to the market. This is the whole job now, and it is the
  // one question a caller-supplied config cannot answer about itself: the
  // params decide which market the value goes to, and `marketId` is what the
  // caller believed they were building against.
  const derived = marketIdOf(config.params);
  if (derived.toLowerCase() !== marketId.toLowerCase()) {
    throw new Error(
      `The supplied config describes market ${derived}, not ${marketId}. A ` +
        `config decides which market the value goes to — refusing to build ` +
        `against it. Drop the override, or pass trustedConfig if you resolved ` +
        `it yourself.`,
    );
  }

  // The builders approve `loanInfo.address` / `collateralInfo.address`, not
  // `params.*Token` — so checking the params alone leaves a config with genuine
  // params and forged metadata passing, after which the SDK approves one token
  // and calls a market that pulls another. Free to check, and the two must
  // agree by construction.
  const metadata = config as Partial<WriteMarketConfig> &
    Partial<Pick<WriteSmartMarketConfig, "lpInfo">>;
  if (
    metadata.loanInfo &&
    metadata.loanInfo.address.toLowerCase() !==
      config.params.loanToken.toLowerCase()
  ) {
    throw new Error(
      `The supplied config's loan token metadata is ${metadata.loanInfo.address}, ` +
        `but its market params say ${config.params.loanToken}. That address ` +
        `becomes an approval spend target — refusing to build against it.`,
    );
  }
  // Only `collateralInfo`, and only on a plain market. A Smart config has no
  // such field, and `lpInfo` is not its substitute: the market's collateral
  // token is the provider's own wrapper, while `lpInfo` is the pool's LP token
  // — two different addresses (0x23BC…30 vs 0xF613…0B on the USDT/USDC
  // market). Comparing them rejects every valid Smart config. `lpInfo` is
  // checked against the provider's `dexLP()` in assertSmartConfigTokens,
  // which is the only thing that can speak for it.
  if (
    metadata.collateralInfo &&
    metadata.collateralInfo.address.toLowerCase() !==
      config.params.collateralToken.toLowerCase()
  ) {
    throw new Error(
      `The supplied config's collateral token metadata is ` +
        `${metadata.collateralInfo.address}, but its market params say ` +
        `${config.params.collateralToken}. Refusing to build against it.`,
    );
  }
}

/**
 * The vault equivalent, and for the same reason it checks only the asset.
 *
 * `provider` is resolved from `vault.provider()` by every vault builder, so
 * the config's copy is inert — see the note on
 * {@link assertMarketConfigMatchesMarket}.
 *
 * The asset is not. It is the token the SDK approves, it has no counterpart
 * the builders read from the chain on the way past, and when the vault has no
 * provider the vault itself is the spender — so a config pairing a plausible
 * vault with someone else's token would have the SDK approve that token to
 * that vault. That one still has to be asked.
 */
export async function assertVaultConfigAsset(
  vaultAddress: Address,
  config: Partial<Pick<VaultInfo, "assetInfo">>,
  publicClient: PublicClient,
): Promise<void> {
  if (!config.assetInfo) return;

  const asset = (await publicClient.readContract({
    address: vaultAddress,
    abi: MOOLAH_VAULT_ABI,
    functionName: "asset",
  })) as Address;
  if (config.assetInfo.address.toLowerCase() !== asset.toLowerCase()) {
    throw new Error(
      `The asset in the supplied vault config is ${config.assetInfo.address}, ` +
        `but vault ${vaultAddress} says ${asset}. That address is what gets ` +
        `approved — refusing to build against this config.`,
    );
  }
}

/**
 * Where a supplied config is still load-bearing, and where it is not.
 *
 * The builders no longer take the config's word for `loanProvider` or
 * `collateralProvider` — those are resolved from `Moolah.providers` at build
 * time, so the approval spender and the call target are chain-derived on every
 * path, facade or not. See `resolveProviders.ts`.
 *
 * What a config still decides:
 *
 *  - the **token addresses** that get approved — `loanInfo.address`,
 *    `collateralInfo.address` / `lpInfo.address`, and on a Smart market
 *    `tokenAInfo.address` / `tokenBInfo.address`. The first three must agree
 *    with `params`, which is free to check; the last two have no counterpart in
 *    `params` at all and are checked against the provider's own `token(0)` and
 *    `token(1)` by {@link assertSmartConfigTokens}.
 *  - the **market** itself, via `params`. Binding that to a caller-named
 *    `marketId` is the one check only the facade can make, because a caller
 *    building steps directly never names a market — it is implied by the config
 *    they hand in.
 *
 * So the facade still verifies more than a direct builder call does. If you are
 * building steps without it, call {@link assertMarketConfigMatchesMarket} —
 * and, for a Smart market, {@link assertSmartConfigTokens}, and for a vault
 * {@link assertVaultConfigAsset} — once where your config enters your process.
 * All three are exported from the package root and from
 * `@lista-dao/moolah-lending-sdk/builders`.
 */

/**
 * The three token addresses a Smart Lending config names as approval subjects.
 *
 * `buildSmartSupplyCollateralSteps` approves `tokenAInfo.address` and
 * `tokenBInfo.address`; `buildSmartSupplyDexLpSteps` approves
 * `lpInfo.address`. None of the three appears anywhere in `params` — the
 * market's collateral token is the provider's wrapper, not the pool LP — so
 * the market-level checks cannot reach them. The provider can: it names its own
 * pair and its own LP, and it has already been resolved from
 * `Moolah.providers` by the time this runs.
 */
export async function assertSmartConfigTokens(
  config: Pick<
    WriteSmartMarketConfig,
    "params" | "tokenAInfo" | "tokenBInfo" | "lpInfo"
  >,
  publicClient: PublicClient,
  network: NetworkName,
): Promise<void> {
  // The provider is resolved here rather than taken from the config. Reading
  // the config's own `collateralProvider` made this self-referential: a forged
  // config supplies a forged provider, which cheerfully confirms its forged
  // tokens. That was safe only inside `resolveSmartConfig`, where the provider
  // had already been pinned — and the function is exported for callers who are
  // not inside it.
  const provider = (await publicClient.readContract({
    address: getContractAddress(network, "moolah"),
    abi: MOOLAH_ABI,
    functionName: "providers",
    args: [marketIdOf(config.params), config.params.collateralToken],
  })) as Address;

  const [tokenA, tokenB, dexLP] = await Promise.all([
    publicClient.readContract({
      address: provider,
      abi: SMART_PROVIDER_ABI,
      functionName: "token",
      args: [0n],
    }) as Promise<Address>,
    publicClient.readContract({
      address: provider,
      abi: SMART_PROVIDER_ABI,
      functionName: "token",
      args: [1n],
    }) as Promise<Address>,
    publicClient.readContract({
      address: provider,
      abi: SMART_PROVIDER_ABI,
      functionName: "dexLP",
    }) as Promise<Address>,
  ]);

  for (const [label, given, onChain] of [
    ["tokenA", config.tokenAInfo.address, tokenA],
    ["tokenB", config.tokenBInfo.address, tokenB],
    // Approved when supplying the raw LP token directly.
    ["the pool LP token", config.lpInfo.address, dexLP],
  ] as const) {
    if (given.toLowerCase() !== onChain.toLowerCase()) {
      throw new Error(
        `The supplied Smart Lending config names ${given} as ${label}, but ` +
          `provider ${provider} says ${onChain}. That address ` +
          `is what gets approved — refusing to build against this config.`,
      );
    }
  }
}
