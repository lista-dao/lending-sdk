import { describe, it, expect } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type PublicClient,
} from "viem";
import { getSmartMarketExtraInfo } from "../../../read/smart/getSmartMarketExtraInfo.js";

/**
 * The catch-all this file exists for.
 *
 * `getSmartMarketExtraInfo` reads `token(0)`/`token(1)`/`dex`/`dexLP`/`dexInfo`
 * off the collateral provider and, if any of those calls fails, reports "not a
 * Smart Lending market" — the correct diagnosis for a zone-6 entry, whose
 * "provider" genuinely implements none of that interface and reverts.
 *
 * It was reported that way for *any* failure, including a timeout or a 429
 * from a rate-limited node — neither of which says anything about the
 * contract. A caller retrying after a transport hiccup got told the market
 * did not exist instead. `isContractLevelFailure` is what discriminates them;
 * these two tests are that either side of it is reached.
 */

const MARKET =
  "0x058073a21fea8dd3aa250713a56ad7526cc27c8f74e85f5433821c6fe5d03e1b" as const;
const LOAN_TOKEN = "0x0000000000000000000000000000000000000010" as const;
const COLLATERAL_TOKEN = "0x0000000000000000000000000000000000000020" as const;
const LOAN_PROVIDER = "0x0000000000000000000000000000000000000011" as const;
const COLLATERAL_PROVIDER =
  "0x0000000000000000000000000000000000000022" as const;

const CONTRACTS = {
  moolah: "0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C" as Address,
  interestRateModel: "0x0000000000000000000000000000000000000030" as Address,
  fixedRateIrm: "0x0000000000000000000000000000000000000040" as Address,
  nativeProvider: "0x0000000000000000000000000000000000000050" as Address,
  wbnb: "0x0000000000000000000000000000000000000060" as Address,
};

/** A revert with no data — the shape a node reports it in some cases. */
const contractLevelFailure = () =>
  new BaseError("The contract function reverted.", {
    cause: new ContractFunctionRevertedError({ abi: [], functionName: "dex" }),
  });

/** Not a viem error at all — a plain transport failure. */
const transportFailure = () => new Error("HTTP request failed. Status: 429");

/**
 * Answers every call this function makes, benignly, except the collateral
 * provider's `token`/`dex`/`dexLP`/`dexInfo` reads — those are handed to
 * `onCollateralProviderCall` so each test controls exactly one failure mode.
 */
function client(onCollateralProviderCall: () => unknown): PublicClient {
  return {
    readContract: async ({
      address,
      functionName,
      args,
    }: {
      address: string;
      functionName: string;
      args?: readonly unknown[];
    }) => {
      if (functionName === "idToMarketParams") {
        return [
          LOAN_TOKEN,
          COLLATERAL_TOKEN,
          "0x0",
          "0x0",
          800000000000000000n,
        ];
      }
      if (functionName === "market") {
        return [1000n, 1000n, 500n, 500n, 0n, 0n];
      }
      if (functionName === "providers") {
        return args?.[1] === LOAN_TOKEN ? LOAN_PROVIDER : COLLATERAL_PROVIDER;
      }
      if (
        address.toLowerCase() === COLLATERAL_PROVIDER.toLowerCase() &&
        ["token", "dex", "dexLP", "dexInfo"].includes(functionName)
      ) {
        return onCollateralProviderCall();
      }
      return 0n;
    },
  } as unknown as PublicClient;
}

describe("getSmartMarketExtraInfo — the collateral-provider interface check", () => {
  it("reports 'not a Smart Lending market' on a genuine contract-level failure", async () => {
    await expect(
      getSmartMarketExtraInfo(
        client(() => {
          throw contractLevelFailure();
        }),
        CONTRACTS,
        "bsc",
        MARKET,
      ),
    ).rejects.toThrow(/is not a Smart Lending market/);
  });

  it("rethrows a transport failure as-is, rather than misreporting the market", async () => {
    await expect(
      getSmartMarketExtraInfo(
        client(() => {
          throw transportFailure();
        }),
        CONTRACTS,
        "bsc",
        MARKET,
      ),
    ).rejects.toThrow(/HTTP request failed. Status: 429/);
  });
});
