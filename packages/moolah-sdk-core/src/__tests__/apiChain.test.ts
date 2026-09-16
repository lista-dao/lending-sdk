import { describe, it, expect } from "vitest";
import {
  getApiChain,
  getApiUrlForNetwork,
  LISTA_API_URL,
} from "../utils/apiChain.js";
import { getNativeCurrencySymbol } from "../utils/network.js";

describe("API chain mapping", () => {
  it("maps configured networks", () => {
    expect(getApiChain("bsc")).toBe("bsc");
    expect(getApiChain("ethereum")).toBe("ethereum");
  });

  it("uses the production host for every supported network", () => {
    expect(getApiUrlForNetwork("bsc")).toBe(LISTA_API_URL);
    expect(getApiUrlForNetwork("ethereum")).toBe(LISTA_API_URL);
  });
});

describe("native currency symbols", () => {
  it("returns mainnet symbols", () => {
    expect(getNativeCurrencySymbol("bsc")).toBe("BNB");
    expect(getNativeCurrencySymbol("ethereum")).toBe("ETH");
  });
});
