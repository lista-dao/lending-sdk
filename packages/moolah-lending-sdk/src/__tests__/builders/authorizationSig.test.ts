import { describe, it, expect, vi } from "vitest";
import {
  decodeFunctionData,
  keccak256,
  toHex,
  encodeAbiParameters,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MOOLAH_ABI, getContractAddress } from "@lista-dao/moolah-sdk-core";
import {
  buildAuthorizationTypedData,
  buildSetAuthorizationWithSigSteps,
  getAuthorizationNonce,
  splitAuthorizationSignature,
  MOOLAH_AUTHORIZATION_TYPES,
} from "../../builders/authorizationSig.js";

const PM = "0x8eBFa9e687aF71EC2e87A0380F73b9f57FDf3ec0" as const;
const MOOLAH = getContractAddress("bsc", "moolah");
const CHAIN = 56;

/** anvil's well-known first key — a test vector, not a secret. */
const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

/** Fixed clock, so the deadline cap is deterministic in tests. */
const NOW = 1_800_000_000n;

const authorization = {
  authorizer: account.address,
  authorized: PM,
  isAuthorized: true,
  nonce: 0n,
  deadline: NOW + 600n,
};

const typedDataParams = {
  chainId: CHAIN,
  network: "bsc" as const,
  now: NOW,
};

describe("EIP-712 authorization typed data", () => {
  it("matches the contract's typehash field for field", () => {
    // Field order is part of the hash. Reordering silently produces a
    // signature the contract rejects, so the typehash is pinned directly.
    const encoded = MOOLAH_AUTHORIZATION_TYPES.Authorization.map(
      (f) => `${f.type} ${f.name}`,
    ).join(",");
    expect(`Authorization(${encoded})`).toBe(
      "Authorization(address authorizer,address authorized,bool isAuthorized,uint256 nonce,uint256 deadline)",
    );
  });

  it("carries only chainId and verifyingContract in the domain", () => {
    // Moolah's domain is EIP712Domain(uint256 chainId,address
    // verifyingContract) — no name, no version. Signers derive the domain type
    // from the fields present, so an extra field changes the separator.
    const typed = buildAuthorizationTypedData(authorization, typedDataParams);
    expect(Object.keys(typed.domain).sort()).toEqual([
      "chainId",
      "verifyingContract",
    ]);
    expect(typed.domain.verifyingContract).toBe(MOOLAH);
    expect(typed.primaryType).toBe("Authorization");
  });

  it("produces the domain separator the contract computes", () => {
    const DOMAIN_TYPEHASH = keccak256(
      toHex("EIP712Domain(uint256 chainId,address verifyingContract)"),
    );
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [DOMAIN_TYPEHASH, BigInt(CHAIN), MOOLAH],
      ),
    );
    // Pinned from Moolah.domainSeparator() on BSC via scripts/fork-check.mjs.
    expect(expected.slice(0, 10)).toBe("0x4be7e1c6");
  });
});

describe("deadline cap", () => {
  it("rejects a deadline already in the past", () => {
    expect(() =>
      buildAuthorizationTypedData(
        { ...authorization, deadline: NOW - 1n },
        typedDataParams,
      ),
    ).toThrow(/already in the past/);
  });

  it("rejects a deadline beyond the default one-hour cap", () => {
    // A signature is a bearer instrument and a plain revoke cannot cancel one,
    // because it does not consume the nonce. The deadline is the only bound
    // that exists, so a distant one is a standing grant.
    expect(() =>
      buildAuthorizationTypedData(
        { ...authorization, deadline: NOW + 86_400n },
        typedDataParams,
      ),
    ).toThrow(/beyond the 3600s cap/);
  });

  it("allows a longer deadline only when widened deliberately", () => {
    const typed = buildAuthorizationTypedData(
      { ...authorization, deadline: NOW + 86_400n },
      { ...typedDataParams, maxTtlSeconds: 172_800n },
    );
    expect(typed.message.deadline).toBe(NOW + 86_400n);
  });

  it("accepts a deadline exactly at the cap", () => {
    expect(() =>
      buildAuthorizationTypedData(
        { ...authorization, deadline: NOW + 3600n },
        typedDataParams,
      ),
    ).not.toThrow();
  });
});

describe("signature splitting", () => {
  it("splits a real signature into the tuple the contract takes", async () => {
    const signature = await account.signTypedData(
      buildAuthorizationTypedData(authorization, typedDataParams),
    );
    const { v, r, s } = splitAuthorizationSignature(signature);
    expect(r).toHaveLength(66);
    expect(s).toHaveLength(66);
    expect([27, 28]).toContain(v);
  });

  it("normalises a 0/1 recovery id to 27/28", () => {
    const sig = `0x${"11".repeat(32)}${"22".repeat(32)}00` as const;
    expect(splitAuthorizationSignature(sig).v).toBe(27);
  });

  it("rejects a signature that is not 65 bytes", () => {
    expect(() => splitAuthorizationSignature("0xdeadbeef")).toThrow(
      /65-byte signature/,
    );
  });
});

describe("submitting a signed authorization", () => {
  it("encodes the struct and the split signature", async () => {
    const signature = await account.signTypedData(
      buildAuthorizationTypedData(authorization, typedDataParams),
    );
    const steps = buildSetAuthorizationWithSigSteps(
      { chainId: CHAIN, authorization, signature },
      "bsc",
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("setAuthorization");
    expect(steps[0].params.to).toBe(MOOLAH);

    const { functionName, args } = decodeFunctionData({
      abi: MOOLAH_ABI,
      data: steps[0].params.data,
    });
    expect(functionName).toBe("setAuthorizationWithSig");
    const [auth, sig] = args as unknown as [
      Record<string, unknown>,
      { v: number },
    ];
    expect(auth.isAuthorized).toBe(true);
    expect(auth.nonce).toBe(0n);
    expect([27, 28]).toContain(sig.v);
  });

  it("accepts an already-split signature", () => {
    const steps = buildSetAuthorizationWithSigSteps(
      {
        chainId: CHAIN,
        authorization,
        signature: {
          v: 27,
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
        },
      },
      "bsc",
    );
    expect(steps[0].params.data).toMatch(/^0x/);
  });

  it("normalises an already-split signature's yParity v the same way the hex path does", () => {
    // viem's secp256k1.sign().recovery, ethers v6's Signature.yParity and
    // @noble/curves all hand back 0/1. A `uint8` accepts either shape
    // silently, and ecrecover(digest, 1, r, s) returns address(0) on-chain —
    // the tuple branch used to skip the normalisation the hex branch applies.
    for (const [given, expected] of [
      [0, 27],
      [1, 28],
      [27, 27],
      [28, 28],
    ] as const) {
      const steps = buildSetAuthorizationWithSigSteps(
        {
          chainId: CHAIN,
          authorization,
          signature: {
            v: given,
            r: `0x${"11".repeat(32)}`,
            s: `0x${"22".repeat(32)}`,
          },
        },
        "bsc",
      );
      const { args } = decodeFunctionData({
        abi: MOOLAH_ABI,
        data: steps[0].params.data,
      });
      const [, sig] = args as unknown as [
        Record<string, unknown>,
        { v: number },
      ];
      expect(sig.v).toBe(expected);
    }
  });

  it("rejects a recovery id that is not 0, 1, 27 or 28, on both branches", () => {
    const build = (
      signature: Parameters<
        typeof buildSetAuthorizationWithSigSteps
      >[0]["signature"],
    ) =>
      buildSetAuthorizationWithSigSteps(
        { chainId: CHAIN, authorization, signature },
        "bsc",
      );

    expect(() =>
      build({ v: 2, r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}` }),
    ).toThrow(/Invalid signature recovery id/);

    // The raw-hex branch: a 65-byte signature whose final byte is 0x02.
    expect(() =>
      build(`0x${"11".repeat(32)}${"22".repeat(32)}02` as const),
    ).toThrow(/Invalid signature recovery id/);
  });

  it("labels a revocation as such", () => {
    const steps = buildSetAuthorizationWithSigSteps(
      {
        chainId: CHAIN,
        authorization: { ...authorization, isAuthorized: false },
        signature: {
          v: 27,
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
        },
      },
      "bsc",
    );
    expect(steps[0].step).toBe("revokeAuthorization");
  });
});

describe("nonce", () => {
  it("reads the authorizer's nonce from Moolah", async () => {
    const publicClient = {
      readContract: vi.fn().mockResolvedValue(7n),
    } as unknown as PublicClient;

    const nonce = await getAuthorizationNonce(account.address, {
      publicClient,
      network: "bsc",
    });
    expect(nonce).toBe(7n);
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOOLAH,
        functionName: "nonce",
        args: [account.address],
      }),
    );
  });
});
