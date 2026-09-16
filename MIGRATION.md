# Migrating to 2.0.0

Twenty-one breaking changes, all in this release. They are ordered by how far
they reach: most consumers are affected by the first two and nothing else, and
items 16 onward touch only callers who import from
`@lista-dao/moolah-lending-sdk/builders` or hand the SDK a cached config.

Everything added in 2.0.0 — fixed-term completion, Smart Lending completion,
liquidation, direct-to-market lending, migration, signed authorization — is
additive and needs no migration. See the README.

---

## 1. `viem` is now a peer dependency

**Who is affected:** everyone.

`viem` moved from `dependencies` to `peerDependencies` (`>=2.22.10 <3`) in both
packages. Install it yourself:

```bash
pnpm add viem
```

**Why:** two copies of viem in one dependency tree are two different sets of
types. `Abi`, `Address` and the `encodeFunctionData` overloads stop being
assignable across the package boundary, and the failure surfaces in _your_
build with an error that does not mention the real cause. Declaring viem as a
peer means your tree resolves exactly one copy.

The supported floor is 2.22.10. Anything in the 2.x line at or above it works.

## 2. Subpath exports

**Who is affected:** consumers on `moduleResolution: "node"` (the legacy
algorithm), which ignores the `exports` field entirely.

Both packages now declare an `exports` map. The root import is unchanged:

```ts
import { MoolahSDK } from "@lista-dao/moolah-lending-sdk"; // same as before
```

New subpaths:

| Subpath                                  | Contents                                |
| ---------------------------------------- | --------------------------------------- |
| `@lista-dao/moolah-sdk-core/display`     | bStock display conversions (see §9)     |
| `@lista-dao/moolah-sdk-core/abis`        | contract ABIs, without the rest of core |
| `@lista-dao/moolah-lending-sdk/builders` | builders, without the SDK facade        |

Set `"moduleResolution": "bundler"` or `"node16"`/`"nodenext"` in your
tsconfig. Under the legacy `"node"` setting the subpaths do not resolve.

## 3. `NetworkContracts.positionManager` is required

**Who is affected:** code constructing a `NetworkContracts` value by hand.

The field was absent entirely, which is why the migration flow had no address
to call.

## 4. `StepParam.index` is required

**Who is affected:** code that _constructs_ `StepParam` values — test fixtures,
mocks. Code that only consumes builder output is unaffected.

Builders return an ordered sequence; nothing in the type said so before. See
**The execution contract** in the README for what the ordering guarantees now
are, and for `meta.reversalSteps`, which is how you undo a partially executed
sequence.

## 5. Repay and withdraw params are discriminated unions

**Who is affected:** callers passing both `assets` and `shares`, or neither.

`BuildRepayParams`, `BuildVaultWithdrawParams` and `BuildSmartRepayParams` now
require exactly one:

```ts
// before — compiled, then reverted on-chain
sdk.buildRepayParams({ ..., assets: 100n, shares: 5n });

// after — a compile error
sdk.buildRepayParams({ ..., assets: 100n });        // ok
sdk.buildRepayParams({ ..., shares: 5n });          // ok
```

**Why:** the contracts require exactly one to be non-zero and revert otherwise.
Supplying both was the natural thing to do when you had both values in hand.

## 8. `@morpho-org/blue-sdk` aligned to `^2.3.2`

**Who is affected:** nobody directly; it is a transitive dependency.

The two packages declared `^2.3.2` and `^1.1.1`, and the lockfile resolved
**both** 1.12.7 and 2.3.2 — the same duplicate-instance hazard as §1, already
present. The consumed surface is `MathLib` and `AdaptiveCurveIrmLib`.

## 9. The `NetworkNames` enum is gone

**Who is affected:** anyone importing it. It had no internal usages.

```ts
// before
import { NetworkNames } from "@lista-dao/moolah-sdk-core";
const n = NetworkNames.bsc;

// after
const n = "bsc"; // NetworkName is a string union
```

It duplicated the `NetworkName` union, so keeping it meant two sources of truth
forever.

## 10. `buildSetAuthorizationSteps` only accepts known contracts

**Who is affected:** callers authorizing something other than the
PositionManager.

An authorization hands standing control of every position the signer holds, so
the target now defaults to the address book. Anything else needs
`allowUnknownTarget: true`, which is deliberately awkward:

```ts
sdk.buildSetAuthorizationParams({ chainId: 56, authorized: positionManager }); // ok
buildSetAuthorizationSteps(
  { chainId: 56, authorized: somethingElse, allowUnknownTarget: true },
  "bsc",
);
```

## 11. Signed authorizations expire within an hour by default

**Who is affected:** callers of `buildAuthorizationTypedData`.

A `deadline` more than an hour out now throws. Pass `maxTtlSeconds` to widen it
deliberately.

**Why:** a signature is a bearer instrument — whoever holds it can submit it
until the deadline. And `setAuthorization(x, false)` does **not** consume the
signer's nonce, so a plain revoke cannot cancel a signature that has not landed
yet. The only cancellation is to burn the nonce with a competing signed
authorization at the same nonce. The deadline is therefore the only bound that
actually exists, and an unbounded one is a permanent, uncancellable grant.

## 12. `buildVaultMintParams` takes a vault's shape into account

`isNativeAsset` is gone. The builder now resolves `VaultInfo` itself (or takes
it via `vaultInfo`) and behaves accordingly:

- A vault whose provider is the `NativeProvider` is **rejected**. The provider
  exposes `deposit`, `withdraw` and `redeem` and no `mint`, so there is no
  share-denominated entry point; the previous code approved the wrapped-native
  token to the vault and called `mint` on it, which cannot work. Use
  `buildVaultDepositParams` for those vaults.
- An auto-sized approval is `previewMint` **plus 1%**, tunable with
  `approvalBufferBps`.

**Why the buffer:** an interest-bearing vault reprices every block, so an
allowance set to the exact quote is stale before the transaction is mined and
`mint` reverts with `ERC20: insufficient allowance`. On a mainnet fork the same
sequence passed or failed depending only on whether a block boundary fell
between building and sending — a flake in the worst place. An allowance is a
ceiling rather than a payment, and the approve step carries its own reversal, so
the headroom costs nothing.

---

## 13. `buildLiquidateParams` refuses markets the liquidator will not serve

The public liquidator keeps an **admin-curated allowlist of markets** and
reverts `NotWhitelisted()` for the rest. The builder now reads
`marketWhitelist` first and throws with an explanation; pass
`allowUnlistedMarket: true` to build the call anyway.

**Why:** this is the common case, not the corner case. At the time of writing
not one distinct market in the "close to liquidation" feed on BSC was enabled —
thirteen of thirteen when first measured, twenty-five of twenty-five when
re-checked before release. Every one of those would previously have produced a
well-formed step that reverted after the gas was spent, carrying a bare
`0x584a7938` — and the ABI had no entry to decode it into a name.

`sdk.isLiquidationMarketEnabled(chainId, marketId)` exposes the same read, so a
UI can hide the action instead of offering a button that fails.

---

## 14. The signature path enforces the same allowlist as the transaction path

`buildAuthorizationTypedData` and `buildSetAuthorizationWithSigParams` now
refuse a **grant** to any address the address book does not name, exactly as
`buildSetAuthorizationParams` already did. Both take `allowUnknownTarget` to
override. Revokes are not gated — signing one is always safe.

**Why:** the guard existed on one of the two ways this SDK can grant an
authorization. The ungated one was the signature path, which is the worse of
the two to leave open: a signature is a bearer instrument, whoever holds it can
submit it until the deadline, and a plain revoke does not consume the nonce, so
there is no undo. A target arriving from a URL or an API field could be signed
into standing control of every position the account holds.

`buildCancelSignedAuthorizationTypedData` is new and is the counterpart: it
burns the nonce an outstanding signature was built against, which is the only
cancellation there is. The revoke docstring had been pointing at it since before
it was written.

---

## 15. Over-sized approvals are put back where they were found

`buildRepayParams`, `buildSmartRepayParams`, `buildBrokerRepayParams`,
`buildBrokerRepayAllParams`, `buildLiquidateParams` and `buildVaultMintParams`
now append a final `approve` step restoring the allowance to whatever it was
before the sequence raised it. Pass `keepAllowance: true` to suppress it.
**Sequences from these builders are one step longer**, so anything asserting on
step counts or indices needs updating.

The step is emitted only when the sequence raised the allowance in the first
place, and it restores rather than zeroes — a caller who had a standing
allowance of 100 and repaid 1000 ends back at 100, not at 0.

**Why:** all four deliberately over-size the approval, because the amount owed
moves between building and inclusion. The contract takes what it needs and the
remainder stays live against the spender forever. `meta.reversalSteps` covers
abandoning a sequence; it does not cover finishing one, and finishing is the
common case.

---

## 16. A supplied `marketInfo` / `smartConfig` / `vaultInfo` is checked against the chain

The config overrides are a caching hook and they stay. What the SDK checks is
what it cannot recover by reading the chain: that the config describes the
market you named, that its token metadata agrees with its own `params`, that a
Smart config's pool tokens are the ones its provider names, and that a vault
config's asset is the one the vault names. Pass `trustedConfig: true` to skip
it.

**Not checked: the provider fields.** They were, in an earlier draft of this
release. They are not any more, because #19 made them inert — every builder
reads the provider from the chain itself — and asserting on an inert field can
only produce false rejections. During a provider migration the check would have
refused every correctly-cached config, including the ones building an exit,
which is the exact failure mode resolving was chosen to avoid.

**Renamed.** `assertMarketConfigProviders` is now
`assertMarketConfigMatchesMarket`, and is synchronous — it no longer reads the
chain, so it takes `(marketId, config)` only. `assertVaultConfigProvider` is now
`assertVaultConfigAsset` and takes `(vaultAddress, config, publicClient)`.

This applies to the `MoolahSDK` methods. See #19 for what the builders do.

---

## 17. The broker builders are async, and verified on every path

`buildBrokerBorrowSteps`, `buildConvertDynamicToFixedSteps` and
`buildBrokerRefinanceMaturedSteps` now take `(params, publicClient, network)`
and return a promise, matching the two repay builders. All five verify the
broker against `Moolah.brokers()`; all five accept an optional `marketId` that
binds the broker to the market you meant.

The `MoolahSDK` methods were already async, so most callers see no change. Only
code importing from `@lista-dao/moolah-lending-sdk/builders` needs updating.

**Why:** the broker address comes from market metadata — the REST API — and the
check was on the repay path only. The other three emit no approval, so an
impostor cannot pull tokens, but the address is still what receives a signed
transaction, and the distinction had nothing behind it.

---

## 18. A supplied config must describe the market you named

`assertMarketConfigMatchesMarket` (formerly `assertMarketConfigProviders`)
derives the market id from the config's own params and requires it to equal the
`marketId` argument, and requires the config's token metadata to agree with its
params.

**Why:** the provider check looked the config's *own* tokens up in the named
market's registry, so a config for another market checked out against itself —
and where those tokens have no provider registered, both sides are `0x0` and it
passed for any pair. Two markets differing only in `lltv` register the same
providers for the same tokens, so those passed too. Separately, the builders
approve `loanInfo.address` rather than `params.loanToken`, so genuine params
with forged metadata approved one token and called a market that pulls another.

`buildMigrateToFixedTermParams` binds `outMarket`/`inMarket` to their ids the
same way. It grants the PositionManager standing control before migrating, so an
unbound config meant that authorization was given against markets the user was
never shown.

---

## 19. The builders resolve providers from the chain

`loanProvider` and `collateralProvider` on a supplied config are no longer used.
Every builder that takes a market or vault config reads them from
`Moolah.providers` (or the vault's own `provider()`) at build time, so the
approval spender and the call target are chain-derived on every path — through
the facade or not. There is no flag to disable it.

**Every provider-targeted builder is now async.** `MoolahSDK` callers see no
change; only code importing from `@lista-dao/moolah-lending-sdk/builders` needs
updating. The ones whose signatures moved:

| Builder | Was | Now |
| --- | --- | --- |
| `buildBorrowSteps`, `buildWithdrawSteps` | sync | async, `publicClient` as a fourth argument |
| `buildSmartWithdrawDexLpSteps` | sync `(params, config)` | async `(params, config, deps)` |
| `buildSmartWithdrawCollateralSteps` | sync `(params, config)` | async `(params, config, deps)` |
| `buildSmartWithdrawCollateralFixedSteps` | sync `(params, config)` | async `(params, config, deps)` |
| `buildSmartWithdrawCollateralOneCoinSteps` | sync `(params, config)` | async `(params, config, deps)` |
| `buildRedeemSmartLpCollateralSteps` | sync `(params, config)` | async `(params, config, deps)` |
| `buildVaultWithdrawSteps` | sync `(params, info, network, userData?)` | async `(params, info, deps, userData?)` |

`deps` is `{ publicClient, network }`, the same shape the entry builders take.

The exits were left synchronous at first, and that was worse than either
extreme: a config stale across a provider migration would supply through the new
provider and then fail to withdraw through the old one, stranding the position.
Before, both used the stale address and both failed together, which is
recoverable. The entries were converted a commit before the exits, which made
the stranding reachable for one commit in exactly the paths this note describes.

**Behavioural break:** a config whose provider fields disagree with the chain
used to produce steps aimed at whatever it named. It now produces steps aimed at
the real provider. Callers whose configs were correct see no change beyond one
extra RPC round trip per build.

**Why resolve rather than verify.** Verifying was the obvious fix and is the
worse one. It has to decide what to do when the chain disagrees — which turns a
provider migration into rejected builds for everyone holding a correctly-cached
config, and needs an escape hatch that the first caller to read a stack trace
will set to `true`. Resolving has no failure mode: the supplied fields stop
being load-bearing, and the on-chain-spender invariant becomes true by
construction instead of by assertion.

**Not resolved:** the `*IsNative` flags. Once the provider address is
chain-derived, a forged flag can only send native value to the real provider,
which works or reverts — it cannot misdirect funds. That holds only because a
native step against a zero-address provider is now refused outright:
`Moolah.providers` returns `0x0` for a pair with nothing registered, as a
successful read, and a value-bearing step to `0x0` succeeds and burns the
funds. Resolution broke the pairing the flag used to rely on — a config with
`isNative: true` always carried a real provider, because that is how the flag
was derived — so both the resolver and the native branches guard it.

The guard covers all four flags: `loanIsNative` and `collateralIsNative` on a
plain market, and `tokenAIsNative` / `tokenBIsNative` on a Smart one, both of
which put `value` behind `collateralProvider`. The first version covered two.

**What a config still decides,** and therefore what is still worth checking:
the token addresses it approves, and the market its `params` describe. The
facade binds the second to the `marketId` you named; a direct builder call
cannot, because you never named one. `assertMarketConfigMatchesMarket`,
`assertSmartConfigTokens` and `assertVaultConfigAsset` are exported from the
package root and from `@lista-dao/moolah-lending-sdk/builders` so you can make
those checks once, where your config enters your process.

---

## 20. `MoolahSDKConfig.rpcUrls` is optional, and an empty config is rejected

`rpcUrls` was required even for callers who supply `publicClients` for every
chain they touch — `getPublicClient` returns a supplied client without ever
consulting it. Those callers had to write `rpcUrls: {}` to satisfy the
compiler, which then turned a chain they forgot into a runtime error on the
first read instead of a type error at the call site.

It is now optional. In exchange, a config with **neither** `rpcUrls` nor
`publicClients` throws from the constructor rather than several calls later,
and the per-chain error names both remedies and lists what is configured.

```ts
// now valid
new MoolahSDK({ publicClients: { 56: myViemClient } });

// now throws at construction, not on the first read
new MoolahSDK({ rpcUrls: {} });
```

**Who is affected:** anyone who wrote `rpcUrls: {}` to get past the type. That
construction now throws — supply the clients or the URLs you actually use.

---

## 21. A raw number is read as the number you wrote, in parsing and in arithmetic

`parse` converted a number with `value.toFixed(decimal)`, which at 18 decimal
places does not format the number — it expands the double. `1234.56` became
`1234.559999999999945430`, and since the formatters truncate rather than round,
that survived to the screen:

```ts
// before
Decimal.parse(1234.56, 18).toFixed(4); // "1234.5599"  — a cent short
// after
Decimal.parse(1234.56, 18).toFixed(4); // "1234.5600"
```

Four of six sampled values were wrong this way: `0.3` read `0.2999`, `99.99`
read `99.9899`. It now goes through the shortest decimal representation that
identifies the double, written out in full so exponential inputs like `1e21`
and `1e-7` work too. `NaN` and `Infinity` are rejected with a message instead
of producing a nonsense amount.

It reached further than parsing. Every arithmetic method on `Fraction` funnels
its argument through the same helper, and `Decimal extends Fraction`, so
`amount.add(1234.56)` drifted the same way `Decimal.parse(1234.56)` did.

The correct helper — `parseNumber`, ported from the reference frontend — was
already in `fraction.ts`. It had never been called. Both sites now use it, and
`decimalParity.test.ts` checks the SDK against upstream value for value so they
cannot drift apart again.

**Who is affected:** anyone who built an amount from a JavaScript number, or
passed one to `add` / `sub` / `mul` / `div`, and compensated for the drift
downstream. Values move by up to one unit in the last
place, upward. Strings are still the lossless input — a double cannot hold
every value — but the two overloads now agree wherever a double can.

---

## Stricter validation (not breaking for correct callers)

These reject inputs that previously produced a well-formed step that always
reverted — the failure mode with no signal.

- **Repay builders** enforce exactly one of `assets`/`shares`. `repayAll`
  without `userData` now throws instead of emitting a step with both at zero.
- **Broker addresses** are rejected when zero or malformed. The broker is both
  a call target and an approval spender, and unlike the market providers it has
  no on-chain default — it comes from market metadata. Cross-check it against
  `Moolah.brokers(marketId)` before approving tokens to it.
- **`getInterestRates` / `getFixedRateInterestRates`** reject `points < 2`,
  which previously threw on a zero divisor or looped forever.

## New: RPC failures are no longer read as "not a Smart Lending market"

`getSmartMarketExtraInfo` distinguishes a genuine interface mismatch — the
zone-6 case, where the collateral "provider" really does not implement
`token`/`dex`/`dexLP` and reverts — from a transport failure that says nothing
about the contract at all. A timeout or a rate-limited node used to be
reported identically to "this market does not exist"; it is now rethrown as-is
so the caller can retry it.

## New: an already-split signature is normalised too

`buildSetAuthorizationWithSigSteps` accepts either a raw 65-byte signature or
an already-split `{v, r, s}` tuple. The raw-hex path always normalised a `v`
of 0/1 (the yParity bit several signing libraries return — viem's
`secp256k1.sign().recovery`, ethers v6's `Signature.yParity`, `@noble/curves`)
to the 27/28 the contract's `ecrecover` needs. The tuple path did not: a
caller who split their own signature and handed in `{v: 1, r, s}` had that `1`
reach calldata unnormalised, and `ecrecover(digest, 1, r, s)` returns
`address(0)` on-chain — a guaranteed revert for whoever submitted it, often a
relayer paying gas on someone else's behalf.

Both paths now go through the same normaliser, and a recovery id outside
`{0, 1, 27, 28}` is rejected with a message rather than reaching calldata.
Non-breaking for every caller who was already passing 27/28.

## New: `buildBrokerRepayAllSteps` refuses incomplete non-native repayments

- **A non-native repay missing `loanToken` or `walletAddress`.** Both are
  optional so a native-loan repay does not have to name a token it never
  approves — but omitting either for anything else used to skip the approval
  branch silently and still emit the `repayAll` call with no approval and no
  value. It now throws naming which argument is missing.

`buildBrokerRepaySteps` also gained the `amount > 0` guard every sibling
builder already had; zero used to build a single clean-looking step with no
approval that could only revert.

## New: a vault's allowlist check no longer reads a transport failure as "not gated"

`getVaultUserData` reported `isWhiteList: true` for any failure reading a
vault's allowlist function — a timeout or a rate-limited node looked
identical to "this vault has no allowlist at all," and read as the permissive
answer, the wrong direction to fail silently in. Only a genuine contract-level
failure (the function does not exist) now reports `true`; anything else
propagates so the caller can retry.

## Corrected behaviour

- **ERC-4626 `owner`.** `buildVaultWithdrawParams` used `receiver` as the
  ERC-4626 `owner`, so withdrawing to a different address tried to burn _that_
  address's shares. Shares are now always burned from `walletAddress`.
- **Native-asset detection** compares addresses case-insensitively and requires
  the wrapped-native address to be configured. Previously a casing difference,
  or Ethereum's unset `wbnb`, could emit no approval _and_ take the ERC-20
  path.
- **Matured fixed-term positions** are included in debt totals, priced at
  maturity. They were excluded entirely, understating `borrowed` — the figure
  used to size a repayment.
- **Negative interest** is floored at zero in the dynamic-loan repayment, where
  a partial repay could otherwise turn the 10% over-provision buffer into a 10%
  discount.
- **Zero-rate fixed terms** no longer divide by zero when computing the
  early-repayment penalty.
- **`calculateFixedLoanRepayment`** takes `loanDecimals` instead of assuming 18.
- **Interest rate models are classified by behaviour, not by address.** The
  address book names one `FixedRateIrm` per network, and markets legitimately
  point elsewhere — an upgrade, a second instance, an older deployment still
  serving live markets. A market matched by address alone went down the
  adaptive-curve path, `rateAtTarget` reverted, and the whole market read failed
  with it. The address match is now a fast path only; an IRM with no
  `rateAtTarget` is a fixed-rate IRM wherever it lives. `SmartMarketExtraInfo`
  gained `isFixedRate` to match `MarketExtraInfo`.
- **`getSmartMarketExtraInfo` explains a non-Smart market** instead of failing
  with "the contract function token reverted". See the zone note below.
- **A share-denominated supply now approves anything at all.**
  `buildMoolahSupplyParams({ shares })` emitted a single step and no approval,
  on the reasoning that shares could not be priced without a conversion read —
  but the protocol converts to assets and calls `transferFrom`, so the step
  always reverted. The conversion read is one call and is now made.
- **Approval headroom is at least one raw unit.** The 1% margin floors to zero
  below 100 raw units, so a small approval went stale the moment a single wei of
  interest accrued.
- **An approve step's `reversalSteps` restores the previous allowance** instead
  of setting zero, and the reset step USDT-like tokens require now carries a
  reversal of its own. Abandoning after either used to leave a caller who
  started with an allowance at zero.
- **A share-denominated repay now approves anything at all.**
  `buildRepayParams({ shares })` and `buildSmartRepayParams({ shares })` sized
  their approval from `assets`, which is zero on that path, so they emitted no
  approve step and the repayment reverted inside `transferFrom`. The approval is
  now sized by converting shares to assets against the market's totals, rounded
  up with 1% headroom. A market whose state reads back empty is refused rather
  than priced at zero.
- **A broker address is verified on-chain before it becomes an approval
  spender.** It is the only spender in this SDK that arrives from the REST API;
  the builder now asks the broker which market and which Moolah it belongs to
  and requires `Moolah.brokers()` to lead back to the same address.
- **A zero-valued vault withdrawal is refused** rather than encoded. `withdraw(0)`
  and `redeem(0)` succeed, settle nothing, and make an
  `after - before === requested` check true on both sides.
- **`buildConvertDynamicToFixedParams` takes principal, not outstanding.** The
  docstring did not say which, and `dynamicOutstanding` — the obvious value to
  reach for, since it is what `getBrokerUserPositions` puts in front of you — is
  principal plus accrued interest. Passing it asks to convert more than the leg
  holds and reverts, but only sometimes, depending on how far the contract's own
  accrual has caught up. Use `dynamicPosition.principal`.
- **`buildBrokerRefinanceMaturedParams` does not open a fresh fixed term.** The
  docstring said it rolled a matured position into a new one. The balance
  returns to the **flexible leg**: after refinancing, the
  matured term is gone, no new fixed term exists, and the debt is on the dynamic
  position. Read the position back rather than looking for a new term id. What
  the call guarantees is that the matured leg is settled and the debt is not
  lost.
- **Share conversions use the protocol's virtual assets and shares.** Morpho-Blue
  seeds every conversion with one virtual asset and a million virtual shares.
  Omitting them **under-approves a thin market** — with totals `(1, 2_000_000)`
  a request for `1e9` shares costs 667 assets and the bare ratio says 500, so
  the transfer reverts on an approval that looked deliberate — and over-approves
  an empty one by a factor of a million. A market that was never created is now
  refused rather than priced as an empty one, using `lastUpdate` to tell them
  apart.
- **The allowance reclaim works on USDT.** Tether refuses any non-zero to
  non-zero change *in either direction*. The raise path had always emitted the
  reset pair; the lowering path did not, so the final step of every Ethereum
  USDT sequence with a prior allowance reverted. `buildClearAllowanceStep`
  returns `DraftStep[]` now and takes `network`.
- **`buildMoolahSupplyParams` reclaims its headroom** like every other
  over-sizing builder, and takes `keepAllowance`.
- **`buildVaultWithdrawParams({ withdrawAll })` without `userData` throws**
  instead of silently withdrawing whatever `assets` happened to carry.
- **An unreachable RPC is no longer treated as evidence.** `classifyIrm` now
  distinguishes a contract-level revert from a transport failure; a rate-limited
  node used to be read as "this IRM has no rateAtTarget", silently reclassifying
  a live adaptive market as fixed-rate. The same reasoning now governs
  `getRateFloor` — which had its own swallowing catch, so a failed read became
  "no floor" and the borrow rate was reported below the market's actual floor —
  and the broker verification, which used to call an unreachable node "not a
  LendingBroker".
- **`SmartMarketExtraInfo.rateCap` and `.rateFloor` are `bigint | null`.** They
  were non-nullable, so an absent cap was reported as the protocol default,
  clamping an uncapped Smart Lending market to roughly 30%. The two market
  surfaces now give the same answer for the same market.
- **`buildVaultMintParams` refuses any provider-backed vault**, with a message
  that distinguishes "the native provider has no mint" from "nothing has
  established that this provider has one". Pass `allowProviderRouting` to route
  through a provider you have verified. Guessing wrong sent a real approve
  transaction and then aborted before the clear step, leaving the allowance
  standing.

---

## bStock display values

Not a breaking change — new surface — but worth reading before you show a
collateral balance.

Some collateral tokens (tokenised equities) carry a UI multiplier: a stock
split changes what a balance _means_ without changing the balance. That gives
two number spaces:

- **raw** — what the chain stores, and what calldata must always carry
- **display** — `raw × multiplier`, what a person should see

A unit price moves the other way, so USD stays invariant.

```ts
import {
  parseUiMultiplier,
  toDisplayAmount,
} from "@lista-dao/moolah-sdk-core/display";

const m = parseUiMultiplier(group.collateralUiMultiplier); // "1" when plain
const shown = toDisplayAmount(rawCollateral, m); // display only
```

`toDisplayAmount` returns a wrapper object, not a `bigint`, so it cannot be
passed where an amount is expected. Reaching `.value` is possible but
deliberate. **Never build calldata from a display value.**

USD value is preserved only approximately: both conversions floor, and the
truncations cancel only when the multiplier divides 1e18 evenly — true for a
2:1 split, false for 3:1. The drift is bounded and display-only. Do not use
these values for settlement arithmetic.

## Market lists

`getGroupedMarkets` is new. It is not a fix for `getMarketList`, which stays
and is unchanged — the two endpoints are scoped differently.

`getMarketList` returns one zone per call and defaults to zone 0, so a single
call sees 193 of 461 markets on BSC and 11 of 26 on Ethereum. Summing its zones
reaches 461 and 26 exactly: nothing is missing from it. `getGroupedMarkets`
returns every zone in one response, groups by collateral, and adds each
market's `loanToken` / `collateralToken` addresses and `totalCollateral`. It is
also the only source for `collateralUiMultiplier`, which hangs off the group.

The flat list keeps `vaults` and `loanIcon`, which the grouped one does not
carry, and both carry `smartCollateralConfig`. Pick by what you need, not by
which is newer.

## Lending zones

New surface, but read it before you filter a market list.

The grouped-market feed tags each group with `zones`, and the zone decides how a
market must be read and written. Filtering Smart Lending on the presence of
`smartCollateralConfig` is wrong: **zone 6 carries that config too**, and its
"provider" implements none of the SmartProvider interface. The reference
frontend drops zone 6 on purpose and documents it as dirty data the backend
still emits.

```ts
import { LENDING_ZONE, isSmartLendingZone } from "@lista-dao/moolah-sdk-core";

const smart = groups.filter((g) => isSmartLendingZone(g.zones));
```

`LENDING_ZONE.SMART` is 3, `LENDING_ZONE.BSTOCK` is 5, `LENDING_ZONE.DIRTY` is
6.

## Repaying a fixed-term position

Two things revert if you get them wrong, and both look fine until they run.

`posId` is the position's **own id**, taken from
`userFixedPositions()[n].posId` — not its index in that array. The ids are not
dense: an account that has repaid positions can hold ids 5, 7, 8, 9, 10 at
indices 0 to 4. Passing an index reverts with `PositionNotFound()`.

`amount` wants headroom. Interest accrues between quoting and inclusion, so
passing the exact figure from `previewRepayFixedLoanPosition` repays slightly
less than the full principal and leaves the position under the market minimum —
`remain borrow too low`. The broker transfers only what is actually owed,
measured on chain: a 40.0 amount against a 20.000000061 position moved
20.000002877 and cleared it. Double the quote and send that.
