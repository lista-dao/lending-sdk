import { describe, it, expect } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  type PublicClient,
} from "viem";
import type { VaultInfo } from "@lista-dao/moolah-sdk-core";
import { Decimal } from "@lista-dao/moolah-sdk-core";
import { getVaultUserData } from "../../../read/vault/getVaultUserData.js";

/**
 * `isWhiteList` was reported as `true` (permissive) for any failure — a
 * transport error read exactly like a revert. The sibling of the fix applied
 * to `getSmartMarketExtraInfo` elsewhere in this release; this file is the
 * instance that sweep missed.
 */

const VAULT_INFO: VaultInfo = {
  assetInfo: {
    address: "0x0000000000000000000000000000000000000099",
    symbol: "T",
    decimals: 18,
  },
  isNative: false,
  isProvider: false,
  provider: "0x0000000000000000000000000000000000000000",
  totalSupply: Decimal.ZERO,
  totalAssets: Decimal.ZERO,
} as unknown as VaultInfo;

const clientAnswering = (whiteListBehavior: () => unknown): PublicClient =>
  ({
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "isWhiteList") return whiteListBehavior();
      return 0n;
    },
  }) as unknown as PublicClient;

const contractLevelFailure = () =>
  new BaseError("The contract function reverted.", {
    cause: new ContractFunctionRevertedError({
      abi: [],
      functionName: "isWhiteList",
    }),
  });

describe("getVaultUserData — the isWhiteList catch", () => {
  it("reads a genuine revert (no allowlist function) as not gated", async () => {
    const data = await getVaultUserData(
      clientAnswering(() => {
        throw contractLevelFailure();
      }),
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
      VAULT_INFO,
    );
    expect(data).toBeDefined();
  });

  it("propagates a transport failure instead of reporting the vault as ungated", async () => {
    await expect(
      getVaultUserData(
        clientAnswering(() => {
          throw new Error("HTTP request failed. Status: 429 Too Many Requests");
        }),
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
        VAULT_INFO,
      ),
    ).rejects.toThrow(/429/);
  });
});
