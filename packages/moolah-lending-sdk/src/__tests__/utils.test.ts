import { describe, it, expect } from "vitest";
import { buildCallParams } from "../utils";

describe("buildCallParams", () => {
  const mockAbi = [
    {
      inputs: [
        { name: "amount", type: "uint256" },
        { name: "recipient", type: "address" },
      ],
      name: "transfer",
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "nonpayable",
      type: "function",
    },
  ] as const;

  it("should build call params with encoded data", () => {
    const result = buildCallParams({
      to: "0x1234567890123456789012345678901234567890",
      abi: mockAbi,
      functionName: "transfer",
      args: [1000n, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"],
      chainId: 56,
    });

    expect(result.to).toBe("0x1234567890123456789012345678901234567890");
    expect(result.functionName).toBe("transfer");
    expect(result.chainId).toBe(56);
    expect(result.data).toMatch(/^0x/);
    expect(result.data.length).toBeGreaterThan(2);
  });

  it("should include value when provided", () => {
    const result = buildCallParams({
      to: "0x1234567890123456789012345678901234567890",
      abi: mockAbi,
      functionName: "transfer",
      args: [1000n, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"],
      chainId: 56,
      value: 1000000000000000000n,
    });

    expect(result.value).toBe(1000000000000000000n);
  });

  it("should handle string chainId", () => {
    const result = buildCallParams({
      to: "0x1234567890123456789012345678901234567890",
      abi: mockAbi,
      functionName: "transfer",
      args: [1000n, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"],
      chainId: "56",
    });

    expect(result.chainId).toBe("56");
  });

  it("should preserve original abi and args", () => {
    const args = [1000n, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"] as const;
    const result = buildCallParams({
      to: "0x1234567890123456789012345678901234567890",
      abi: mockAbi,
      functionName: "transfer",
      args,
      chainId: 56,
    });

    expect(result.abi).toBe(mockAbi);
    expect(result.args).toEqual(args);
  });
});
