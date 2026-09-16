import type { PublicClient } from "viem";
import { encodeAbiParameters, keccak256 } from "viem";
import {
  MOOLAH_ABI,
  getContractAddress,
  type NetworkName,
  type MarketParams,
} from "@lista-dao/moolah-sdk-core";

/**
 * The market id a set of params hashes to — `keccak256(abi.encode(params))`,
 * the protocol's own derivation. `WriteMarketConfig` carries the params but not
 * the id, and the market state is keyed by the id.
 */
export function marketIdOf(params: MarketParams): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "address" },
            { type: "address" },
            { type: "address" },
            { type: "address" },
            { type: "uint256" },
          ],
        },
      ],
      [
        [
          params.loanToken,
          params.collateralToken,
          params.oracle,
          params.irm,
          params.lltv,
        ],
      ],
    ),
  );
}

/**
 * The protocol's virtual assets and shares.
 *
 * Morpho-Blue seeds every conversion with `VIRTUAL_ASSETS` and
 * `VIRTUAL_SHARES` so an empty market has a defined price and cannot be
 * grieved by a donation. Leaving them out is not a rounding nicety: with
 * `totalAssets = 1` and `totalShares = 2_000_000`, a request for 1e9 shares
 * costs 667 assets and the naive ratio says 500 — an approval short of what
 * the transfer pulls, so the call reverts. The same omission over-approves an
 * empty market by a factor of a million in the other direction.
 */
const VIRTUAL_ASSETS = 1n;
const VIRTUAL_SHARES = 1_000_000n;

/** `SharesMathLib.toAssetsUp`: what `shares` costs, rounded the protocol's way. */
function toAssetsUp(
  shares: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint {
  const numerator = shares * (totalAssets + VIRTUAL_ASSETS);
  const denominator = totalShares + VIRTUAL_SHARES;
  return (numerator + denominator - 1n) / denominator;
}

/** At least one unit of headroom: `assets / 100n` floors to zero below 100. */
function withHeadroom(assets: bigint): bigint {
  const margin = assets / 100n;
  return assets + (margin > 0n ? margin : 1n);
}

/**
 * What a share-denominated supply actually costs, in loan tokens.
 *
 * Same shape as the repayment below and the same reason: `supply(0, shares)`
 * still pulls tokens with `transferFrom`, so the approval has to be sized in
 * assets. Sizing it from `assets` — zero on this path — emitted no approve step
 * and the supply reverted.
 */
export async function supplySharesToAssetCeiling(
  shares: bigint,
  marketInfo: { params: MarketParams },
  publicClient: PublicClient,
  network: NetworkName,
): Promise<bigint> {
  const market = (await publicClient.readContract({
    address: getContractAddress(network, "moolah"),
    abi: MOOLAH_ABI,
    functionName: "market",
    args: [marketIdOf(marketInfo.params)],
  })) as readonly bigint[];

  const totalSupplyAssets = market?.[0];
  const totalSupplyShares = market?.[1];
  if (
    typeof totalSupplyAssets !== "bigint" ||
    typeof totalSupplyShares !== "bigint"
  ) {
    throw new Error(
      "buildMoolahSupplySteps: could not read the market state to size a " +
        "share-denominated supply. Pass `assets` instead, or supply a " +
        "publicClient that can reach Moolah.",
    );
  }
  // A market nobody created reads back as all zeros — a successful read, not a
  // throw — and `lastUpdate` is what tells the two apart: it is non-zero for
  // any market that exists, and zero only for one that does not. Without this
  // an id that was never created prices as a genuinely empty market and the
  // supply reverts after the approval has been given.
  if (market[4] === 0n) {
    throw new Error(
      `buildMoolahSupplySteps: market ${marketIdOf(marketInfo.params)} has ` +
        `never been created, so a share-denominated supply cannot be priced.`,
    );
  }

  return withHeadroom(toAssetsUp(shares, totalSupplyAssets, totalSupplyShares));
}

/**
 * What a share-denominated repayment actually costs, in loan tokens.
 *
 * Repaying by shares says how much debt to clear, not how many tokens it takes
 * to clear it — but the provider still pulls tokens, so the approval has to be
 * sized in assets. Sizing it from `assets` (which is zero on this path) meant
 * no approval was emitted at all and the repay reverted inside `transferFrom`.
 *
 * Rounded up, then given headroom: interest accrues between building and
 * inclusion, so the exact figure is stale by the time it is used, and an
 * allowance is a ceiling rather than a payment.
 */
export async function sharesToAssetCeiling(
  shares: bigint,
  // Both WriteMarketConfig and WriteSmartMarketConfig satisfy this; the
  // pricing only needs the params to derive the id.
  marketInfo: { params: MarketParams },
  publicClient: PublicClient,
  network: NetworkName,
): Promise<bigint> {
  const market = (await publicClient.readContract({
    address: getContractAddress(network, "moolah"),
    abi: MOOLAH_ABI,
    functionName: "market",
    args: [marketIdOf(marketInfo.params)],
  })) as readonly bigint[];

  const totalBorrowAssets = market?.[2];
  const totalBorrowShares = market?.[3];
  if (
    typeof totalBorrowAssets !== "bigint" ||
    typeof totalBorrowShares !== "bigint"
  ) {
    throw new Error(
      "buildRepaySteps: could not read the market state to size a " +
        "share-denominated repayment. Pass `assets` instead, or supply a " +
        "publicClient that can reach Moolah.",
    );
  }
  if (totalBorrowShares === 0n) {
    // Zero borrow shares reads back the same whether the market is untouched
    // or was never created. Either way there is no position to repay and no
    // price to quote, and returning 0 would emit no approval — reproducing
    // exactly the bug this function exists to fix.
    throw new Error(
      "buildRepaySteps: the market has no borrow shares at all, so a " +
        "share-denominated repayment cannot be priced. Check that the market " +
        "config passed in describes the market you are repaying.",
    );
  }

  // Rounded the protocol's way, then given headroom — at least one unit of it,
  // because a 1% margin on a ceiling below 100 raw units floors to nothing and
  // the approval goes stale the moment a single wei of interest accrues.
  return withHeadroom(toAssetsUp(shares, totalBorrowAssets, totalBorrowShares));
}
