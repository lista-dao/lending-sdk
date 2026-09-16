import type { Address, PublicClient } from "viem";
import { zeroAddress } from "viem";
import {
  MOOLAH_ABI,
  MOOLAH_VAULT_ABI,
  getContractAddress,
  type NetworkName,
  type VaultInfo,
  type WriteMarketConfig,
  type WriteSmartMarketConfig,
} from "@lista-dao/moolah-sdk-core";
import { isContractLevelFailure } from "./rpcErrors.js";
import { marketIdOf } from "./builders/sharePricing.js";

/**
 * Take the chain's word for the provider, not the config's.
 *
 * `loanProvider` and `collateralProvider` are the addresses this SDK approves
 * tokens to and sends native value to. Everywhere else they are read from
 * `Moolah.providers`, which is what the invariant in `configTrust.ts` rests on
 * — and a caller-supplied config was the one way round it.
 *
 * Verifying the supplied value was the obvious fix and is the worse one. A
 * verify has a failure mode: it must decide what to do when the chain
 * disagrees, which turns a provider migration into rejected builds for anyone
 * holding a correctly-cached config, and it needs an escape hatch that will be
 * set to true by the first caller who reads a stack trace. Resolving has no
 * failure mode at all. The supplied fields simply stop being load-bearing: a
 * stale config is silently corrected, a forged one is silently ignored, and
 * the invariant becomes true by construction rather than by assertion.
 *
 */
export async function withResolvedProviders<
  T extends Pick<
    WriteMarketConfig,
    "params" | "loanProvider" | "collateralProvider"
  >,
>(config: T, publicClient: PublicClient, network: NetworkName): Promise<T> {
  const moolah = getContractAddress(network, "moolah");
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

  // The addresses only — the `*IsNative` flags stay as the config gave them.
  // That is safe *because* of the guard below and not otherwise: an earlier
  // version of this comment argued a forged flag could only send native value
  // to the real provider, which either works or reverts. It missed the case
  // where the real provider is the zero address. `Moolah.providers` returns
  // `0x0` for any pair with no provider registered — a successful read, not a
  // throw — and the native branches take the provider as the call target with
  // no zero guard, so the step would carry the full amount as `value` to
  // `0x0`, where it succeeds and the funds are gone. Resolution broke the
  // pairing the flag used to rely on; this restores it.
  //
  // All four flags, not two. The first version of this guard covered
  // `loanIsNative` and `collateralIsNative` and stopped there, because those
  // are the two fields on `WriteMarketConfig` and that was the file being
  // edited. A Smart config names its native tokens `tokenAIsNative` /
  // `tokenBIsNative` instead, and `buildSmartSupplyCollateralSteps` sends
  // `value` to `collateralProvider` off exactly those — so the same burn was
  // reachable through the Smart pair, one rename away from a guard that
  // claimed to be complete.
  const native = { ...config } as Partial<WriteMarketConfig> &
    Partial<WriteSmartMarketConfig>;

  const guard = (
    isNative: boolean | undefined,
    provider: Address,
    what: string,
    token: Address,
  ) => {
    if (!isNative || provider !== zeroAddress) return;
    throw new Error(
      `withResolvedProviders: the config says ${what} is native, but Moolah ` +
        `has no provider registered for ${token} on this market. A native ` +
        `step would send its value to the zero address, where it succeeds and ` +
        `the funds are gone.`,
    );
  };

  guard(
    native.loanIsNative,
    loanProvider,
    "the loan token",
    config.params.loanToken,
  );
  guard(
    native.collateralIsNative,
    collateralProvider,
    "the collateral",
    config.params.collateralToken,
  );
  // Both pool tokens of a Smart market are supplied through the *collateral*
  // provider, so that is the address either flag puts `value` behind.
  guard(
    native.tokenAIsNative,
    collateralProvider,
    "pool token A",
    config.params.collateralToken,
  );
  guard(
    native.tokenBIsNative,
    collateralProvider,
    "pool token B",
    config.params.collateralToken,
  );

  return { ...config, loanProvider, collateralProvider };
}

/** As above, for a vault: the vault names its own provider. */
export async function withResolvedVaultProvider<
  T extends Pick<VaultInfo, "provider">,
>(vaultAddress: Address, config: T, publicClient: PublicClient): Promise<T> {
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

  return { ...config, provider } as T;
}

/** Re-exported for callers building steps without the facade. */
export type { WriteSmartMarketConfig };
