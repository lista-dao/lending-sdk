import type { Address } from "viem";

/**
 * Supported network names
 */
export type NetworkName = "bsc" | "ethereum";

/**
 * Contract configuration for a network.
 *
 * Entries that are intentionally `0x0` because they are resolved dynamically
 * rather than from this address book:
 * - `moolahVault`   — one address per vault, from the vault list / `MoolahVaultFactory`
 * - `lendingBroker` — one address per market, from `MarketInfo.broker`
 *
 * A SmartProvider address is likewise per-market and is deliberately absent
 * from this interface; it comes from `smartCollateralConfig.provider`.
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
  positionManager: Address;
  nativeProvider: Address;
  wbnb: Address;
}
