# Moolah Lending SDK

TypeScript SDK for the Moolah lending protocol on BNB Chain and Ethereum.

## Packages

| Package                         | Description                                             |
| ------------------------------- | ------------------------------------------------------- |
| `@lista-dao/moolah-sdk-core`    | Core types, pure calculations, contract ABIs            |
| `@lista-dao/moolah-lending-sdk` | Builder SDK - returns transaction steps (`StepParam[]`) |

## Installation

`viem` is a peer dependency from 2.0.0 — install it alongside the SDK so your
tree resolves exactly one copy.

```bash
# For integrators managing their own wallet
pnpm add @lista-dao/moolah-lending-sdk viem

# For core utilities only
pnpm add @lista-dao/moolah-sdk-core viem
```

Upgrading from 1.x? See [MIGRATION.md](./MIGRATION.md).

## Quick Start

### Initialize SDK

```typescript
import { MoolahSDK } from "@lista-dao/moolah-lending-sdk";

const sdk = new MoolahSDK({
  rpcUrls: {
    56: "https://bsc-dataseed.binance.org", // BSC mainnet
    1: "https://eth.llamarpc.com", // Ethereum mainnet
  },
});
```

The SDK uses Lista's production REST API by default. Pass `apiBaseUrl` to use
one custom production gateway.

### Read Operations

```typescript
const chainId = 56;

// On-chain data
const marketExtra = await sdk.getMarketExtraInfo(chainId, marketId);
const userData = await sdk.getMarketUserData(chainId, marketId, userAddress);

const chain = sdk.getApiChain(chainId);
const marketList = await sdk.getMarketList({
  chain,
  page: 1,
  pageSize: 20,
});
const vaultList = await sdk.getVaultList({ chain, page: 1, pageSize: 20 });
```

### Build Transaction Steps

The SDK returns `StepParam[]` which you can execute with your own wallet client:

```typescript
import { MoolahSDK } from "@lista-dao/moolah-lending-sdk";
import { parseUnits } from "viem";

// Build supply steps
const supplySteps = await sdk.buildSupplyParams({
  chainId: 56,
  marketId,
  assets: parseUnits("100", 18),
  walletAddress,
});

// Build borrow steps
const borrowSteps = await sdk.buildBorrowParams({
  chainId: 56,
  marketId,
  assets: parseUnits("50", 18),
  walletAddress,
});

// Execute steps with your wallet client.
// The array is strictly ordered: send each step, wait for it to be mined,
// then send the next. Do not reorder or run them in parallel.
for (const step of borrowSteps) {
  const hash = await walletClient.writeContract(step.params);
  await publicClient.waitForTransactionReceipt({ hash });
}
```

### Approvals

Every builder that pulls tokens sizes its approval with headroom, because the
amount owed moves between building and inclusion — and then appends a step
putting the allowance back where it found it, so the headroom does not survive
as a standing approval. Pass `keepAllowance: true` to suppress that step if you
are batching and will clean up yourself.

The step is emitted only when the sequence raised the allowance, and it restores
rather than zeroes: a caller who already had a standing allowance keeps it. The
same is true of the `meta.reversalSteps` on an approve — undoing it means going
back to what was there, which is not necessarily nothing.

Every spender the SDK approves to is resolved on-chain, and that now holds
however you call it. The builders read `loanProvider` and `collateralProvider`
from `Moolah.providers` rather than from the config you hand them, so a stale
cached config is corrected and a substituted one is ignored. There is no flag to
turn that off, because there is nothing to turn off — no check can fail, the
address simply comes from the chain.

A config still decides two things. The **token addresses** it approves —
`loanInfo.address`, `collateralInfo.address` / `lpInfo.address`, and on a Smart
market `tokenAInfo.address` / `tokenBInfo.address`. And the **market**, via
`params`.

`MoolahSDK` checks both: it binds a supplied config to the `marketId` you named
and cross-checks the token metadata, with `trustedConfig: true` to skip it. A
builder called directly cannot make the first check — you never named a market,
so the config *is* the market. If you build steps without the facade, call
`assertMarketConfigMatchesMarket` once where your config enters your process,
plus `assertSmartConfigTokens` for a Smart market and `assertVaultConfigAsset`
for a vault. All three are exported from the package root and from
`@lista-dao/moolah-lending-sdk/builders`.

### The execution contract

`StepParam[]` is a sequence, not a set.

- **Ordered.** Execute in ascending `step.index`, one at a time, waiting for
  each receipt. Reordering or skipping is undefined behaviour.
- **Not atomic.** You own the wallet, so the SDK cannot make a sequence
  all-or-nothing. Executing only a prefix is always possible.
- **Reversible where it matters.** A step that leaves durable state behind if
  you abandon the rest of the sequence carries `meta.reversalSteps` — for
  example a `setAuthorization` that grants a standing authorization. Run those
  if you stop partway.
- **Built from a snapshot.** A step emitted because of a chain read carries
  `meta.precondition` explaining why it is there and `meta.observedState`
  holding what was read. Those reads happen when you build; the transaction
  lands later. If the gap is long enough to matter, rebuild rather than send.

```typescript
for (const step of steps) {
  try {
    const hash = await walletClient.writeContract(step.params);
    await publicClient.waitForTransactionReceipt({ hash });
  } catch (err) {
    // Undo anything durable that already landed.
    for (const done of steps.slice(0, step.index)) {
      for (const undo of done.meta?.reversalSteps ?? []) {
        await walletClient.writeContract(undo.params);
      }
    }
    throw err;
  }
}
```

### Simulate Operations (No Chain Interaction)

```typescript
import {
  Decimal,
  simulateMarketBorrow,
  simulateVaultDeposit,
} from "@lista-dao/moolah-sdk-core";

// Simulate a market borrow operation
const borrowResult = simulateMarketBorrow({
  supplyAmount: Decimal.parse("0.5", 18),
  borrowAmount: Decimal.parse("500", 18),
  userPosition: {
    collateral: Decimal.parse("1", 18),
    borrowed: Decimal.ZERO,
  },
  marketState: {
    totalSupply: Decimal.parse("10000", 18),
    totalBorrow: Decimal.parse("5000", 18),
    LLTV: Decimal.parse("0.8", 18),
    priceRate: Decimal.parse("2000", 18),
    loanDecimals: 18,
    collateralDecimals: 18,
  },
});
// Returns: { collateral, borrowed, LTV, loanable, liqPriceRate, borrowRate? }

// Simulate a vault deposit
const depositResult = simulateVaultDeposit({
  depositAmount: Decimal.parse("100", 18),
  userLocked: Decimal.parse("500", 18),
  userBalance: Decimal.parse("1000", 18),
  apy: Decimal.parse("0.1", 18), // optional
  assetPrice: Decimal.parse("1", 18), // optional
});
// Returns: { locked, balance, yearlyEarnings?, monthlyEarnings? }
```

---

## Lending operations

Every write the protocol supports, grouped by what you are doing.

### Variable-rate markets

| Method                      | What it does                                    |
| --------------------------- | ----------------------------------------------- |
| `buildSupplyParams`         | supply collateral                               |
| `buildWithdrawParams`       | withdraw collateral                             |
| `buildBorrowParams`         | borrow against collateral                       |
| `buildRepayParams`          | repay borrowed assets                           |
| `buildMoolahSupplyParams`   | **lend directly to a market**, bypassing vaults |
| `buildMoolahWithdrawParams` | withdraw a direct-to-market supply position     |

### Fixed-term markets

| Method                              | What it does                                     |
| ----------------------------------- | ------------------------------------------------ |
| `buildBrokerBorrowParams`           | borrow at a term, or on another account's behalf |
| `buildBrokerRepayParams`            | repay one fixed position                         |
| `buildBrokerRepayAllParams`         | settle every leg with a broker at once           |
| `buildConvertDynamicToFixedParams`  | move flexible debt into a term                   |
| `buildBrokerRefinanceMaturedParams` | roll matured positions into fresh terms          |
| `buildMigrateToFixedTermParams`     | migrate a position into a fixed-term market      |

`buildConvertDynamicToFixedParams` stays inside one broker: one transaction, no
approval, no authorization. `buildMigrateToFixedTermParams` crosses markets and
needs the PositionManager authorized — it emits that step only when it is
missing, and attaches the revoke as `meta.reversalSteps`.

Refinancing a matured position settles the term; it does not open a new one.
Read the position back rather than looking for a fresh term id.

Two things about repaying a fixed position, both of which revert if you get
them wrong. `posId` is the position's **own id** from `userFixedPositions`, not
its index in that array — the ids are not dense, and passing an index reverts
with `PositionNotFound()`. And `amount` wants headroom: interest accrues between
quoting and inclusion, so an exact quote leaves the position under the market
minimum and reverts with `remain borrow too low`. The broker transfers only what
is owed, so the headroom costs nothing.

### Smart Lending (DEX-LP collateral)

| Method                                      | What it does                       |
| ------------------------------------------- | ---------------------------------- |
| `buildSmartSupplyDexLpParams`               | supply the raw LP token            |
| `buildSmartSupplyCollateralParams`          | supply both pool tokens            |
| `buildSmartWithdrawDexLpParams`             | withdraw the raw LP token          |
| `buildSmartWithdrawCollateralParams`        | withdraw both tokens, custom ratio |
| `buildSmartWithdrawCollateralFixedParams`   | withdraw both tokens, fixed ratio  |
| `buildSmartWithdrawCollateralOneCoinParams` | **withdraw a single pool token**   |
| `buildRedeemSmartLpCollateralParams`        | redeem seized LP into its pair     |
| `buildSmartRepayParams`                     | repay a Smart Lending position     |

### Vaults

`buildVaultDepositParams`, `buildVaultWithdrawParams`, and
`buildVaultMintParams` for a target share count (ERC-4626 `mint`).

A vault is only as liquid as the markets underneath it: `withdraw` pulls from
the withdraw queue, and whatever is already lent out is not available. Size the
request with `maxWithdraw` / `maxRedeem` rather than letting the vault revert —
the revert carries no reason, so it reads like a bad call rather than a
liquidity bound.

`mint` is not universal. Vaults that deposit through a provider are refused:
the `NativeProvider` demonstrably has no `mint`, and for any other provider
nothing has established that it does — so the builder declines rather than
sending an approve transaction into a call that may not exist. Use the
assets-denominated `buildVaultDepositParams`, or `allowProviderRouting` if you
have checked the provider yourself.

When no ceiling is given, the mint approval is sized from `previewMint` **plus
1%**, and a trailing step puts the allowance back afterwards. An interest-bearing vault reprices every block, so an exact quote is stale
before the transaction is mined and `mint` reverts with
`ERC20: insufficient allowance`. An allowance is a ceiling, not a payment, and
the approve step carries its own reversal — tune it with `approvalBufferBps`.

### Liquidation

The public liquidator serves an **admin-curated allowlist of markets** and
refuses everything else with `NotWhitelisted()`. This is the common case, not
the corner case: at the time of writing not one of the thirteen distinct markets
in the "close to liquidation" feed on BSC was enabled. `buildLiquidateParams`
checks `isLiquidationMarketEnabled` first and refuses rather than handing you a
call that can only revert — pass `allowUnlistedMarket` to build it anyway.

```typescript
const targets = await sdk.getCloseToLiquidate({ page: 1, pageSize: 20 });
if (!(await sdk.isLiquidationMarketEnabled(56, marketId))) return;
const cost = await sdk.quoteLiquidationCost({
  chainId: 56,
  marketId,
  seizedAssets,
});
const steps = await sdk.buildLiquidateParams({
  chainId: 56,
  marketId,
  borrower,
  walletAddress,
  loanToken,
  maxRepayAmount: (cost * 105n) / 100n, // headroom: the oracle moves
  seizedAssets,
});
```

`getLiquidationList` returns positions already past the threshold — empty
whenever the protocol is healthy, which is most of the time.
`liquidationIncentiveFactor` and `liquidationDiscountPrice` in core give the
discount, using the protocol's own constants.

`getLiquidationList`, `getCloseToLiquidate`, `getVaultMetadata`, `getHoldings`
and `getMarketVaultDetails` carry no `chain` in their request because the SDK
serves production data only.

### Authorization

`buildSetAuthorizationParams` / `buildRevokeAuthorizationParams` grant and
withdraw permission for a contract to act on your positions. The grant is
standing until revoked.

`buildAuthorizationTypedData` + `buildSetAuthorizationWithSigParams` do it by
signature instead, so a relayer submits and pays while the authorizer only
signs.

### Market data

`getGroupedMarkets` returns every zone in one response, grouped by collateral.
`getMarketList` reaches the same markets but one zone per call, defaulting to
zone 0 — so one call sees 193 of BSC's 461. Neither is a subset of the other:
the grouped feed adds token addresses, `totalCollateral` and
`collateralUiMultiplier`; the flat list adds `vaults` and `loanIcon`.

Filter Smart Lending on the **zone**, not on the presence of
`smartCollateralConfig`:

```typescript
import { LENDING_ZONE, isSmartLendingZone } from "@lista-dao/moolah-sdk-core";

const smart = groups.filter((g) => isSmartLendingZone(g.zones));
```

Zone 3 is Smart Lending and zone 5 is bStock. Zone 6 is data the backend still
emits and the reference frontend drops on purpose: it carries a populated
`smartCollateralConfig` and is indistinguishable from Smart Lending from the
outside, but its "provider" implements none of the SmartProvider interface.

## Decimal Utility

### Why Decimal?

All numeric values from read operations (`getMarketUserData`, `getVaultInfo`, etc.) are returned as `Decimal` instead of `number` or `bigint`. This avoids JavaScript's floating-point precision issues:

```typescript
// JavaScript floating-point issue
0.1 + 0.2 === 0.3; // false (0.30000000000000004)

// Decimal - exact precision
const a = Decimal.parse("0.1", 18);
const b = Decimal.parse("0.2", 18);
a.add(b).toString(1); // "0.3" (exact)
```

### Where Decimal is Used

| Return Type           | Decimal Fields                                                                 |
| --------------------- | ------------------------------------------------------------------------------ |
| `MarketExtraInfo`     | `LLTV`, `totalSupply`, `totalBorrow`, `borrowRate`, `priceRate`, `utilRate`... |
| `MarketUserData`      | `collateral`, `borrowed`, `loanable`, `withdrawable`, `LTV`, `liqPriceRate`... |
| `VaultInfo`           | `totalAssets`, `totalSupply`                                                   |
| `VaultUserData`       | `locked`, `shares`, `balance`                                                  |
| `SmartMarketUserData` | `collateral`, `lpTokenA`, `lpTokenB`, `borrowed`, `loanable`...                |

### Creating Decimals

```typescript
import { Decimal } from "@lista-dao/moolah-sdk-core";

// From a string — the lossless input, and what to prefer for an amount
const amount = Decimal.parse("123.456", 18);

// From a number — reads the value you wrote, not the double's expansion
const price = Decimal.parse(1234.56, 18); // 1234.56

// From a raw bigint and its decimal places
const raw = new Decimal(123456000000000000000000n, 18); // 123456.0

// Constants
Decimal.ZERO;
Decimal.ONE;
```

Numbers and strings agree:

```typescript
Decimal.parse(1234.56, 18).toFixed(4); // "1234.5600"
Decimal.parse("1234.56", 18).toFixed(4); // "1234.5600"

Decimal.parse(0.3, 18).toFixed(4); // "0.3000"
Decimal.parse(1e-7, 18).toFixed(8); // "0.00000010"
```

**Still prefer strings for amounts.** Not because `parse` mishandles a number —
it takes the shortest decimal that identifies the double, which is the number
you wrote — but because a double cannot hold every value you might be given.
`123456789012345678901` is a different number before `parse` ever sees it, and
nothing downstream can recover it. Carry amounts as strings or bigints from
wherever they originate. `NaN` and `Infinity` are rejected outright.

### Arithmetic Operations

```typescript
const a = Decimal.parse("100", 18);
const b = Decimal.parse("3", 18);

// Basic operations
a.add(b); // 103
a.sub(b); // 97
a.mul(b); // 300
a.div(b); // 33.333...

// Aliases (BigNumber.js style)
a.plus(b); // add
a.minus(b); // sub
a.times(b); // mul
a.dividedBy(b); // div

// Chaining
a.add(b).mul(2).sub(10);
```

### Rounding & Precision

```typescript
import { Decimal, RoundingMode } from "@lista-dao/moolah-sdk-core";

const value = Decimal.parse("123.456789", 18);

// dp(decimals, roundingMode) - Set decimal places
value.dp(2, RoundingMode.FLOOR); // 123.45 (towards zero)
value.dp(2, RoundingMode.CEILING); // 123.46 (away from zero)
value.dp(2, RoundingMode.ROUND); // 123.46 (nearest)

// Shorthand methods
value.floor(2); // 123.45
value.ceiling(2); // 123.46
value.round(2); // 123.46
value.roundDown(2); // 123.45 (towards zero)
```

### Formatting Output

**The formatters truncate; they do not round.** Rounding is something you ask
for explicitly, with the methods in the previous section. This is deliberate —
a balance shown rounded up is a balance the user does not have — but it means
`toFixed` here does not behave like `Number.prototype.toFixed`.

```typescript
const amount = Decimal.parse("1234567.123456789", 18);

// toString(decimals) - truncates, removes trailing zeros
amount.toString(4); // "1234567.1234"  (not …1235)
amount.toString(2); // "1234567.12"

// toFixed(decimals) - truncates, keeps trailing zeros
amount.toFixed(4); // "1234567.1234"  (not …1235)
amount.toFixed(8); // "1234567.12345678"

// toFormat(decimals) - truncates, with thousand separators
amount.toFormat(2); // "1,234,567.12"

// Round first if you want rounding:
amount.round(4).toFixed(4); // "1234567.1235"
```

Two things that bite:

```typescript
// 1. No argument means zero decimal places, so anything that coerces a
//    Decimal to a string silently shows only the integer part.
String(amount); // "1234567"   — the .1234… is gone
`${amount}`; // "1234567"
amount.toString(); // "1234567"
// Always pass the precision you want: amount.toString(4).

// 2. A Decimal holds bigints, so JSON.stringify throws on it.
JSON.stringify({ amount }); // TypeError: Do not know how to serialize a BigInt
JSON.stringify({ amount: amount.toFixed(18) }); // fine
```

### Comparison

```typescript
const a = Decimal.parse("100", 18);
const b = Decimal.parse("200", 18);

a.eq(b); // false (equals)
a.gt(b); // false (greater than)
a.gte(b); // false (greater than or equal)
a.lt(b); // true  (less than)
a.lte(b); // true  (less than or equal)

// Check state
a.isZero(); // false
a.isPositive(); // true
a.isNegative(); // false
```

### Converting to bigint for Transactions

```typescript
// When sending transactions, convert to raw bigint
const amount = Decimal.parse("100.5", 18);

// Method 1: Use roundDown to get raw value
const rawValue = amount.roundDown(18).numerator; // 100500000000000000000n

// Method 2: For user input, use viem's parseUnits directly
import { parseUnits } from "viem";
const rawValue = parseUnits("100.5", 18); // 100500000000000000000n
```

### Complete Example

```typescript
import { Decimal, RoundingMode } from "@lista-dao/moolah-sdk-core";

// User wants to supply 50% of their balance
const balance = Decimal.parse("1000.123456", 18);
const supplyAmount = balance.mul(0.5);

// Display to user (2 decimal places, rounded)
console.log(`Supplying: ${supplyAmount.toString(2)} tokens`);
// "Supplying: 500.06 tokens"

// Convert for transaction (full precision)
const txValue = supplyAmount.roundDown(18).numerator;
// 500061728000000000000n

// Calculate new balance
const remaining = balance.sub(supplyAmount);
console.log(`Remaining: ${remaining.toFormat(2)}`);
// "Remaining: 500.06"
```

---

## API Reference

### MoolahSDK Read Methods

| Method                                                         | Source | Description                                      |
| -------------------------------------------------------------- | ------ | ------------------------------------------------ |
| `getMarketInfo(chainId, marketId)`                             | API    | Market metadata                                  |
| `getMarketExtraInfo(chainId, marketId)`                        | Chain  | Market on-chain data (rates, liquidity)          |
| `getMarketUserData(chainId, marketId, user)`                   | Chain  | User position data                               |
| `getMarketUserDataWithBroker(chainId, marketId, user, broker)` | Chain  | User position data with broker fixed-term merged |
| `getMarketRuntimeData(chainId, marketId, wallet)`              | Chain  | Combined write + user runtime data               |
| `getWriteConfig(chainId, marketId)`                            | Chain  | Config for write operations                      |
| `getMarketList(params)`                                        | API    | Market discovery                                 |
| `getVaultInfo(chainId, address)`                               | Chain  | Vault on-chain data                              |
| `getVaultUserData(chainId, address, user)`                     | Chain  | User vault position                              |
| `getVaultList(params)`                                         | API    | Vault discovery                                  |
| `getVaultMetadata(address)`                                    | API    | Vault metadata (name, APY)                       |
| `getSmartMarketExtraInfo(chainId, marketId)`                   | Chain  | Smart market on-chain data                       |
| `getSmartMarketUserData(chainId, marketId, user)`              | Chain  | Smart market user position                       |
| `getBrokerFixedTerms(chainId, brokerAddress)`                  | Chain  | Fixed-term broker terms                          |
| `getBrokerUserPositions(chainId, broker, user)`                | Chain  | Broker user positions                            |
| `getHoldings(params)`                                          | API    | User holdings (`vault` / `market`)               |
| `getMarketVaultDetails(marketId, params)`                      | API    | Vault list under a market                        |

### MoolahSDK Build Methods

| Method                                            | Description                                            |
| ------------------------------------------------- | ------------------------------------------------------ |
| `buildSupplyParams(params)`                       | Build supply collateral steps                          |
| `buildBorrowParams(params)`                       | Build borrow steps                                     |
| `buildRepayParams(params)`                        | Build repay steps                                      |
| `buildWithdrawParams(params)`                     | Build withdraw collateral steps                        |
| `buildVaultDepositParams(params)`                 | Build vault deposit steps                              |
| `buildVaultWithdrawParams(params)`                | Build vault withdraw steps                             |
| `buildSmartSupplyDexLpParams(params)`             | Build smart market LP supply steps                     |
| `buildSmartSupplyCollateralParams(params)`        | Build smart market collateral supply steps             |
| `buildSmartWithdrawDexLpParams(params)`           | Build smart market LP withdraw steps                   |
| `buildSmartWithdrawCollateralParams(params)`      | Build smart market collateral withdraw                 |
| `buildSmartWithdrawCollateralFixedParams(params)` | Build smart market collateral withdraw (fixed LP burn) |
| `buildSmartRepayParams(params)`                   | Build smart market repay steps                         |
| `buildBrokerBorrowParams(params)`                 | Build broker borrow steps                              |
| `buildBrokerRepayParams(params)`                  | Build broker repay steps                               |

### MoolahSDK Simulate Methods

| Method                           | Description                                    |
| -------------------------------- | ---------------------------------------------- |
| `simulateBorrowPosition(params)` | Simulate borrow position using live chain data |
| `simulateRepayPosition(params)`  | Simulate repay position using live chain data  |

### Simulate Functions (Decimal-based)

| Function                            | Description                       |
| ----------------------------------- | --------------------------------- |
| `simulateMarketBorrow(params)`      | Simulate market borrow operation  |
| `simulateMarketRepay(params)`       | Simulate market repay operation   |
| `simulateVaultDeposit(params)`      | Simulate vault deposit operation  |
| `simulateVaultWithdraw(params)`     | Simulate vault withdraw operation |
| `simulateSmartMarketBorrow(params)` | Simulate smart market borrow      |
| `simulateSmartMarketRepay(params)`  | Simulate smart market repay       |

### Interest Rate Functions

| Function                    | Description                              |
| --------------------------- | ---------------------------------------- |
| `getBorrowRateInfo(params)` | Get borrow rate with rateCap & rateFloor |
| `getAnnualBorrowRate(rate)` | Convert per-second rate to annual        |
| `getInterestRates(params)`  | Generate interest rate curve data        |

---

## Verification

Unit tests need nothing. The chain-dependent checks take their endpoints from
the environment:

```bash
export BSC_RPC_URL=...          # BSC mainnet
export ETH_RPC_URL=...          # Ethereum mainnet
```

Each falls back to a public node, which works but is rate-limited.

`abi:conformance` and `parity:check` only read. `fork:check` and `fork:flows` do
send transactions, impersonate holders and write storage slots — all against a
local anvil fork of BSC, never a real network; the upstream URL is used solely
as anvil's `--fork-url`.

| Command                | What it establishes                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm abi:conformance` | Every ABI function's selector is present in the deployed bytecode, and the contracts that name their Moolah instance agree with the address book. A unit test cannot catch a mis-transcribed ABI, because it encodes with the same ABI it asserts against. |
| `pnpm fork:check`      | Authorization, its reversal, migration encoding, and the EIP-712 signature path, run against real state on an anvil fork of BSC. Needs foundry. |
| `pnpm fork:flows`      | The vault, plain-market, fixed-term-broker, Smart Lending and liquidation flows — executed, with the resulting state asserted, on an anvil fork of BSC. Liquidation needs an unhealthy position. Needs foundry. |
| `pnpm parity:check`    | The SDK's write surface against a committed snapshot of the reference frontend's. Runs on every CI pass; the snapshot's own age warns at 30 days and fails at 90.                                                                                          |
| `pnpm check:packaging` | Packs and reads the published manifests — the only place the viem peer dependency and the exports map can be checked as shipped.                                                                                                                           |
| `pnpm check:consumer`  | Installs the packed tarballs into a throwaway project and compiles against them with `moduleResolution: nodenext` and `skipLibCheck: false`, then runs the result. Inside the workspace TypeScript reads `src/`, so nothing else ever checks the `.d.ts` files we publish. |
| `pnpm read:surface`    | Calls every public read against BSC mainnet and the live API, asserting the shape each one promises rather than only that it did not throw. Everything else here is about writes; 12 of the 25 reads were executed by nothing. Read-only, no key. |

One check does change state, so it is not in the table above and never runs in
CI unattended:

```bash
# Put the key in a gitignored .env.local or a CI secret — not on the command
# line, where it lands in shell history and in `ps`. The script says the same
# thing if you forget.
set -a; . .env.local; set +a
```

It borrows, converts, repays and withdraws on chain 97 with a throwaway account,
and refuses to start on any other chain. `--slow` additionally waits out a
600-second term and rolls it, which is the only state-changing evidence for
refinancing a matured position; `--only <section>` runs one of `fixed-term`,
`vault`, `smart`. Use it to check that a sequence, once
executed, leaves the chain in the state the SDK said it would — which is the one
thing calldata verification structurally cannot establish.

Regenerate the parity snapshot from a frontend checkout — from the GHE clone,
which is the source of truth; the github.com mirror is a frozen snapshot and
would under-report the frontend's write surface, which is the one way this check
can produce a confident false negative:

```bash
node scripts/extract-frontend-write-surface.mjs --frontend ../lista-mono --write
```

### What has executed, and what has only been encoded

Calldata verification proves a call is encoded correctly. It cannot prove that a
sequence, once executed, leaves the chain in the state the SDK claimed. Every
write below is encoded and decoded in a unit test; this says which ones have
also been run with the result asserted.

| Operation                                    | Executed | Where                        |
| -------------------------------------------- | -------- | ---------------------------- |
| supply / withdraw collateral                  | yes      | fork                         |
| borrow / repay (assets)                       | yes      | fork                         |
| repay (shares)                                | yes      | fork `--only market`         |
| direct-to-market supply / withdraw            | yes      | fork `--only market`         |
| flash loan                                    | yes      | fork `--only market`         |
| broker borrow, convert to fixed, repay        | yes      | fork                         |
| broker repayAll                               | yes      | fork `--only broker`         |
| broker refinance matured                      | yes      | fork                         |
| vault deposit / mint / withdraw / redeem      | yes      | fork                         |
| Smart Lending supply (pair and single-sided)  | yes      | fork                         |
| Smart Lending supply / withdraw raw LP        | yes      | fork `--only dexlp`          |
| Smart Lending withdraw, custom ratio          | yes      | fork `--only dexlp`          |
| Smart Lending withdraw, one coin              | yes      | fork                         |
| Smart Lending withdraw, fixed ratio           | yes      | fork                         |
| Smart Lending repayAll                        | yes      | fork `--only smart`          |
| redeem seized LP collateral                   | yes      | fork `--only dexlp`          |
| liquidate (both modes)                        | yes      | fork `--only liquidation`    |
| set / revoke authorization                    | yes      | fork:check                   |
| signed authorization, and cancelling one      | yes      | fork:check                   |
| **cross-market migration**                    | **encoding only** | fork:check reaches the contract body while authorized; completing one needs a real migratable position |

The approve step is executed inside every sequence above, and the fork's broker
section asserts the resulting allowance directly.

## Development

```bash
pnpm install      # Install dependencies
pnpm build        # Build all packages
pnpm test         # Run tests
pnpm lint         # Lint code
pnpm check:types  # Type check
```

## License

MIT
