import type { Abi } from "viem";

/**
 * LendingBroker ABI - for fixed term lending operations
 */
export const LENDING_BROKER_ABI = [
  // Read functions
  {
    inputs: [],
    name: "MARKET_ID",
    outputs: [{ internalType: "Id", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  // The other half of the round trip that proves a broker address is real:
  // whose Moolah does this broker belong to?
  {
    inputs: [],
    name: "MOOLAH",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "LOAN_TOKEN",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "COLLATERAL_TOKEN",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "rateCalculator",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getFixedTerms",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "termId", type: "uint256" },
          { internalType: "uint256", name: "duration", type: "uint256" },
          { internalType: "uint256", name: "apr", type: "uint256" },
        ],
        internalType: "struct FixedTermAndRate[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "userFixedPositions",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "posId", type: "uint256" },
          { internalType: "uint256", name: "principal", type: "uint256" },
          { internalType: "uint256", name: "apr", type: "uint256" },
          { internalType: "uint256", name: "start", type: "uint256" },
          { internalType: "uint256", name: "end", type: "uint256" },
          { internalType: "uint256", name: "lastRepaidTime", type: "uint256" },
          { internalType: "uint256", name: "interestRepaid", type: "uint256" },
          { internalType: "uint256", name: "principalRepaid", type: "uint256" },
        ],
        internalType: "struct FixedLoanPosition[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "userDynamicPosition",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "principal", type: "uint256" },
          { internalType: "uint256", name: "normalizedDebt", type: "uint256" },
        ],
        internalType: "struct DynamicLoanPosition",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "uint256", name: "posId", type: "uint256" },
    ],
    name: "previewRepayFixedLoanPosition",
    outputs: [
      { internalType: "uint256", name: "interestRepaid", type: "uint256" },
      { internalType: "uint256", name: "penalty", type: "uint256" },
      { internalType: "uint256", name: "principalRepaid", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // Write functions
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "borrow",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "uint256", name: "termId", type: "uint256" },
    ],
    name: "borrow",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "address", name: "onBehalf", type: "address" },
    ],
    name: "repay",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "uint256", name: "posId", type: "uint256" },
      { internalType: "address", name: "onBehalf", type: "address" },
    ],
    name: "repay",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "termId",
        type: "uint256",
      },
    ],
    name: "convertDynamicToFixed",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        internalType: "uint256[]",
        name: "posIds",
        type: "uint256[]",
      },
    ],
    name: "refinanceMaturedFixedPositions",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
    ],
    name: "getUserTotalDebt",
    outputs: [
      {
        internalType: "uint256",
        name: "totalDebt",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "onBehalf", type: "address" }],
    name: "repayAll",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "termId",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        internalType: "address",
        name: "receiver",
        type: "address",
      },
    ],
    name: "borrow",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "AccessControlBadConfirmation",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "neededRole",
        type: "bytes32",
      },
    ],
    name: "AccessControlUnauthorizedAccount",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address",
      },
    ],
    name: "AddressEmptyCode",
    type: "error",
  },
  {
    inputs: [],
    name: "AmountZero",
    type: "error",
  },
  {
    inputs: [],
    name: "BorrowIsPaused",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "implementation",
        type: "address",
      },
    ],
    name: "ERC1967InvalidImplementation",
    type: "error",
  },
  {
    inputs: [],
    name: "ERC1967NonPayable",
    type: "error",
  },
  {
    inputs: [],
    name: "EnforcedPause",
    type: "error",
  },
  {
    inputs: [],
    name: "ExceedMaxFixedPositions",
    type: "error",
  },
  {
    inputs: [],
    name: "ExpectedPause",
    type: "error",
  },
  {
    inputs: [],
    name: "FailedCall",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidAPR",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidBorrowedAmount",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidDuration",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidInitialization",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidMarket",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidMarketId",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidTermId",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidUser",
    type: "error",
  },
  {
    inputs: [],
    name: "MarketNotSet",
    type: "error",
  },
  {
    inputs: [],
    name: "NativeNotSupported",
    type: "error",
  },
  {
    inputs: [],
    name: "NativeTransferFailed",
    type: "error",
  },
  {
    inputs: [],
    name: "NotAuthorized",
    type: "error",
  },
  {
    inputs: [],
    name: "NotInitializing",
    type: "error",
  },
  {
    inputs: [],
    name: "NotLiquidationWhitelist",
    type: "error",
  },
  {
    inputs: [],
    name: "NotMoolah",
    type: "error",
  },
  {
    inputs: [],
    name: "NothingToRepay",
    type: "error",
  },
  {
    inputs: [],
    name: "PositionNotFound",
    type: "error",
  },
  {
    inputs: [],
    name: "ReentrancyGuardReentrantCall",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
    ],
    name: "SafeERC20FailedOperation",
    type: "error",
  },
  {
    inputs: [],
    name: "SameValueProvided",
    type: "error",
  },
  {
    inputs: [],
    name: "TermNotFound",
    type: "error",
  },
  {
    inputs: [],
    name: "TransferFailed",
    type: "error",
  },
  {
    inputs: [],
    name: "UUPSUnauthorizedCallContext",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "slot",
        type: "bytes32",
      },
    ],
    name: "UUPSUnsupportedProxiableUUID",
    type: "error",
  },
  {
    inputs: [],
    name: "UnsupportedToken",
    type: "error",
  },
  {
    inputs: [],
    name: "ZeroAddress",
    type: "error",
  },
  {
    inputs: [],
    name: "ZeroAddressProvided",
    type: "error",
  },
  {
    inputs: [],
    name: "ZeroAmount",
    type: "error",
  },
  {
    inputs: [],
    name: "ZeroPositions",
    type: "error",
  },
] as const satisfies Abi;

/**
 * BrokerRateCalculator ABI - for getting dynamic rate
 */
export const BROKER_RATE_CALCULATOR_ABI = [
  {
    inputs: [{ internalType: "address", name: "broker", type: "address" }],
    name: "getRate",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;
