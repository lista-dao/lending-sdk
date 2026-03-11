import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";

import { getBrokerUserPositions } from "../../../read/broker/getBrokerUserPositions.js";

const mockReadContract = vi.fn();
const mockPublicClient = {
  readContract: mockReadContract,
} as unknown as PublicClient;

const BROKER = "0x1111111111111111111111111111111111111111" as Address;
const RATE_CALCULATOR =
  "0x2222222222222222222222222222222222222222" as Address;
const USER = "0x3333333333333333333333333333333333333333" as Address;
const RAY = 10n ** 27n;

describe("getBrokerUserPositions - dynamic debt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes dynamic outstanding with normalizedDebt * rate / 1e27", async () => {
    const principal = 17061806491632102441n;
    const normalizedDebt = 16878807815476167930n;
    const rate = 1011624315990879851775155575n;
    const expectedOutstanding = (normalizedDebt * rate) / RAY;

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
