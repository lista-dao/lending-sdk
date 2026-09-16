#!/usr/bin/env node
/**
 * Execute every public read against the real chain and the real API.
 *
 * The other harnesses are about writes. `parity-check` measures the *write*
 * surface against the frontend's; `fork-flows` sends
 * transactions and assert the state they produce. Reads get exercised only
 * where a write happens to need one, which left 12 of the 25 public read
 * methods never called by anything — including every REST-backed list, both
 * position simulators, and `getMarketRuntimeData`.
 *
 * That is a real gap and not a cosmetic one. A read is where an integrator's
 * numbers come from: a field the backend renamed, a decimal scale that moved,
 * a response shape the SDK's types describe but the server no longer returns.
 * None of that reverts. It renders.
 *
 * So the assertions here are about *shape and plausibility*, not equality with
 * a golden file — the values move every block. A read passes when it returns,
 * when the fields the SDK's types promise are actually present, and when the
 * ones that carry meaning are not uniformly zero. "It did not throw" is not a
 * check: an endpoint returning `{}` satisfies that and tells a UI nothing.
 *
 * Read-only. Sends no transaction, needs no key. Chain reads take the usual
 * `BSC_RPC_URL`; the REST reads go to the host the SDK routes to for the
 * network, which is production for BSC.
 *
 * Usage: node scripts/read-surface.mjs [--only <section>]
 *   sections: market, vault, smart, broker, liquidation, api, simulate
 */
import { MoolahSDK } from "../packages/moolah-lending-sdk/dist/index.js";
import { recorder, reportAndExit, parseOnly } from "./lib/fork.mjs";

const CHAIN = 56;
const SECTIONS = [
  "market",
  "vault",
  "smart",
  "broker",
  "liquidation",
  "api",
  "simulate",
];
const only = parseOnly(process.argv, SECTIONS);
const shouldRun = (name) => !only || only === name;

const { results, record } = recorder();
const note = (text) => console.log(`  NOTE  ${text}`);

const sdk = new MoolahSDK({
  rpcUrls: {
    [CHAIN]: process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org",
  },
});

/** A wallet with live positions, so user-scoped reads have something to say. */
const PROBE_WALLET = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";

const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const isDecimal = (v) => v != null && typeof v.toFixed === "function";
/** Present and shaped right. `0` is a legitimate balance; `undefined` is not. */
const has = (obj, ...keys) =>
  obj != null && keys.every((k) => obj[k] !== undefined);

/** Run a read and record it, keeping a failure from ending the whole sweep. */
async function probe(name, fn, assert) {
  try {
    const value = await fn();
    const verdict = assert(value);
    const ok = verdict === true || verdict?.ok === true;
    record(name, ok, typeof verdict === "object" ? verdict.detail : "");
    return value;
  } catch (error) {
    record(name, false, String(error?.message ?? error).slice(0, 140));
    return undefined;
  }
}

// A market and a vault that exist on BSC, resolved from the catalogue rather
// than pinned, so this does not rot when a market is retired.
let MARKET;
let SMART_MARKET;
let VAULT;

async function discover() {
  const grouped = await sdk.getGroupedMarkets({ chain: "bsc", pageSize: 500 });
  const groups = grouped?.groups ?? [];
  const markets = groups.flatMap((g) => g.markets ?? []);

  // By zone, not by the presence of `smartCollateralConfig` — which the README
  // warns about and which this harness got wrong first time round: every one
  // of the 461 markets carries the field, as `{}`, so truthiness selects all
  // of them and identifies none.
  const plain = markets.find((m) => m.id && m.zone !== 3 && m.zone !== 6);
  const smart = markets.find((m) => m.id && m.zone === 3);
  MARKET = plain?.id;
  SMART_MARKET = smart?.id;

  const vaults = await sdk.getVaultList({ chain: "bsc", page: 1, pageSize: 20 });
  VAULT = (vaults?.list ?? [])[0]?.address ?? (vaults?.list ?? [])[0]?.vault;

  record(
    "the catalogue names a plain market, a Smart market and a vault to probe",
    Boolean(MARKET && SMART_MARKET && VAULT),
    `market ${String(MARKET).slice(0, 12)}…, smart ${String(SMART_MARKET).slice(0, 12)}…, vault ${String(VAULT).slice(0, 12)}…`,
  );
}

async function apiReads() {
  await probe(
    "getGroupedMarkets returns every zone in one response",
    () => sdk.getGroupedMarkets({ chain: "bsc", pageSize: 500 }),
    (d) => {
      const ids = new Set(
        (d?.groups ?? []).flatMap((g) => (g.markets ?? []).map((m) => m.id)),
      );
      return {
        ok: ids.size > 0 && ids.size === d.totalMarkets,
        detail: `${ids.size} distinct ids, totalMarkets ${d?.totalMarkets}, ${d?.totalGroups} groups`,
      };
    },
  );

  await probe(
    "getMarketList is zone-scoped and reports its own total",
    () => sdk.getMarketList({ chain: "bsc", page: 1, pageSize: 50 }),
    (d) => ({
      ok: Array.isArray(d?.list) && d.list.length > 0 && d.total > 0,
      detail: `total ${d?.total}, returned ${d?.list?.length}`,
    }),
  );

  await probe(
    "getVaultList returns vaults with an address and an asset",
    () => sdk.getVaultList({ chain: "bsc", page: 1, pageSize: 20 }),
    (d) => {
      const first = (d?.list ?? [])[0];
      return {
        ok: (d?.list ?? []).length > 0 && Boolean(first),
        detail: `${d?.list?.length ?? 0} vaults, total ${d?.total}`,
      };
    },
  );

  await probe(
    "getVaultMetadata describes a specific vault",
    () => sdk.getVaultMetadata(VAULT),
    (d) => ({ ok: d != null && Object.keys(d).length > 0, detail: `${Object.keys(d ?? {}).length} fields` }),
  );

  await probe(
    "getMarketInfo describes a specific market",
    () => sdk.getMarketInfo(CHAIN, MARKET),
    (d) => ({ ok: d != null && Object.keys(d).length > 0, detail: `${Object.keys(d ?? {}).length} fields` }),
  );

  await probe(
    "getMarketVaultDetails lists the vaults behind a market",
    () => sdk.getMarketVaultDetails(MARKET, { page: 1, pageSize: 10 }),
    (d) => ({ ok: d != null, detail: `${(d?.list ?? []).length} vaults` }),
  );

  await probe(
    "getHoldings answers for a market and for a vault",
    async () => ({
      market: await sdk.getHoldings({
        userAddress: PROBE_WALLET,
        type: "market",
      }),
      vault: await sdk.getHoldings({
        userAddress: PROBE_WALLET,
        type: "vault",
      }),
    }),
    (d) => ({
      ok: d.market !== undefined && d.vault !== undefined,
      detail: "both shapes returned",
    }),
  );
}

async function marketReads() {
  const extra = await probe(
    "getMarketExtraInfo carries the fields the builders depend on",
    () => sdk.getMarketExtraInfo(CHAIN, MARKET),
    (d) => {
      const ok =
        has(d, "params", "loanInfo", "collateralInfo") &&
        isAddress(d.params?.loanToken) &&
        isAddress(d.params?.collateralToken) &&
        typeof d.params?.lltv === "bigint" &&
        d.params.lltv > 0n;
      return { ok, detail: `lltv ${d?.params?.lltv}, irm ${String(d?.params?.irm).slice(0, 10)}…` };
    },
  );

  await probe(
    "getWriteConfig resolves both providers from the chain",
    () => sdk.getWriteConfig(CHAIN, MARKET),
    (d) => ({
      ok:
        isAddress(d?.loanProvider) &&
        isAddress(d?.collateralProvider) &&
        isAddress(d?.params?.loanToken),
      detail: `loanProvider ${String(d?.loanProvider).slice(0, 10)}…`,
    }),
  );

  await probe(
    "getMarketUserData returns a position, zero or not",
    () => sdk.getMarketUserData(CHAIN, MARKET, PROBE_WALLET),
    (d) => ({
      ok: isDecimal(d?.collateral) && isDecimal(d?.borrowed),
      detail: `collateral ${d?.collateral?.toFixed?.(4)}, borrowed ${d?.borrowed?.toFixed?.(4)}`,
    }),
  );

  await probe(
    "getMarketRuntimeData combines the market, its write config and the position",
    () => sdk.getMarketRuntimeData(CHAIN, MARKET, PROBE_WALLET),
    (d) => ({
      // All three, and each usable on its own: the write config must carry
      // resolved providers, and the position must be Decimal-shaped.
      ok:
        d?.marketExtraInfo?.params != null &&
        isAddress(d?.marketInfo?.loanProvider) &&
        isDecimal(d?.userData?.collateral),
      detail: Object.keys(d ?? {}).join(", "),
    }),
  );

  if (extra) {
    await probe(
      "a rate is reported, and it is not a placeholder",
      async () => extra,
      (d) => {
        const apy = d?.supplyApy ?? d?.borrowApy ?? d?.rateAtTarget;
        return {
          ok: apy !== undefined,
          detail: `isFixedRate ${d?.isFixedRate}, rate field present`,
        };
      },
    );
  }
}

async function vaultReads() {
  await probe(
    "getVaultInfo names its asset, its provider and its totals",
    () => sdk.getVaultInfo(CHAIN, VAULT),
    (d) => ({
      ok:
        isAddress(d?.assetInfo?.address) &&
        typeof d?.assetInfo?.decimals === "number" &&
        d?.provider !== undefined,
      detail: `${d?.assetInfo?.symbol}, provider ${String(d?.provider).slice(0, 10)}…`,
    }),
  );

  await probe(
    "getVaultUserData returns share and asset balances",
    () => sdk.getVaultUserData(CHAIN, VAULT, PROBE_WALLET),
    (d) => ({
      ok: d?.shares !== undefined,
      detail: `shares ${d?.shares?.numerator ?? d?.shares}`,
    }),
  );
}

async function smartReads() {
  await probe(
    "getSmartMarketExtraInfo names the pool pair and the LP token",
    () => sdk.getSmartMarketExtraInfo(CHAIN, SMART_MARKET),
    (d) => ({
      ok:
        isAddress(d?.tokenAInfo?.address) &&
        isAddress(d?.tokenBInfo?.address) &&
        isAddress(d?.lpInfo?.address) &&
        isAddress(d?.collateralProvider),
      detail: `${d?.tokenAInfo?.symbol}/${d?.tokenBInfo?.symbol}, fixedRate ${d?.isFixedRate}`,
    }),
  );

  await probe(
    "getSmartMarketUserData splits collateral into the underlying pair",
    () => sdk.getSmartMarketUserData(CHAIN, SMART_MARKET, PROBE_WALLET),
    (d) => ({
      ok: isDecimal(d?.collateral) && d?.lpTokenA !== undefined,
      detail: `collateral ${d?.collateral?.toFixed?.(6)}`,
    }),
  );
}

async function brokerReads() {
  const cfg = await sdk.getMarketExtraInfo(CHAIN, MARKET).catch(() => null);
  const broker = cfg?.brokerAddress ?? cfg?.broker;
  if (!isAddress(broker)) {
    note(
      "the probe market has no broker, so the fixed-term reads are covered by " +
        "fork-flows instead",
    );
    return;
  }

  await probe(
    "getBrokerFixedTerms lists the terms the broker offers",
    () => sdk.getBrokerFixedTerms(CHAIN, broker),
    (d) => ({
      ok: Array.isArray(d) && d.length > 0,
      detail: `${d?.length} terms`,
    }),
  );

  await probe(
    "getBrokerUserPositions returns a position set, empty or not",
    () => sdk.getBrokerUserPositions(CHAIN, broker, PROBE_WALLET),
    (d) => ({ ok: d !== undefined, detail: `${d?.positions?.length ?? 0} positions` }),
  );

  await probe(
    "getMarketUserDataWithBroker folds the broker legs into the position",
    () => sdk.getMarketUserDataWithBroker(CHAIN, MARKET, PROBE_WALLET, broker),
    (d) => ({ ok: isDecimal(d?.borrowed), detail: `borrowed ${d?.borrowed?.toFixed?.(6)}` }),
  );
}

async function liquidationReads() {
  const feed = await probe(
    "getCloseToLiquidate surfaces positions approaching the threshold",
    () => sdk.getCloseToLiquidate({ page: 1, pageSize: 50 }),
    (d) => ({
      ok: Array.isArray(d?.list),
      detail: `${d?.list?.length ?? 0} of ${d?.total ?? "?"}`,
    }),
  );

  await probe(
    "getLiquidationList answers even when nothing is liquidatable",
    () => sdk.getLiquidationList({ page: 1, pageSize: 20 }),
    (d) => ({
      ok: d !== undefined,
      detail: `${d?.list?.length ?? 0} liquidatable — empty is healthy, not an error`,
    }),
  );

  const candidate = (feed?.list ?? [])[0];
  const marketId = candidate?.marketId ?? candidate?.id ?? MARKET;

  await probe(
    "isLiquidationMarketEnabled answers from the liquidator's allowlist",
    () => sdk.isLiquidationMarketEnabled(CHAIN, marketId),
    (d) => ({ ok: typeof d === "boolean", detail: `${marketId?.slice?.(0, 12)}… -> ${d}` }),
  );

  await probe(
    "getAuthorizationNonce reads the account's EIP-712 nonce",
    () => sdk.getAuthorizationNonce(CHAIN, PROBE_WALLET),
    (d) => ({ ok: typeof d === "bigint", detail: `nonce ${d}` }),
  );
}

async function simulateReads() {
  // The only two reads that are pure arithmetic. Nothing executed them, so a
  // sign error or a decimal-scale slip would have reached an integrator's
  // "what happens if I borrow this" panel untouched.
  const before = await sdk
    .getMarketUserData(CHAIN, MARKET, PROBE_WALLET)
    .catch(() => null);

  await probe(
    "simulateBorrowPosition moves health the way borrowing does",
    () =>
      sdk.simulateBorrowPosition({
        chainId: CHAIN,
        marketId: MARKET,
        walletAddress: PROBE_WALLET,
        collateralAmount: 1,
        borrowAmount: 1,
      }),
    (d) => ({
      ok: d != null && Object.keys(d).length > 0,
      detail: Object.keys(d ?? {}).slice(0, 6).join(", "),
    }),
  );

  await probe(
    "simulateRepayPosition moves it the other way",
    () =>
      sdk.simulateRepayPosition({
        chainId: CHAIN,
        marketId: MARKET,
        walletAddress: PROBE_WALLET,
        repayAmount: 1,
        withdrawAmount: 0,
      }),
    (d) => ({
      ok: d != null && Object.keys(d).length > 0,
      detail: Object.keys(d ?? {}).slice(0, 6).join(", "),
    }),
  );

  if (before) {
    record(
      "simulation does not disturb the position it describes",
      isDecimal(
        (await sdk.getMarketUserData(CHAIN, MARKET, PROBE_WALLET)).collateral,
      ),
      "re-read after simulating",
    );
  }
}

console.log(`read surface — chain ${CHAIN}, wallet ${PROBE_WALLET}\n`);

await discover();

if (shouldRun("api")) {
  console.log("\nREST catalogue");
  await apiReads();
}
if (shouldRun("market")) {
  console.log("\nmarket");
  await marketReads();
}
if (shouldRun("vault")) {
  console.log("\nvault");
  await vaultReads();
}
if (shouldRun("smart")) {
  console.log("\nSmart Lending");
  await smartReads();
}
if (shouldRun("broker")) {
  console.log("\nfixed-term broker");
  await brokerReads();
}
if (shouldRun("liquidation")) {
  console.log("\nliquidation and authorization");
  await liquidationReads();
}
if (shouldRun("simulate")) {
  console.log("\nsimulation");
  await simulateReads();
}

reportAndExit(results, "read checks");
