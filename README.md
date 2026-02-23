# Moolah Lending SDK

TypeScript SDK for the Moolah lending protocol on BNB Chain and Ethereum.

## Packages

| Package                         | Description                                             |
| ------------------------------- | ------------------------------------------------------- |
| `@lista-dao/moolah-sdk-core`    | Core types, pure calculations, contract ABIs            |
| `@lista-dao/moolah-lending-sdk` | Builder SDK - returns transaction steps (`StepParam[]`) |

## Installation

```bash
# For integrators managing their own wallet
pnpm add @lista-dao/moolah-lending-sdk

# For core utilities only
pnpm add @lista-dao/moolah-sdk-core
```

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

### Read Operations

```typescript
// Chain ID: 56 = BSC, 1 = Ethereum
const chainId = 56;

// On-chain data
const marketExtra = await sdk.getMarketExtraInfo(chainId, marketId);
const userData = await sdk.getMarketUserData(chainId, marketId, userAddress);

const chain = sdk.getApiChain(chainId); // "bsc" or "ethereum"
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

// Execute steps with your wallet client
for (const step of borrowSteps) {
  if (step.step === "approve") {
    // Handle approval
  } else if (step.step === "borrow") {
    const hash = await walletClient.writeContract(step.params);
    await publicClient.waitForTransactionReceipt({ hash });
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

// From string (recommended)
const amount = Decimal.parse("123.456", 18);

// From number
const price = Decimal.parse(1234.56, 18);

// From bigint (raw value with decimal places)
const raw = new Decimal(123456000000000000000000n, 18); // 123456.0

// Constants
Decimal.ZERO; // 0
Decimal.ONE; // 1
```

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

```typescript
const amount = Decimal.parse("1234567.123456789", 18);

// toString(decimals) - Removes trailing zeros
amount.toString(4); // "1234567.1235"
amount.toString(2); // "1234567.12"

// toFixed(decimals) - Keeps trailing zeros
amount.toFixed(4); // "1234567.1235"
amount.toFixed(8); // "1234567.12345679"

// toFormat(decimals) - With thousand separators
amount.toFormat(2); // "1,234,567.12"
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

| Method                                            | Source | Description                             |
| ------------------------------------------------- | ------ | --------------------------------------- |
| `getMarketInfo(chainId, marketId)`                | API    | Market metadata                         |
| `getMarketExtraInfo(chainId, marketId)`           | Chain  | Market on-chain data (rates, liquidity) |
| `getMarketUserData(chainId, marketId, user)`      | Chain  | User position data                      |
| `getWriteConfig(chainId, marketId)`               | Chain  | Config for write operations             |
| `getMarketList(params)`                           | API    | Market discovery                        |
| `getVaultInfo(chainId, address)`                  | Chain  | Vault on-chain data                     |
| `getVaultUserData(chainId, address, user)`        | Chain  | User vault position                     |
| `getVaultList(params)`                            | API    | Vault discovery                         |
| `getVaultMetadata(address)`                       | API    | Vault metadata (name, APY)              |
| `getSmartMarketExtraInfo(chainId, marketId)`      | Chain  | Smart market on-chain data              |
| `getSmartMarketUserData(chainId, marketId, user)` | Chain  | Smart market user position              |
| `getBrokerFixedTerms(chainId, brokerAddress)`     | Chain  | Fixed-term broker terms                 |
| `getBrokerUserPositions(chainId, broker, user)`   | Chain  | Broker user positions                   |

### MoolahSDK Build Methods

| Method                                       | Description                                |
| -------------------------------------------- | ------------------------------------------ |
| `buildSupplyParams(params)`                  | Build supply collateral steps              |
| `buildBorrowParams(params)`                  | Build borrow steps                         |
| `buildRepayParams(params)`                   | Build repay steps                          |
| `buildWithdrawParams(params)`                | Build withdraw collateral steps            |
| `buildVaultDepositParams(params)`            | Build vault deposit steps                  |
| `buildVaultWithdrawParams(params)`           | Build vault withdraw steps                 |
| `buildSmartSupplyDexLpParams(params)`        | Build smart market LP supply steps         |
| `buildSmartSupplyCollateralParams(params)`   | Build smart market collateral supply steps |
| `buildSmartWithdrawDexLpParams(params)`      | Build smart market LP withdraw steps       |
| `buildSmartWithdrawCollateralParams(params)` | Build smart market collateral withdraw     |
| `buildSmartRepayParams(params)`              | Build smart market repay steps             |
| `buildBrokerBorrowParams(params)`            | Build broker borrow steps                  |
| `buildBrokerRepayParams(params)`             | Build broker repay steps                   |

### Simulate Functions (Decimal-based)

| Function                           | Description                        |
| ---------------------------------- | ---------------------------------- |
| `simulateMarketBorrow(params)`     | Simulate market borrow operation   |
| `simulateMarketRepay(params)`      | Simulate market repay operation    |
| `simulateVaultDeposit(params)`     | Simulate vault deposit operation   |
| `simulateVaultWithdraw(params)`    | Simulate vault withdraw operation  |
| `simulateSmartMarketBorrow(params)`| Simulate smart market borrow       |
| `simulateSmartMarketRepay(params)` | Simulate smart market repay        |

### Interest Rate Functions

| Function                    | Description                              |
| --------------------------- | ---------------------------------------- |
| `getBorrowRateInfo(params)` | Get borrow rate with rateCap & rateFloor |
| `getAnnualBorrowRate(rate)` | Convert per-second rate to annual        |
| `getInterestRates(params)`  | Generate interest rate curve data        |

---

## Development

```bash
pnpm install      # Install dependencies
pnpm build        # Build all packages
pnpm test         # Run tests
pnpm lint         # Lint code
pnpm check:types  # Type check
```

## Publishing

```bash
pnpm changeset    # Create changeset
pnpm release      # Version bump + publish
```

## License

MIT
