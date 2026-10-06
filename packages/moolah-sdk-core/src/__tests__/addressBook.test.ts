import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import {
  CONTRACT_ADDRESSES,
  getContractAddress,
  getContractAddressOptional,
} from "../contracts/config.js";
import type { NetworkContracts, NetworkName } from "../contracts/types.js";

const ZERO = "0x0000000000000000000000000000000000000000";

const NETWORKS: NetworkName[] = ["bsc", "ethereum"];

/**
 * Entries that are legitimately `0x0`, each with the reason it is not a hole.
 * Anything NOT listed here must be a real address — that is the point of the
 * test. Adding an entry requires stating why.
 */
const EXPECTED_ZERO: Record<string, string> = {
  "bsc.moolahVault": "per-vault, resolved from the vault list",
  "ethereum.moolahVault": "per-vault, resolved from the vault list",
  "bsc.lendingBroker": "per-market, resolved from MarketInfo.broker",
  "ethereum.lendingBroker": "per-market, resolved from MarketInfo.broker",
  "ethereum.oracleAdaptor":
    "not deployed on Ethereum; frontend leaves it unset",
  "ethereum.wbnb": "no WETH concept in the Ethereum deployment",
};

describe("address book", () => {
  it("covers exactly the supported networks", () => {
    expect(Object.keys(CONTRACT_ADDRESSES).sort()).toEqual(
      [...NETWORKS].sort(),
    );
  });

  it("has no unexplained zero addresses", () => {
    const unexplained: string[] = [];
    for (const network of NETWORKS) {
      const contracts = CONTRACT_ADDRESSES[network];
      for (const [name, address] of Object.entries(contracts)) {
        const key = `${network}.${name}`;
        if (address === ZERO && !(key in EXPECTED_ZERO)) {
          unexplained.push(key);
        }
      }
    }
    expect(unexplained).toEqual([]);
  });

  it("keeps every documented zero actually zero", () => {
    // Guards against someone "helpfully" filling a dynamically-resolved slot.
    for (const key of Object.keys(EXPECTED_ZERO)) {
      const [network, name] = key.split(".") as [
        NetworkName,
        keyof NetworkContracts,
      ];
      expect(CONTRACT_ADDRESSES[network][name]).toBe(ZERO);
    }
  });

  it("configures positionManager on every network", () => {
    for (const network of NETWORKS) {
      expect(CONTRACT_ADDRESSES[network].positionManager).not.toBe(ZERO);
    }
  });

  it("stores every address as 20 bytes of hex", () => {
    for (const network of NETWORKS) {
      for (const [name, address] of Object.entries(
        CONTRACT_ADDRESSES[network],
      )) {
        expect(address, `${network}.${name}`).toMatch(/^0x[0-9a-fA-F]{40}$/);
      }
    }
  });

  it("stores every address in EIP-55 checksummed form", () => {
    // A lowercase address carries no checksum, so a transposed character in it
    // passes every other gate in this repo. Checksumming is the only thing
    // standing between a typo and an approval to the wrong contract.
    for (const network of NETWORKS) {
      for (const [name, address] of Object.entries(
        CONTRACT_ADDRESSES[network],
      )) {
        expect(address, `${network}.${name}`).toBe(getAddress(address));
      }
    }
  });

  it("throws for an unconfigured contract and returns zero from the optional form", () => {
    expect(() => getContractAddress("ethereum", "oracleAdaptor")).toThrow();
    expect(getContractAddressOptional("ethereum", "oracleAdaptor")).toBe(ZERO);
  });
});
