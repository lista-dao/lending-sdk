# @lista-dao/moolah-lending-sdk

Builder SDK for the Lista lending protocol. Returns transaction steps (`StepParam[]`) that you execute with your own wallet infrastructure.

## Installation

```bash
pnpm add @lista-dao/moolah-lending-sdk
```

## Quick Start

```typescript
import { MoolahSDK } from "@lista-dao/moolah-lending-sdk";
import { parseUnits } from "viem";

const sdk = new MoolahSDK({
  rpcUrls: {
    56: "https://bsc-dataseed.binance.org",
    1: "https://eth.llamarpc.com",
  },
});

// Build supply steps
const steps = await sdk.buildSupplyParams({
  chainId: 56,
  marketId,
  assets: parseUnits("100", 18),
  walletAddress: userAddress,
});

// Execute with your wallet
for (const step of steps) {
  await walletClient.writeContract({
    address: step.params.to,
    abi: step.params.abi,
    functionName: step.params.functionName,
    args: step.params.args,
    value: step.params.value,
  });
}
```

## StepParam Structure

```typescript
interface StepParam {
  step:
    | "approve"
    | "supply"
    | "borrow"
    | "repay"
    | "withdraw"
    | "depositVault"
    | "withdrawVault"
    | "supplySmartDexLp"
    | "supplySmartCollateral"
    | "withdrawSmartDexLp"
    | "withdrawSmartCollateral"
    | "withdrawSmartCollateralFixed"
    | "repaySmartMarket"
    | "brokerBorrow"
    | "brokerRepay";
  params: {
    to: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
    chainId: ChainId;
    data: `0x${string}`;
  };
  meta?: {
    token?: Address;
    spender?: Address;
    amount?: bigint;
    reset?: boolean;
  };
}
```

## Read Methods

### On-Chain Data

```typescript
// Market data
const marketExtra = await sdk.getMarketExtraInfo(chainId, marketId);
const userData = await sdk.getMarketUserData(chainId, marketId, userAddress);
const writeConfig = await sdk.getWriteConfig(chainId, marketId);

// Vault data
const vaultInfo = await sdk.getVaultInfo(chainId, vaultAddress);
const vaultUserData = await sdk.getVaultUserData(
  chainId,
  vaultAddress,
  userAddress,
);

// Smart market data
const smartExtra = await sdk.getSmartMarketExtraInfo(chainId, marketId);
const smartUserData = await sdk.getSmartMarketUserData(
  chainId,
  marketId,
  userAddress,
);

// Broker data
const fixedTerms = await sdk.getBrokerFixedTerms(chainId, brokerAddress);
const brokerPositions = await sdk.getBrokerUserPositions(
  chainId,
  brokerAddress,
  userAddress,
);
```

### API Data (with Filtering & Sorting)

The API supports server-side filtering and sorting via parameters:

```typescript
const chain = sdk.getApiChain(chainId); // "bsc" or "ethereum"

// Market list with filters
const markets = await sdk.getMarketList({
  chain,
  page: 1,
  pageSize: 20,
  sort: "rate", // Sort field
  order: "desc", // Sort direction
  zone: 0, // Filter by zone
  keyword: "ETH", // Search keyword
  loans: ["USDT"], // Filter by loan tokens
  collaterals: ["ETH"], // Filter by collateral tokens
  termType: 0, // 0 = flexible, 1 = fixed
});

// Vault list with filters
const vaults = await sdk.getVaultList({
  chain,
  page: 1,
  pageSize: 20,
  sort: "apy",
  order: "desc",
  zone: 0,
  keyword: "USDT",
  assets: ["USDT"],
  curators: ["Lista DAO"],
});

// Market info
const marketInfo = await sdk.getMarketInfo(chainId, marketId);

// Vault metadata
const vaultMeta = await sdk.getVaultMetadata(vaultAddress);

// Vaults for a market
const marketVaults = await sdk.getMarketVaultDetails(marketId, {
  page: 1,
  pageSize: 10,
});
```

## Build Methods

### Market Operations

```typescript
// Supply collateral
const supplySteps = await sdk.buildSupplyParams({
  chainId: 56,
  marketId,
  assets: parseUnits("100", 18),
  walletAddress,
  onBehalf, // optional
});

// Borrow
const borrowSteps = await sdk.buildBorrowParams({
  chainId: 56,
  marketId,
  assets: parseUnits("50", 6),
  walletAddress,
  receiver, // optional
});

// Repay
const repaySteps = await sdk.buildRepayParams({
  chainId: 56,
  marketId,
  assets: parseUnits("50", 6),
  walletAddress,
  repayAll: false, // set true to repay entire debt
});

// Withdraw
const withdrawSteps = await sdk.buildWithdrawParams({
  chainId: 56,
  marketId,
  assets: parseUnits("100", 18),
  walletAddress,
  withdrawAll: false, // set true to withdraw all
});
```

### Vault Operations

```typescript
// Deposit
const depositSteps = await sdk.buildVaultDepositParams({
  chainId: 56,
  vaultAddress,
  assets: parseUnits("1000", 6),
  walletAddress,
});

// Withdraw
const withdrawSteps = await sdk.buildVaultWithdrawParams({
  chainId: 56,
  vaultAddress,
  assets: parseUnits("500", 6),
  walletAddress,
  withdrawAll: false,
});
```

### Smart Market Operations

```typescript
// Supply DEX LP tokens
const lpSteps = await sdk.buildSmartSupplyDexLpParams({
  chainId: 56,
  marketId,
  lpAmount: parseUnits("10", 18),
  walletAddress,
});

// Supply collateral (adds liquidity + supplies)
const collateralSteps = await sdk.buildSmartSupplyCollateralParams({
  chainId: 56,
  marketId,
  tokenAAmount: parseUnits("1", 18),
  tokenBAmount: parseUnits("2000", 6),
  minLpAmount: parseUnits("9", 18),
  walletAddress,
});

// Withdraw DEX LP
const withdrawLpSteps = await sdk.buildSmartWithdrawDexLpParams({
  chainId: 56,
  marketId,
  lpAmount: parseUnits("5", 18),
  walletAddress,
});

// Withdraw collateral (variable)
const withdrawCollSteps = await sdk.buildSmartWithdrawCollateralParams({
  chainId: 56,
  marketId,
  tokenAAmount: parseUnits("0.5", 18),
  tokenBAmount: parseUnits("1000", 6),
  maxLpBurn: parseUnits("6", 18),
  walletAddress,
});

// Withdraw collateral (fixed)
const withdrawFixedSteps = await sdk.buildSmartWithdrawCollateralFixedParams({
  chainId: 56,
  marketId,
  lpAmount: parseUnits("5", 18),
  minTokenAAmount: parseUnits("0.4", 18),
  minTokenBAmount: parseUnits("900", 6),
  walletAddress,
});

// Repay
const smartRepaySteps = await sdk.buildSmartRepayParams({
  chainId: 56,
  marketId,
  assets: parseUnits("100", 6),
  walletAddress,
  repayAll: false,
});
```

### Broker Operations

```typescript
// Borrow from broker
const brokerBorrowSteps = await sdk.buildBrokerBorrowParams({
  chainId: 56,
  brokerAddress,
  amount: parseUnits("100", 6),
  termId: 1n, // optional: for fixed-term loans
});

// Repay broker loan
const brokerRepaySteps = await sdk.buildBrokerRepayParams({
  chainId: 56,
  brokerAddress,
  amount: parseUnits("100", 6),
  loanToken,
  walletAddress,
  posId: 1n, // optional: for fixed-term positions
});
```

## API Reference

### Read Methods

| Method                                            | Source | Description                |
| ------------------------------------------------- | ------ | -------------------------- |
| `getMarketExtraInfo(chainId, marketId)`           | Chain  | Market on-chain data       |
| `getMarketUserData(chainId, marketId, user)`      | Chain  | User market position       |
| `getWriteConfig(chainId, marketId)`               | Chain  | Config for write ops       |
| `getVaultInfo(chainId, vaultAddress)`             | Chain  | Vault on-chain data        |
| `getVaultUserData(chainId, vaultAddress, user)`   | Chain  | User vault position        |
| `getSmartMarketExtraInfo(chainId, marketId)`      | Chain  | Smart market on-chain data |
| `getSmartMarketUserData(chainId, marketId, user)` | Chain  | Smart market user position |
| `getBrokerFixedTerms(chainId, broker)`            | Chain  | Broker fixed-term rates    |
| `getBrokerUserPositions(chainId, broker, user)`   | Chain  | Broker user positions      |
| `getMarketInfo(chainId, marketId)`                | API    | Market metadata            |
| `getMarketList(params)`                           | API    | Market list with filters   |
| `getVaultMetadata(address)`                       | API    | Vault metadata             |
| `getVaultList(params)`                            | API    | Vault list with filters    |
| `getMarketVaultDetails(marketId, params)`         | API    | Vaults for a market        |

### Build Methods

| Method                                            | Description                                |
| ------------------------------------------------- | ------------------------------------------ |
| `buildSupplyParams(params)`                       | Build supply collateral steps              |
| `buildBorrowParams(params)`                       | Build borrow steps                         |
| `buildRepayParams(params)`                        | Build repay steps                          |
| `buildWithdrawParams(params)`                     | Build withdraw steps                       |
| `buildVaultDepositParams(params)`                 | Build vault deposit steps                  |
| `buildVaultWithdrawParams(params)`                | Build vault withdraw steps                 |
| `buildSmartSupplyDexLpParams(params)`             | Build smart LP supply steps                |
| `buildSmartSupplyCollateralParams(params)`        | Build smart collateral supply              |
| `buildSmartWithdrawDexLpParams(params)`           | Build smart LP withdraw steps              |
| `buildSmartWithdrawCollateralParams(params)`      | Build smart collateral withdraw (variable) |
| `buildSmartWithdrawCollateralFixedParams(params)` | Build smart collateral withdraw (fixed)    |
| `buildSmartRepayParams(params)`                   | Build smart market repay steps             |
| `buildBrokerBorrowParams(params)`                 | Build broker borrow steps                  |
| `buildBrokerRepayParams(params)`                  | Build broker repay steps                   |

## License

MIT
