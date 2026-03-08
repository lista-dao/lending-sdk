# @lista-dao/moolah-sdk-core

## 1.0.6

### Patch Changes

- Implement market simulation methods in MoolahSDK for borrowing and repaying positions. Introduce new types for simulation parameters and results, enhance transport configuration handling, and update tests to validate new functionality. This update improves the SDK's capability to simulate market interactions based on user data and market state.

## 1.0.5

### Patch Changes

- Refactor imports in Moolah SDK to use .js extensions for consistency across all modules. This change affects various files including builders, types, utils, and tests, ensuring compatibility with ES module standards.

## 1.0.4

### Patch Changes

- Enhance Moolah SDK with holdings functionality and improve API parameter handling

## 1.0.3

### Patch Changes

- Add Prettier configuration and update package.json scripts for formatting

## 1.0.2

### Patch Changes

- Add baseLoanable and computeLoanableForLTV to market borrow simulations

## 1.0.1

### Patch Changes

- Update readme files

## 1.0.0

### Major Changes

- b2175c2: Initial public release of Moolah Lending SDK. Core package provides types, calculations, contract ABIs, and API client; lending-sdk provides transaction step builders for supply, borrow, repay, vault, and smart market operations on BNB Chain and Ethereum. Publish will be handled by CI.
