# @lista-dao/moolah-sdk-core

Core types, pure calculation functions, and utilities for the Moolah lending protocol.

## Installation

```bash
pnpm add @lista-dao/moolah-sdk-core
```

## Overview

This package provides the foundation for all Moolah SDK packages:

- **Types** - Protocol types for markets, vaults, loans, and operations
- **Calculations** - Pure functions for LTV, rates, positions (no chain interaction)
- **Contracts** - ABIs and contract addresses
- **Utilities** - Decimal/Fraction for safe fixed-point math

## Exports

### Decimal & Fraction

BigInt-backed fixed-point arithmetic to avoid floating-point precision issues.

```typescript
import { Decimal, Fraction, RoundingMode } from "@lista-dao/moolah-sdk-core";

// Parse values
const amount = Decimal.parse("123.456", 18);

// Arithmetic
amount.add(10).mul(2).div(3);

// Rounding
amount.dp(2, RoundingMode.ROUND); // 123.46

// Format
amount.toString(2); // "123.46" (trims zeros)
amount.toFixed(4); // "123.4560"
amount.toFormat(2); // "123.46" (with commas for large numbers)

// Comparison
amount.gt(100); // true
amount.eq(123.456); // true
```

### Position Calculations

```typescript
import {
  computeLTV,
  computeLoanable,
  computeWithdrawable,
  getExtraRepayAmount,
  computeLiquidationPrice,
  simulateBorrow,
  simulateRepay,
} from "@lista-dao/moolah-sdk-core";

// Calculate current LTV
const ltv = computeLTV({
  collateral: 1000000000000000000n, // 1 ETH collateral
  borrowed: 500000000n, // 500 USDC borrowed
  priceRate: 2000000000000000000000n, // ETH = 2000 USDC
});

// Simulate a borrow operation
const result = simulateBorrow({
  collateral: 1000000000000000000n,
  borrowed: 0n,
  priceRate: 2000000000000000000000n,
  lltv: 800000000000000000n, // 80% LLTV
  supplyAmount: 500000000000000000n, // Adding 0.5 ETH
  borrowAmount: 500000000n, // Borrowing 500 USDC
});
// result: { newLTV, newLiqPrice, newLoanable, newWithdrawable, ... }
```

### Interest Rate Calculations

```typescript
import {
  computeBorrowRate,
  getBorrowRateInfo,
  getAnnualBorrowRate,
  getApy,
  getInterestRates,
} from "@lista-dao/moolah-sdk-core";

// Get annual borrow rate from per-second rate
const annualRate = getAnnualBorrowRate(ratePerSecond);

// Get comprehensive rate info
const rateInfo = getBorrowRateInfo({
  totalBorrowAssets,
  totalSupplyAssets,
  irm: { curve1, curve2 },
});

// Generate rate curve for charts
const curve = getInterestRates({
  totalBorrowAssets,
  totalSupplyAssets,
  irm: { curve1, curve2 },
  steps: 100,
});
```

### Vault Simulation

```typescript
import {
  simulateVaultDeposit,
  simulateVaultWithdraw,
  Decimal,
} from "@lista-dao/moolah-sdk-core";

// Simulate vault deposit (user balance → locked in vault)
const depositResult = simulateVaultDeposit({
  depositAmount: Decimal.parse("100", 18),
  userLocked: Decimal.parse("500", 18),
  userBalance: Decimal.parse("1000", 18),
  apy: Decimal.parse("0.05", 18), // optional, for earnings projection
  assetPrice: Decimal.parse("1", 18), // optional
});
// depositResult: { locked, balance, yearlyEarnings?, monthlyEarnings? }

// Simulate vault withdraw
const withdrawResult = simulateVaultWithdraw({
  withdrawAmount: Decimal.parse("100", 18),
  userLocked: Decimal.parse("500", 18),
  userBalance: Decimal.parse("200", 18),
});
// withdrawResult: { locked, balance, yearlyEarnings?, monthlyEarnings? }
```

### Loan Calculations

```typescript
import {
  calculateDynamicLoanRepayment,
  calculateFixedLoanRepayment,
  normalizeAprRate,
} from "@lista-dao/moolah-sdk-core";

// Calculate fixed-term loan repayment
const repayment = calculateFixedLoanRepayment({
  principal,
  apr,
  durationDays,
});
```

### Types

```typescript
import type {
  // Network
  NetworkName, // 'bsc' | 'ethereum'

  // Tokens
  TokenInfo,

  // Markets
  MarketInfo,
  MarketExtraInfo,
  WriteMarketConfig,

  // Vaults
  VaultInfo,
  VaultMetadata,

  // Smart Markets
  SmartMarketExtraInfo,
  WriteSmartMarketConfig,

  // Broker
  BrokerUserPositionsData,
  FixedTermAndRate,
  BrokerInfo,

  // Operations
  BuiltSupplyOperation,
  BuiltBorrowOperation,
  BuiltRepayOperation,
  // ... more
} from "@lista-dao/moolah-sdk-core";
```

### Contract ABIs & Addresses

```typescript
import {
  MOOLAH_ABI,
  MOOLAH_VAULT_ABI,
  INTEREST_RATE_MODEL_ABI,
  ERC20_ABI,
  getContractAddress,
  getContractAddressOptional,
} from "@lista-dao/moolah-sdk-core";

// Get contract address
const moolahAddress = getContractAddress("bsc", "moolah");
```

### Network Utilities

```typescript
import {
  getApiChain,
  getListaApiUrl,
  getNativeCurrencySymbol,
  isUsdtLikeToken,
} from "@lista-dao/moolah-sdk-core";

// Get API chain identifier (for list APIs)
const apiChain = getApiChain("bsc"); // "bsc"

// Get API URL
const url = getListaApiUrl("prod"); // "https://api.lista.org"
```

## Package Architecture

This is a **zero-dependency core package** (except for Morpho SDK for interest calculations). It's designed to be:

- **Pure** - No side effects, all functions are deterministic
- **Portable** - Works in Node.js, browsers, and serverless
- **Type-safe** - Full TypeScript support

```
moolah-sdk-core/
├── calculations/
│   ├── position.ts     # LTV, loanable, withdrawable (bigint)
│   ├── interestRate.ts # Borrow rates, APY
│   ├── stablepool.ts   # Stable swap / LP math
│   └── loan.ts         # Loan repayment calculations
├── simulate/
│   ├── market.ts       # simulateMarketBorrow, simulateMarketRepay
│   ├── vault.ts        # simulateVaultDeposit, simulateVaultWithdraw
│   └── smart.ts        # Smart market simulate + LP breakdown
├── contracts/
│   ├── abis/           # Contract ABIs
│   └── config.ts       # Contract addresses
├── types/
│   ├── market.ts       # Market types
│   ├── vault.ts        # Vault types
│   ├── smart.ts        # Smart market types
│   ├── broker.ts       # Broker types
│   └── operations.ts   # Operation result types
└── utils/
    ├── decimal.ts      # Decimal class
    ├── fraction.ts    # Fraction class
    ├── apiChain.ts     # getApiChain, getListaApiUrl
    └── network.ts      # getNativeCurrencySymbol
```

## License

MIT
