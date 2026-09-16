import { MoolahSDK } from "./MoolahSDK.js";
import type { MoolahSDKConfig } from "./types.js";

export { MoolahSDK } from "./MoolahSDK.js";

export type {
  MoolahSDKConfig,
  ChainId,
  ContractCallParams,
  StepParam,
  BuildSupplyParams,
  BuildBorrowParams,
  BuildRepayParams,
  BuildWithdrawParams,
  BuildVaultDepositParams,
  BuildVaultWithdrawParams,
  BuildVaultMintParams,
  BuildMoolahSupplyParams,
  BuildMoolahWithdrawParams,
  BuildFlashLoanParams,
  AssetsOrShares,
  RepayAmount,
  WithdrawAmount,
  BuildSmartSupplyDexLpParams,
  BuildSmartSupplyCollateralParams,
  BuildSmartWithdrawDexLpParams,
  BuildSmartWithdrawCollateralParams,
  BuildSmartWithdrawCollateralFixedParams,
  BuildSmartRepayParams,
  BuildSmartWithdrawCollateralOneCoinParams,
  BuildRedeemSmartLpCollateralParams,
  BuildBrokerBorrowParams,
  BuildBrokerRepayParams,
  BuildBrokerRepayAllParams,
  BuildBrokerRefinanceMaturedParams,
  BuildConvertDynamicToFixedParams,
  BuildAuthorizationParams,
  BuildMigrateToFixedTermParams,
  MigrationDebtAmount,
  BuildLiquidateParams,
  QuoteLiquidationCostParams,
  SeizedOrRepaid,
  StepName,
  StepObservedState,
  SdkTransportConfig,
  MarketRuntimeData,
  SimulateBorrowPositionParams,
  SimulateBorrowPositionResult,
  SimulateRepayPositionParams,
  SimulateRepayPositionResult,
} from "./types.js";

export { MoolahApiClient } from "@lista-dao/moolah-sdk-core";
export type {
  MoolahApiClientConfig,
  FetchFn,
} from "@lista-dao/moolah-sdk-core";

export type {
  MarketExtraInfo,
  MarketInfo,
  MarketUserData,
  SmartMarketExtraInfo,
  SmartMarketUserData,
  VaultInfo,
  VaultUserData,
  WriteMarketConfig,
  WriteSmartMarketConfig,
  ApiVaultList,
  ApiVaultItem,
  ApiVaultInfo,
  ApiMarketList,
  ApiMarketItem,
  ApiTableParams,
  ApiGroupedMarketList,
  ApiGroupedMarketItem,
  ApiMarketGroup,
  ApiGroupedMarketListParams,
  ApiLiquidationList,
  ApiLiquidationItem,
  ApiLiquidationListParams,
  ApiCloseToLiquidateParams,
  NetworkName,
  FixedTermAndRate,
  BrokerUserPositionsData,
} from "@lista-dao/moolah-sdk-core";

export {
  Decimal,
  getContractAddress,
  getContractAddressOptional,
  toWriteConfig,
  isUsdtLikeToken,
  getApiChain,
  LISTA_API_URL,
  brokerPositionsToUserFixedTermData,
} from "@lista-dao/moolah-sdk-core";

/**
 * The inline `import("./types")` this used to carry emitted an extensionless
 * relative specifier into `index.d.ts`, which is a hard error for any consumer
 * on `moduleResolution: node16`/`nodenext` unless they have `skipLibCheck` on.
 * A normal type import keeps the `.js` suffix through declaration emit.
 */
export const initMoolahSDK = (config: MoolahSDKConfig) => new MoolahSDK(config);

export {
  assertMarketConfigMatchesMarket,
  assertSmartConfigTokens,
  assertVaultConfigAsset,
} from "./configTrust.js";

export {
  buildApproveSteps,
  buildSupplySteps,
  buildBorrowSteps,
  buildRepaySteps,
  buildWithdrawSteps,
  buildMoolahSupplySteps,
  buildMoolahWithdrawSteps,
  buildFlashLoanSteps,
  buildVaultDepositSteps,
  buildVaultWithdrawSteps,
  buildVaultMintSteps,
  buildSmartSupplyDexLpSteps,
  buildSmartSupplyCollateralSteps,
  buildSmartWithdrawDexLpSteps,
  buildSmartWithdrawCollateralSteps,
  buildSmartWithdrawCollateralFixedSteps,
  buildSmartRepaySteps,
  buildSmartWithdrawCollateralOneCoinSteps,
  buildRedeemSmartLpCollateralSteps,
  buildBrokerBorrowSteps,
  buildBrokerRepaySteps,
  buildBrokerRepayAllSteps,
  buildBrokerRefinanceMaturedSteps,
  buildConvertDynamicToFixedSteps,
  buildSetAuthorizationSteps,
  buildRevokeAuthorizationSteps,
  buildMigrateToFixedTermSteps,
  buildAuthorizationTypedData,
  buildCancelSignedAuthorizationTypedData,
  buildSetAuthorizationWithSigSteps,
  getAuthorizationNonce,
  splitAuthorizationSignature,
  MOOLAH_AUTHORIZATION_TYPES,
  type MoolahAuthorization,
  type AuthorizationSignature,
  buildLiquidateSteps,
  quoteLiquidationCost,
  type MarketBuilderDeps,
  type VaultBuilderDeps,
  type SmartBuilderDeps,
} from "./builders/index.js";
