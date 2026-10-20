export {
  ERC20_APPROVE_ABI,
  buildApproveSteps,
  type BuildApproveParams,
} from "./approve.js";
export {
  buildSupplySteps,
  buildBorrowSteps,
  buildRepaySteps,
  buildWithdrawSteps,
  buildMoolahSupplySteps,
  buildMoolahWithdrawSteps,
  buildFlashLoanSteps,
  type MarketBuilderDeps,
} from "./market.js";
export {
  buildVaultDepositSteps,
  buildVaultWithdrawSteps,
  buildVaultMintSteps,
  type VaultBuilderDeps,
} from "./vault.js";
export {
  buildSmartSupplyDexLpSteps,
  buildSmartSupplyCollateralSteps,
  buildSmartWithdrawDexLpSteps,
  buildSmartWithdrawCollateralSteps,
  buildSmartWithdrawCollateralFixedSteps,
  buildSmartRepaySteps,
  buildSmartWithdrawCollateralOneCoinSteps,
  buildRedeemSmartLpCollateralSteps,
  type SmartBuilderDeps,
} from "./smart.js";
export {
  buildBrokerBorrowSteps,
  buildBrokerRepaySteps,
  buildBrokerRepayAllSteps,
  buildBrokerRefinanceMaturedSteps,
  buildConvertDynamicToFixedSteps,
} from "./broker.js";
export {
  buildLiquidateSteps,
  isLiquidationMarketEnabled,
  quoteLiquidationCost,
  type LiquidationBuilderDeps,
} from "./liquidation.js";
export {
  buildSetAuthorizationSteps,
  buildRevokeAuthorizationSteps,
  buildMigrateToFixedTermSteps,
  type AuthorizationBuilderDeps,
} from "./authorization.js";
export { buildClearAllowanceStep } from "./approve.js";
export { assertAuthorizable } from "./authorization.js";
export {
  buildAuthorizationTypedData,
  buildCancelSignedAuthorizationTypedData,
  buildSetAuthorizationWithSigSteps,
  getAuthorizationNonce,
  splitAuthorizationSignature,
  MOOLAH_AUTHORIZATION_TYPES,
  type MoolahAuthorization,
  type AuthorizationSignature,
} from "./authorizationSig.js";

// The config guards the facade applies, exported so a caller building steps
// directly can apply them once where their config enters their process —
// rather than reimplementing `marketIdOf` plus two provider reads plus the
// metadata cross-check by hand, which is how the gaps this release closed got
// there in the first place.
export {
  assertMarketConfigMatchesMarket,
  assertSmartConfigTokens,
  assertVaultConfigAsset,
} from "../configTrust.js";
