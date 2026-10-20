# @lista-dao/moolah-sdk-core

## 2.0.0

### Major Changes

- ed4264a: Complete the lending surface and settle the packaging contract.

  The SDK could not express large parts of the product. Fixed-term positions
  could be opened and repaid but not rolled, settled in full, or fed from the
  flexible leg. Smart Lending could not withdraw a single pool token. There was
  no liquidation path, no direct-to-market lending, no share-denominated vault
  deposit, and no way to move a position between markets. The catalogue could
  only be read one zone at a time.

  Added: variable-to-fixed conversion and cross-market migration; matured-term
  refinancing and whole-broker repayment; single-sided and liquidator LP
  withdrawal; public liquidation with target discovery and the protocol's own
  incentive maths; direct-to-market supply and withdraw; ERC-4626 mint; flash
  loans; EIP-712 signed authorization; bStock display conversions; and a
  grouped market catalogue that returns every zone in one response. 23 new
  methods on `MoolahSDK`, none removed or renamed.

  Also: 114 missing ABI entries across six contracts — 33 functions and 81
  custom errors, two of the ABIs entirely new — three Ethereum addresses
  recorded as 0x0 while live on-chain, and a PositionManager address that was
  not modelled on any network.

  Nineteen breaking changes, all here — see MIGRATION.md. The ones that reach
  most consumers are viem becoming a peer dependency and the new subpath
  exports.

  **Not included:** a publicly targetable BSC Testnet. Development used an
  internal testnet deployment to find several of the defects below — that
  harness lives in this repo's `scripts/` and reads chain 97 over a VPN-gated
  RPC, but it is not part of what either package ships. `NetworkName` here is
  `"bsc" | "ethereum"`.

  Then the SDK was run against real chains, which found what no static check
  could. A fixed position is addressed by its own id, not its index in the
  array it comes back in. A repay quote goes stale between quoting and
  inclusion, and paying it exactly leaves the position under the market
  minimum. The public liquidator serves an admin-curated allowlist of markets
  and refuses every other one with a bare selector the ABI could not decode.
  Not one market in the "close to liquidation" feed is on that allowlist —
  thirteen of thirteen when this was first measured, and twenty-five of
  twenty-five when it was checked again before release. A vault mint approval
  sized from `previewMint` is stale the moment a block is mined. A vault that
  deposits through a NativeProvider has no `mint` at all. Interest rate models
  cannot be identified by address: on the internal testnet deployment, none of
  four live Smart Lending markets used an IRM the address book named, and the
  one fixed-rate deployment among them was unreadable because matching on the
  address silently treated it as variable-rate. And zone 6 of the market feed
  is dirty data that looks exactly like Smart Lending from the outside — two
  of six markets carrying a `smartCollateralConfig` on that same deployment
  were zone 6. Every one of those produced a well-formed, valid-looking step
  that could only revert.

  Verification worth knowing about: an ABI-vs-chain conformance job proves
  every selector resolves on its deployment, since a unit test encodes with
  the same ABI it asserts against and cannot catch a mis-transcription. The
  vault lifecycle, the Smart Lending lifecycle and liquidation in both modes
  execute on a BSC mainnet fork, with the resulting state asserted —
  liquidation needs an unhealthy position, which nothing hands you on demand.
  An internal harness (not part of the published packages) runs the
  fixed-term lifecycle, the vault lifecycle and Smart Lending as real
  transactions against a testnet deployment and reconciles the SDK's debt
  accounting against the contract's. A parity comparator measures the SDK
  against the frontend's write surface on every CI run and on every publish.
  It compares against a committed snapshot rather than a live checkout, so the
  gap cannot reopen unnoticed for more than the snapshot's 90-day staleness
  limit.

  A pre-release security review then found two more, both in the
  authorization path and both now closed. The EIP-712 signature route applied
  none of the allowlist the transaction route applies, so a target arriving
  from a URL or an API field could be signed into a standing grant over every
  position the account holds — the worse of the two routes to leave open,
  because a signature is a bearer instrument. And the revoke docstring pointed
  at a cancellation helper that had never been written, leaving anyone who
  signed to the wrong target with no action at all;
  `buildCancelSignedAuthorizationTypedData` now exists, and the fork harness
  signs a grant, cancels it, and demonstrates that the signature can no longer
  be submitted.

  Two more of the same shape: a broker address is the only approval spender in
  this SDK that arrives from the REST API rather than the chain, and it is now
  verified by round trip — the broker names its market, Moolah names that
  market's broker, and the two must agree. And approvals that are
  deliberately over-sized, which is every repay and every liquidation here,
  now return the remainder to zero instead of leaving it standing.

## 1.0.12

### Patch Changes

- Refactor loan repayment logic in Moolah SDK to clarify the use of normalizedDebt for debt calculations while ensuring the original principal is returned. Update tests to reflect these changes and improve accuracy in repayment computations.

## 1.0.11

### Patch Changes

- Refactor loan repayment calculations in Moolah SDK to use cumulative borrow index in RAY format (27 decimals) instead of WAD format (18 decimals). Update related tests and documentation to reflect changes, ensuring improved accuracy in dynamic loan repayment computations.

## 1.0.10

### Patch Changes

- Enhance Moolah SDK by adding new methods for retrieving user holdings and market runtime data.

## 1.0.9

### Patch Changes

- Refactor loan repayment calculations in getBrokerUserPositions to include total penalty in outstanding amounts. Update related types and market user data to accommodate new totalPenalty field, ensuring accurate financial data representation across the SDK.

## 1.0.8

### Patch Changes

- Fix rounding of dynamic outstanding amount in getBrokerUserPositions function to ensure accurate loan calculations by using roundDown method with specified loan decimals.

## 1.0.7

### Patch Changes

- Enhance Moolah SDK with new method to retrieve market user data with broker information. Introduce `getMarketUserDataWithBroker` for fixed-term markets, allowing integration of broker positions into user data. Update README to reflect new API method and improve documentation on USDT handling in approval steps. Add tests to validate new functionality and ensure correct behavior across Ethereum and BSC networks.

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
