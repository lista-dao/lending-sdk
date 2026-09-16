---
"@lista-dao/moolah-sdk-core": major
"@lista-dao/moolah-lending-sdk": major
---

Complete the lending surface and settle the packaging contract.

The SDK could not express large parts of the product. Fixed-term positions
could be opened and repaid but not rolled, settled in full, or fed from the
flexible leg. Smart Lending could not withdraw a single pool token. There was
no liquidation path, no direct-to-market lending, no share-denominated vault
deposit, and no way to move a position between markets. The catalogue could
only be read one zone at a time, and no testnet could be targeted at all.

Added: variable-to-fixed conversion and cross-market migration; matured-term
refinancing and whole-broker repayment; single-sided and liquidator LP
withdrawal; public liquidation with target discovery and the protocol's own
incentive maths; direct-to-market supply and withdraw; ERC-4626 mint; flash
loans; EIP-712 signed authorization; bStock display conversions; BSC Testnet;
and a grouped market catalogue that returns every zone in one response.

Also: 114 missing ABI entries across six contracts — 33 functions and 81
custom errors, two of the ABIs entirely new — three Ethereum addresses recorded
as 0x0 while live on-chain, and a PositionManager address that was not modelled
on any network.

Twenty-one breaking changes, all here — see MIGRATION.md. The ones that reach
most consumers are viem becoming a peer dependency and the new subpath exports.

Then the SDK was run against real chains, which found what no static check
could. A fixed position is addressed by its own id, not its index in the array
it comes back in. A repay quote goes stale between quoting and inclusion, and
paying it exactly leaves the position under the market minimum. The public
liquidator serves an admin-curated allowlist of markets and refuses every other
one with a bare selector the ABI could not decode. Not one market in the "close
to liquidation" feed is on that allowlist — thirteen of thirteen when this was
first measured, and twenty-five of twenty-five when it was checked again before
release. A vault mint approval sized from
`previewMint` is stale the moment a block is mined. A vault that deposits
through a NativeProvider has no `mint` at all. Interest rate models cannot be
identified by address: none of the four live Smart Lending markets on BSC
Testnet uses an IRM the address book names, and the one fixed-rate deployment
among them was unreadable because matching on the address silently treated it
as a variable-rate market. And zone 6 of the market feed is dirty data that
looks exactly like Smart Lending from the outside — two of the six BSC Testnet
markets carrying a `smartCollateralConfig` are zone 6. Every one of those produced
a well-formed, valid-looking step that could only revert.

Verification worth knowing about: an ABI-vs-chain conformance job proves every
selector resolves on its deployment, since a unit test encodes with the same
ABI it asserts against and cannot catch a mis-transcription. The vault
lifecycle, the Smart Lending lifecycle and liquidation in both modes execute on
a BSC mainnet fork, with the resulting state asserted — liquidation needs an
unhealthy position, which no testnet hands you on demand. A testnet harness
runs the fixed-term lifecycle, the vault lifecycle and Smart Lending as real
transactions on chain 97 and reconciles the SDK's debt accounting against the
contract's. A parity comparator measures the SDK against the frontend's write
surface on every CI run and on every publish. It compares against a committed
snapshot rather than a live checkout, so the gap cannot reopen unnoticed for
more than the snapshot's 90-day staleness limit.

A pre-release security review then found two more, both in the authorization
path and both now closed. The EIP-712 signature route applied none of the
allowlist the transaction route applies, so a target arriving from a URL or an
API field could be signed into a standing grant over every position the account
holds — the worse of the two routes to leave open, because a signature is a
bearer instrument. And the revoke docstring pointed at a cancellation helper
that had never been written, leaving anyone who signed to the wrong target with
no action at all; `buildCancelSignedAuthorizationTypedData` now exists, and the
fork harness signs a grant, cancels it, and demonstrates that the signature can
no longer be submitted.

Two more of the same shape: a broker address is the only approval spender in
this SDK that arrives from the REST API rather than the chain, and it is now
verified by round trip — the broker names its market, Moolah names that market's
broker, and the two must agree. And approvals that are deliberately over-sized,
which is every repay and every liquidation here, now return the remainder to
zero instead of leaving it standing.
