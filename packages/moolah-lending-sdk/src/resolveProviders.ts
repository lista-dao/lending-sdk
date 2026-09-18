import type { Address, PublicClient } from "viem";
import { zeroAddress } from "viem";
import {
  MOOLAH_ABI,
  MOOLAH_VAULT_ABI,
  SMART_PROVIDER_ABI,
  getContractAddress,
  type NetworkName,
  type VaultInfo,
  type WriteMarketConfig,
  type WriteSmartMarketConfig,
} from "@lista-dao/moolah-sdk-core";
import { isContractLevelFailure } from "./rpcErrors.js";
import { marketIdOf } from "./builders/sharePricing.js";
import { NATIVE_ADDRESS } from "./read/smart/getSmartMarketExtraInfo.js";

/**
 * Take the chain's word for the provider — and for whether it's native.
 *
 * `loanProvider` and `collateralProvider` are the addresses this SDK approves
 * tokens to and sends native value to. Everywhere else they are read from
 * `Moolah.providers`, which is what the invariant in `configTrust.ts` rests on
 * — and a caller-supplied config was the one way round it.
 *
 * The `*IsNative` flags used to stay as the config gave them, guarded by a
 * check that only caught one case: a flag claiming native routing into a
 * provider that resolved to the zero address. It missed the case where the
 * provider resolves to a real, ordinary ERC-20 provider for a market that
 * isn't native at all — a stale or forged flag there skips the approval step
 * entirely and attaches `value` to a call the resolved provider was never
 * built to receive. The read path already knows how to tell native from not:
 * `getMarketExtraInfo`/`getSmartMarketExtraInfo` derive `loanIsNative` /
 * `collateralIsNative` by comparing the resolved provider against the
 * network's singleton `nativeProvider`, and derive `tokenAIsNative` /
 * `tokenBIsNative` by comparing the Smart provider's own `token(0)` /
 * `token(1)` against the native sentinel address. Doing the same here makes
 * every flag chain-derived instead of caller-supplied, the same treatment
 * already given to the provider addresses themselves — and it subsumes the
 * old zero-address guard for free: a provider that resolves to `0x0` can
 * never equal the (non-zero) `nativeProvider` singleton, so it is never
 * derived as native, and the value-bearing branch is never taken.
 */
export async function withResolvedProviders<
  T extends Pick<
    WriteMarketConfig,
    "params" | "loanProvider" | "collateralProvider"
  >,
>(config: T, publicClient: PublicClient, network: NetworkName): Promise<T> {
  const moolah = getContractAddress(network, "moolah");
  const nativeProvider = getContractAddress(network, "nativeProvider");
  const marketId = marketIdOf(config.params);

  const [loanProvider, collateralProvider] = await Promise.all([
    publicClient.readContract({
      address: moolah,
      abi: MOOLAH_ABI,
      functionName: "providers",
      args: [marketId, config.params.loanToken],
    }) as Promise<Address>,
    publicClient.readContract({
      address: moolah,
      abi: MOOLAH_ABI,
      functionName: "providers",
      args: [marketId, config.params.collateralToken],
    }) as Promise<Address>,
  ]);

  const resolved: Partial<WriteMarketConfig> & Partial<WriteSmartMarketConfig> =
    { loanIsNative: loanProvider === nativeProvider };

  // `collateralIsNative` only exists on a plain market config — a Smart
  // config's collateral leg is always the provider's own LP wrapper, never
  // itself native, so it carries no such field to overwrite.
  if ("collateralIsNative" in config) {
    resolved.collateralIsNative = collateralProvider === nativeProvider;
  }

  // A Smart config names its native pool tokens `tokenAIsNative` /
  // `tokenBIsNative` instead, resolved against the *pair's own* token
  // addresses rather than the provider identity — the same two extra reads
  // `getSmartMarketExtraInfo` and `assertSmartConfigTokens` already make.
  if ("tokenAIsNative" in config || "tokenBIsNative" in config) {
    // A zero provider has no bytecode at all, so every Smart builder that
    // targets `collateralProvider` — supply, both withdrawal variants, LP
    // redemption — would otherwise go on to build a step against `0x0`. That
    // is not the recoverable failure a normal ERC-20 path is: a call to an
    // address with no code always succeeds, moving nothing, so the step
    // would report success and do nothing. Refusing here, at resolution, is
    // the one place that protects every one of those builders at once.
    if (collateralProvider === zeroAddress) {
      throw new Error(
        `withResolvedProviders: Moolah has no collateral provider registered ` +
          `for market ${marketId} — this is not a Smart Lending market, or its ` +
          `pair is not registered yet. Refusing to build a step against the ` +
          `zero address.`,
      );
    }
    const [tokenA, tokenB] = await Promise.all([
      publicClient.readContract({
        address: collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "token",
        args: [0n],
      }) as Promise<Address>,
      publicClient.readContract({
        address: collateralProvider,
        abi: SMART_PROVIDER_ABI,
        functionName: "token",
        args: [1n],
      }) as Promise<Address>,
    ]).catch((error: unknown) => {
      // A real but non-conforming provider — zone 6, advertised as Smart
      // Lending by the feed but not implementing this interface at all (see
      // getSmartMarketExtraInfo.ts). That case has bytecode to call, so the
      // step it would eventually build reverts normally instead of silently
      // no-op'ing like the zero-address case above; a transport failure is
      // rethrown rather than read as "not native".
      if (!isContractLevelFailure(error)) throw error;
      return [zeroAddress, zeroAddress] as const;
    });
    resolved.tokenAIsNative = tokenA === NATIVE_ADDRESS;
    resolved.tokenBIsNative = tokenB === NATIVE_ADDRESS;
  }

  return { ...config, loanProvider, collateralProvider, ...resolved };
}

/**
 * As above, for a vault: the vault names its own provider, and whether that
 * provider is native is derived the same way `getVaultInfo` derives it —
 * comparing the resolved provider against the network's singleton
 * `nativeProvider` — rather than trusted from a caller-supplied `isNative`.
 */
export async function withResolvedVaultProvider<
  T extends Pick<VaultInfo, "provider">,
>(
  vaultAddress: Address,
  config: T,
  publicClient: PublicClient,
  network: NetworkName,
): Promise<T> {
  const provider = ((await publicClient
    .readContract({
      address: vaultAddress,
      abi: MOOLAH_VAULT_ABI,
      functionName: "provider",
    })
    .catch((error: unknown) => {
      // A vault with no `provider()` view genuinely has none. A node that did
      // not answer is not evidence of anything — rethrow rather than quietly
      // routing the deposit somewhere else.
      if (!isContractLevelFailure(error)) throw error;
      return zeroAddress;
    })) ?? zeroAddress) as Address;

  const resolved: Partial<VaultInfo> = { provider };
  if ("isProvider" in config) resolved.isProvider = provider !== zeroAddress;
  if ("isNative" in config) {
    resolved.isNative =
      provider === getContractAddress(network, "nativeProvider");
  }

  return { ...config, ...resolved };
}

/** Re-exported for callers building steps without the facade. */
export type { WriteSmartMarketConfig };
