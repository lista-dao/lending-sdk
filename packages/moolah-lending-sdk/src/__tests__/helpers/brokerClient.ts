import { vi } from "vitest";
import type { Address, PublicClient } from "viem";
import {
  getContractAddress,
  type NetworkName,
} from "@lista-dao/moolah-sdk-core";

/**
 * A public client that answers the reads a broker repay actually makes.
 *
 * Repaying to a broker is the one place in this SDK where an approval spender
 * arrives from the REST API rather than from the chain, so the builder proves
 * the address is real before approving to it: it asks the broker which market
 * and which Moolah it belongs to, then asks Moolah whether that market's broker
 * is the same address. A mock that returns a single value for every read cannot
 * express that, and a test built on one is testing a builder that no longer
 * exists.
 */
export function brokerClient(options: {
  allowance?: bigint;
  broker: Address;
  network: NetworkName;
  /** Make the round trip fail the way an impostor address would. */
  registeredBroker?: Address;
  /** Make the broker claim a different Moolah. */
  claimedMoolah?: Address;
  marketId?: `0x${string}`;
}): PublicClient {
  const marketId =
    options.marketId ??
    "0x058073a21fea8dd3aa250713a56ad7526cc27c8f74e85f5433821c6fe5d03e1b";
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "MARKET_ID":
          return marketId;
        case "MOOLAH":
          return (
            options.claimedMoolah ??
            getContractAddress(options.network, "moolah")
          );
        case "brokers":
          return options.registeredBroker ?? options.broker;
        default:
          return options.allowance ?? 0n;
      }
    }),
  } as unknown as PublicClient;
}
