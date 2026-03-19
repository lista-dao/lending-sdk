# @lista-dao/moolah-lending-sdk

## 1.0.11

### Patch Changes

- Refactor loan repayment calculations in Moolah SDK to use cumulative borrow index in RAY format (27 decimals) instead of WAD format (18 decimals). Update related tests and documentation to reflect changes, ensuring improved accuracy in dynamic loan repayment computations.
- Updated dependencies
  - @lista-dao/moolah-sdk-core@1.0.11

## 1.0.10

### Patch Changes

- Enhance Moolah SDK by adding new methods for retrieving user holdings and market runtime data.
- Updated dependencies
  - @lista-dao/moolah-sdk-core@1.0.10

## 1.0.9

### Patch Changes

- Refactor getBrokerUserPositions to utilize calculateDynamicLoanRepayment for dynamic outstanding calculations, improving accuracy by converting rates to WAD format. Introduce helper functions for rate normalization and outstanding calculation, enhancing code clarity and maintainability.

## 1.0.8

### Patch Changes

- Refactor loan repayment calculations in getBrokerUserPositions to include total penalty in outstanding amounts. Update related types and market user data to accommodate new totalPenalty field, ensuring accurate financial data representation across the SDK.
- Updated dependencies
  - @lista-dao/moolah-sdk-core@1.0.9

## 1.0.7

### Patch Changes

- Fix rounding of dynamic outstanding amount in getBrokerUserPositions function to ensure accurate loan calculations by using roundDown method with specified loan decimals.
- Updated dependencies
  - @lista-dao/moolah-sdk-core@1.0.8

## 1.0.6

### Patch Changes

- Enhance Moolah SDK with new method to retrieve market user data with broker information. Introduce `getMarketUserDataWithBroker` for fixed-term markets, allowing integration of broker positions into user data. Update README to reflect new API method and improve documentation on USDT handling in approval steps. Add tests to validate new functionality and ensure correct behavior across Ethereum and BSC networks.
- Updated dependencies
  - @lista-dao/moolah-sdk-core@1.0.7

## 1.0.5

### Patch Changes

- Implement market simulation methods in MoolahSDK for borrowing and repaying positions. Introduce new types for simulation parameters and results, enhance transport configuration handling, and update tests to validate new functionality. This update improves the SDK's capability to simulate market interactions based on user data and market state.
- Updated dependencies
  - @lista-dao/moolah-sdk-core@1.0.6

## 1.0.4

### Patch Changes

- Refactor imports in Moolah SDK to use .js extensions for consistency across all modules. This change affects various files including builders, types, utils, and tests, ensuring compatibility with ES module standards.
- Updated dependencies
  - @lista-dao/moolah-sdk-core@1.0.5

## 1.0.3

### Patch Changes

- Enhance Moolah SDK with holdings functionality and improve API parameter handling
- Updated dependencies
  - @lista-dao/moolah-sdk-core@1.0.4

## 1.0.2

### Patch Changes

- Add Prettier configuration and update package.json scripts for formatting
- Updated dependencies
  - @lista-dao/moolah-sdk-core@1.0.3

## 1.0.1

### Patch Changes

- Update readme files
- Updated dependencies
  - @lista-dao/moolah-sdk-core@1.0.1

## 1.0.0

### Major Changes

- b2175c2: Initial public release of Moolah Lending SDK. Core package provides types, calculations, contract ABIs, and API client; lending-sdk provides transaction step builders for supply, borrow, repay, vault, and smart market operations on BNB Chain and Ethereum. Publish will be handled by CI.

### Patch Changes

- Updated dependencies [b2175c2]
  - @lista-dao/moolah-sdk-core@1.0.0
