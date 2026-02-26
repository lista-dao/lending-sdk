import type { Address } from "viem";

/**
 * Supported network names
 */
export type NetworkName = "bsc" | "ethereum";

/**
 * Contract configuration for a network
 */
export interface NetworkContracts {
  moolah: Address;
  moolahVault: Address;
  interestRateModel: Address;
  fixedRateIrm: Address;
  oracleAdaptor: Address;
  moolahVaultFactory: Address;
  moolahPublicLiquidation: Address;
  lendingBroker: Address;
  brokerRateCalculator: Address;
  nativeProvider: Address;
  wbnb: Address;
}
