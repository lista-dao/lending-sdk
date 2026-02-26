import type { Abi } from "viem";

/**
 * SmartProvider ABI - for LP-based collateral operations
 */
export const SMART_PROVIDER_ABI = [
  // Read functions
  {
    inputs: [{ internalType: "uint256", name: "i", type: "uint256" }],
    name: "token",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "dex",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "dexLP",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "dexInfo",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  // Write functions
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "loanToken", type: "address" },
          { internalType: "address", name: "collateralToken", type: "address" },
          { internalType: "address", name: "oracle", type: "address" },
          { internalType: "address", name: "irm", type: "address" },
          { internalType: "uint256", name: "lltv", type: "uint256" },
        ],
        internalType: "struct MarketParams",
        name: "marketParams",
        type: "tuple",
      },
      { internalType: "address", name: "onBehalf", type: "address" },
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
      { internalType: "uint256", name: "minLpAmount", type: "uint256" },
    ],
    name: "supplyCollateral",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "loanToken", type: "address" },
          { internalType: "address", name: "collateralToken", type: "address" },
          { internalType: "address", name: "oracle", type: "address" },
          { internalType: "address", name: "irm", type: "address" },
          { internalType: "uint256", name: "lltv", type: "uint256" },
        ],
        internalType: "struct MarketParams",
        name: "marketParams",
        type: "tuple",
      },
      { internalType: "address", name: "onBehalf", type: "address" },
      { internalType: "uint256", name: "lpAmount", type: "uint256" },
    ],
    name: "supplyDexLp",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "loanToken", type: "address" },
          { internalType: "address", name: "collateralToken", type: "address" },
          { internalType: "address", name: "oracle", type: "address" },
          { internalType: "address", name: "irm", type: "address" },
          { internalType: "uint256", name: "lltv", type: "uint256" },
        ],
        internalType: "struct MarketParams",
        name: "marketParams",
        type: "tuple",
      },
      { internalType: "uint256", name: "collateralAmount", type: "uint256" },
      { internalType: "uint256", name: "minToken0Amount", type: "uint256" },
      { internalType: "uint256", name: "minToken1Amount", type: "uint256" },
      { internalType: "address", name: "onBehalf", type: "address" },
      { internalType: "address payable", name: "receiver", type: "address" },
    ],
    name: "withdrawCollateral",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "loanToken", type: "address" },
          { internalType: "address", name: "collateralToken", type: "address" },
          { internalType: "address", name: "oracle", type: "address" },
          { internalType: "address", name: "irm", type: "address" },
          { internalType: "uint256", name: "lltv", type: "uint256" },
        ],
        internalType: "struct MarketParams",
        name: "marketParams",
        type: "tuple",
      },
      { internalType: "uint256", name: "assets", type: "uint256" },
      { internalType: "address", name: "onBehalf", type: "address" },
      { internalType: "address", name: "receiver", type: "address" },
    ],
    name: "withdrawDexLp",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "loanToken", type: "address" },
          { internalType: "address", name: "collateralToken", type: "address" },
          { internalType: "address", name: "oracle", type: "address" },
          { internalType: "address", name: "irm", type: "address" },
          { internalType: "uint256", name: "lltv", type: "uint256" },
        ],
        internalType: "struct MarketParams",
        name: "marketParams",
        type: "tuple",
      },
      { internalType: "uint256", name: "token0Amount", type: "uint256" },
      { internalType: "uint256", name: "token1Amount", type: "uint256" },
      { internalType: "uint256", name: "maxCollateralAmount", type: "uint256" },
      { internalType: "address", name: "onBehalf", type: "address" },
      { internalType: "address payable", name: "receiver", type: "address" },
    ],
    name: "withdrawCollateralImbalance",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const satisfies Abi;
