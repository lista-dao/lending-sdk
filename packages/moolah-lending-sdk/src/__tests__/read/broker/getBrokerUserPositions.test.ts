import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import { calculateDynamicLoanRepayment } from "@lista-dao/moolah-sdk-core";

import { getBrokerUserPositions } from "../../../read/broker/getBrokerUserPositions.js";

const mockReadContract = vi.fn();
const mockPublicClient = {
  readContract: mockReadContract,
} as unknown as PublicClient;

const BROKER = "0x1111111111111111111111111111111111111111" as Address;
const RATE_CALCULATOR =
  "0x2222222222222222222222222222222222222222" as Address;
const USER = "0x3333333333333333333333333333333333333333" as Address;
const WAD = 10n ** 18n;

describe("getBrokerUserPositions - dynamic debt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes dynamic outstanding with legacy decimal-normalized dynamic rate", async () => {
    const principal = 17061806491632102441n;
    const normalizedDebt = 16878807815476167930n;
    const rate = 1011624315990879851775155575n;
    const { totalRepay } = calculateDynamicLoanRepayment(
      {
        principal,
        normalizedDebt,
        rate: rate / WAD,
      },
      18,
    );
    const expectedOutstanding = totalRepay.roundDown(18).numerator;

    mockReadContract.mockImplementation(async ({ functionName }) => {
      switch (functionName) {
        case "userFixedPositions":
          return [];
        case "getFixedTerms":
          return [];
        case "userDynamicPosition":
          return { principal, normalizedDebt };
        case "getRate":
          return rate;
        default:
          throw new Error(`Unexpected function: ${String(functionName)}`);
      }
    });

    const result = await getBrokerUserPositions(
      mockPublicClient,
      BROKER,
      RATE_CALCULATOR,
      USER,
      18,
    );

    expect(result.dynamicOutstanding).not.toBeNull();
    expect(result.dynamicOutstanding?.roundDown(18).numerator).toBe(
      expectedOutstanding,
    );
    expect(result.totalOutstanding.roundDown(18).numerator).toBe(
      expectedOutstanding,
    );
  });
});
