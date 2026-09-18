#!/usr/bin/env node
/**
 * State-changing end-to-end checks on BSC Testnet.
 *
 * These are the flows that calldata verification cannot settle. The ABI
 * conformance job proves a call is encoded correctly; it cannot prove that a
 * sequence, once executed, leaves the chain in the state the SDK claimed it
 * would. That requires sending transactions.
 *
 * The key never reaches this file as an argument or a literal. It is read from
 * TESTNET_PRIVATE_KEY, and the script refuses to run on anything but chain 97
 * so a mainnet key cannot be spent here by accident.
 *
 *   TESTNET_PRIVATE_KEY=0x...    required; use a throwaway account
 *   BSC_TESTNET_RPC_URL=...      required; internal VPN endpoint
 *
 * Usage: node scripts/testnet-e2e.mjs [--only <name>]
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { MoolahSDK } from "@lista-dao/moolah-lending-sdk";
import {
  CONTRACT_ADDRESSES,
  LENDING_BROKER_ABI,
  MOOLAH_VAULT_ABI,
} from "@lista-dao/moolah-sdk-core";
import { parseOnly } from "./lib/fork.mjs";

const CHAIN_ID = 97;
const RPC = process.env.BSC_TESTNET_RPC_URL?.trim();

/**
 * Private deployment data used only by this internal harness. It is not part
 * of the SDK's public address book or REST routing contract.
 */
CONTRACT_ADDRESSES.bscTestnet = {
  moolah: "0x4c26397D4ef9EEae55735a1631e69Da965eBC41A",
  moolahVault: "0x0000000000000000000000000000000000000000",
  interestRateModel: "0x8b32223feD5Ff5099889606FCec103DC95e12b7F",
  fixedRateIrm: "0xCC5a2ecf0Fa3c0810251366B1cBb8D89aDFa47a6",
  oracleAdaptor: "0x0000000000000000000000000000000000000000",
  moolahVaultFactory: "0x85C5E375E6De288a1BD98ad5EDAfEe5B0Dc43e96",
  moolahPublicLiquidation: "0x72429Ed997217bcD16DC8fD938337F02928EEfe0",
  lendingBroker: "0x0000000000000000000000000000000000000000",
  brokerRateCalculator: "0x638B87aBD83C54CBaABBDfF096f94F795fe9e83c",
  positionManager: "0x26Dff388eB6c4A0fDE3EC8A8B3a29cD9997B4BB1",
  nativeProvider: "0x68f59f66Cfd68541F6d2fF9478d9359ECb24D14c",
  wbnb: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
};

/**
 * A live bscTestnet fixed-term market. Terms are 600s / 3600s / 21600s, short
 * enough that a full borrow-to-maturity cycle fits inside one CI job.
 */
const FIXED_TERM_MARKET = {
  id: "0x058073a21fea8dd3aa250713a56ad7526cc27c8f74e85f5433821c6fe5d03e1b",
  broker: "0x0659063d10e05aa0d3d52d79e71a5a9d6d1b283a",
  loanToken: "0x49b1401b4406fe0b32481613bf1bc9fe4b9378ac",
  collateralToken: "0xcc752dc4ae72386986d011c2b485be0dad98c744",
};

/**
 * Enough to clear the market's minimum loan without tying up the account.
 * The market rejects a position below `minLoan`, so borrowing a token amount
 * that looks reasonable in isolation reverts with broker/positions-below-min-loan.
 */
const COLLATERAL_TO_SUPPLY = 2n * 10n ** 17n; // 0.2 slisBNB
const AMOUNT_TO_BORROW = 20n * 10n ** 18n; // 20 USDT

/** Lista USDT Vault on bscTestnet. No provider, so `mint` is available. */
const VAULT = "0xe5eb1546d5e664e82de0da97e94767b989d4bfd3";

/**
 * The Smart Lending market this harness writes to: BTCB/solvBTC stable-swap LP
 * against a USDT loan.
 *
 * Not the obvious pick. The three slisBNB/tBNB markets have depth, but their
 * shared pool currently refuses every deposit — one-sided, other-sided and
 * balanced alike — with "Price difference for token0 exceeds threshold",
 * because the pool has drifted from its oracle. That is a state of the testnet
 * deployment, not of the SDK, and no amount of resizing gets around it.
 *
 * This pool is empty instead, which makes it usable: an empty stable-swap pool
 * takes a balanced first deposit ("Initial deposit requires all coins") and
 * this account holds both tokens. What it cannot do is borrow — its oracle
 * prices the LP at zero, so there is no collateral value to lend against. The
 * borrow-and-repay half of Smart Lending is covered on a mainnet fork instead,
 * where the pools are real; see scripts/fork-flows.mjs.
 */
const SMART_MARKET =
  "0xa1b3b1b8a72d24f03ea9346d16858d34ea2e6f327568f845bcfe518e2713cc9a";
const SMART_MARKETS_ZONE_3 = [
  "0x9f2e90b29a210b9c3382d0b59b6aac196935fc6562fbb2d5327e180e1492e61d",
  "0xd0c91960c0e525c6cd5da4f053f1a6d2ba6b16b1087c4a46872da48891877d79",
  "0x8cb7f0c2dee41fa5406ed3f160c0e988f4130a149e80e9d3848b32a45c27c060",
  SMART_MARKET,
];
/**
 * Advertised as Smart Lending by the grouped feed, but zone 6 — data the
 * backend still emits and the reference frontend drops on purpose. Their
 * collateral "provider" implements none of the SmartProvider interface.
 */
const SMART_MARKETS_ZONE_6 = [
  "0xe89ebba94398b7c5008025779b1380d8782fbbb7902035bc0a79d8f71e1b1382",
  "0xa647f3299a7e3969fd5fa52174b820a3ce19d15d50e8cdfee6227cc84b6eddce",
];

/** Balanced, because an empty stable-swap pool will not take one side. */
const SMART_SUPPLY_PER_TOKEN = 10n ** 16n; // 0.01 of each
const VAULT_DEPOSIT = 100n * 10n ** 18n; // 100 USDT
const VAULT_SHARES_TO_MINT = 10n * 10n ** 18n;

const results = [];
/** Something worth saying that is not a check. Never counted as a pass. */
const note = (text) => console.log(`  NOTE  ${text}`);

const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
};

function loadAccount() {
  const raw = process.env.TESTNET_PRIVATE_KEY?.trim();
  // Stored keys come with or without the 0x prefix, and often with a trailing
  // newline. Normalise rather than making the caller guess the format.
  const key = raw && !raw.startsWith("0x") ? `0x${raw}` : raw;
  if (!key) {
    console.error(
      "TESTNET_PRIVATE_KEY is not set.\n\n" +
        "Put it in a gitignored .env.local or a CI secret — never on the\n" +
        "command line, where it lands in shell history. Use a throwaway\n" +
        "account funded only with test tokens.",
    );
    process.exit(2);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("TESTNET_PRIVATE_KEY is not a 32-byte hex key.");
    process.exit(2);
  }
  return privateKeyToAccount(key);
}

async function main() {
  const account = loadAccount();
  if (!RPC) {
    console.error(
      "BSC_TESTNET_RPC_URL is not set. This internal harness requires the VPN-backed testnet RPC endpoint.",
    );
    process.exit(2);
  }
  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(RPC),
  });

  // Refuse anything but the testnet, before a single transaction is built.
  const chainId = await publicClient.getChainId();
  if (chainId !== CHAIN_ID) {
    console.error(
      `Refusing to run: RPC reports chain ${chainId}, expected ${CHAIN_ID}. ` +
        `This script sends transactions and must never touch mainnet.`,
    );
    process.exit(2);
  }

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`account ${account.address}`);
  console.log(`balance ${formatEther(balance)} tBNB on chain ${chainId}\n`);
  if (balance === 0n) {
    console.error(
      "Account has no tBNB. Fund it from a BSC Testnet faucet before running.",
    );
    process.exit(2);
  }

  const wallet = createWalletClient({
    account,
    chain: bscTestnet,
    transport: http(RPC),
  });
  const sdk = new MoolahSDK({ rpcUrls: { [CHAIN_ID]: RPC } });
  // Private runtime seams for this internal harness only. Public package
  // routing remains unchanged and does not advertise this deployment.
  sdk.getNetwork = () => "bscTestnet";
  sdk.getPublicClient = () => publicClient;

  /** Execute a built sequence in order, exactly as the README prescribes. */
  const run = async (steps) => {
    for (const step of steps) {
      // BSC Testnet's reported gas price sits low enough that transactions sit
      // in the mempool unmined and block the account's nonce. Bid above it.
      const base = await publicClient.getGasPrice();
      const gasPrice = base > 3_000_000_000n ? base : 3_000_000_000n;
      // Estimate, then send with headroom. The estimate is taken at the
      // current block and the transaction lands in the next one, by which time
      // interest has accrued and the call may touch more state — sending at
      // the bare estimate runs out of gas and reverts with no reason at all,
      // which reads exactly like a bad call. Seen here on
      // convertDynamicToFixed, and on a vault withdrawal on the fork.
      const gas = await publicClient.estimateGas({
        account: account.address,
        to: step.params.to,
        data: step.params.data,
        value: step.params.value,
      });
      const hash = await wallet.sendTransaction({
        to: step.params.to,
        data: step.params.data,
        value: step.params.value,
        gas: (gas * 3n) / 2n,
        gasPrice,
      });
      // Testnet blocks can be slow and the default 180s is not always enough.
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 300_000,
        pollingInterval: 2_000,
        retryCount: 10,
      });
      if (receipt.status !== "success") {
        // Replay the call to recover the reason. A receipt carries only
        // `status: reverted`; the error data lives in the call, and now that
        // the ABIs carry their custom errors viem can name it. Printing the
        // transaction hash alone left the next person to go and look it up.
        const reason = await publicClient
          .call({
            account: account.address,
            to: step.params.to,
            data: step.params.data,
            value: step.params.value,
          })
          .then(() => "no reason on replay")
          .catch((e) => String(e.shortMessage ?? e.message).split("\n")[0]);
        throw new Error(
          `step ${step.index} (${step.step}) reverted: ${reason} (${hash})`,
        );
      }
    }
  };

  const SECTIONS = ["fixed-term", "vault", "smart"];
  const only = parseOnly(process.argv, SECTIONS);
  const shouldRun = (name) => !only || only === name;

  // ---- fixed-term lifecycle -------------------------------------------------
  // Bootstraps its own position rather than assuming one exists, so the run is
  // repeatable and a skip means something is actually wrong.
  // Hoisted out of the section so the reversal below can see it. The lend is
  // unconditional once there is a shortfall; the withdraw used to sit two
  // levels deeper, inside the debt-is-clear branch, so any revert between them
  // — or a run that ended with debt remaining — left the liquidity supplied and
  // unrecorded.
  let lentShortfall = 0n;
  if (shouldRun("fixed-term")) {
    console.log("fixed-term lifecycle");
    try {
      const { id: marketId, broker } = FIXED_TERM_MARKET;

      const terms = await sdk.getBrokerFixedTerms(CHAIN_ID, broker);
      record(
        "broker exposes fixed terms",
        terms.length > 0,
        terms.map((t) => `${t.durationSeconds}s`).join(", "),
      );

      const debtOf = () =>
        publicClient.readContract({
          address: broker,
          abi: LENDING_BROKER_ABI,
          functionName: "getUserTotalDebt",
          args: [account.address],
        });

      // 1. collateral
      //
      // Approve with headroom first. buildApproveSteps skips the approval when
      // the standing allowance merely *equals* the amount, and a provider that
      // pulls even slightly more then reverts with "insufficient allowance".
      // An integrator hitting that boundary has no signal from the step list.
      await run(
        await sdk.buildApproveParams({
          chainId: CHAIN_ID,
          owner: account.address,
          token: FIXED_TERM_MARKET.collateralToken,
          spender: (await sdk.getWriteConfig(CHAIN_ID, marketId))
            .collateralProvider,
          amount: COLLATERAL_TO_SUPPLY * 10n,
        }),
      );
      const beforeSupply = await sdk.getMarketUserData(
        CHAIN_ID,
        marketId,
        account.address,
      );
      await run(
        await sdk.buildSupplyParams({
          chainId: CHAIN_ID,
          marketId,
          assets: COLLATERAL_TO_SUPPLY,
          walletAddress: account.address,
        }),
      );
      const afterSupply = await sdk.getMarketUserData(
        CHAIN_ID,
        marketId,
        account.address,
      );
      record(
        "supplying collateral lands on-chain",
        // A delta, not a total. An earlier run that failed part-way leaves
        // collateral behind, and `total >= requested` would then pass on that
        // alone — a supply that went nowhere reported as a success.
        afterSupply.collateral.numerator - beforeSupply.collateral.numerator ===
          COLLATERAL_TO_SUPPLY,
        `+${afterSupply.collateral.numerator - beforeSupply.collateral.numerator} wei`,
      );

      // 2. borrow against the flexible leg
      //
      // First make sure there is anything to borrow. This market is shared with
      // whoever else is using the testnet, and it is routinely drained to zero —
      // a run that fails with `insufficient liquidity` is reporting someone
      // else's state, not a defect here. Lend the shortfall in, and take it back
      // out in the cleanup so the account ends where it started.
      const extraInfo = await sdk.getMarketExtraInfo(CHAIN_ID, marketId);
      const shortfall =
        extraInfo.remaining.numerator >= AMOUNT_TO_BORROW
          ? 0n
          : AMOUNT_TO_BORROW - extraInfo.remaining.numerator + AMOUNT_TO_BORROW;
      if (shortfall > 0n) {
        note(
          `market has ${extraInfo.remaining.numerator} borrowable, need ` +
            `${AMOUNT_TO_BORROW} — lending ${shortfall} in first`,
        );
        await run(
          await sdk.buildMoolahSupplyParams({
            chainId: CHAIN_ID,
            marketId,
            assets: shortfall,
            walletAddress: account.address,
          }),
        );
        // Only recorded for cleanup once the lend actually landed — setting
        // it beforehand meant a failed supply still told `finally` to
        // withdraw liquidity that was never there, and that withdraw's own
        // failure replaced the real one in the report.
        lentShortfall = shortfall;
      }

      const debtBefore = await debtOf();
      await run(
        await sdk.buildBrokerBorrowParams({
          chainId: CHAIN_ID,
          brokerAddress: broker,
          amount: AMOUNT_TO_BORROW,
        }),
      );
      const debtAfterBorrow = await debtOf();
      record(
        "flexible-leg borrow increases total debt",
        debtAfterBorrow > debtBefore,
        `${debtBefore} -> ${debtAfterBorrow}`,
      );

      const before = await sdk.getBrokerUserPositions(
        CHAIN_ID,
        broker,
        account.address,
      );
      record(
        "the flexible leg is visible in the SDK's position read",
        (before.dynamicOutstanding?.numerator ?? 0n) > 0n,
        `dynamic ${before.dynamicOutstanding?.toString() ?? "0"}`,
      );

      // 3. move the whole flexible leg into the shortest term
      //
      // Deliberately all of it: a conversion leaves two legs and the market
      // rejects either below its minimum loan, so splitting a position sized
      // near the minimum reverts with broker/positions-below-min-loan.
      const shortest = terms.reduce((a, b) =>
        a.durationSeconds < b.durationSeconds ? a : b,
      );
      // The principal, not `dynamicOutstanding`. The latter is principal plus
      // accrued interest, and the conversion is denominated in principal — so
      // passing it asks to convert slightly more than exists and reverts,
      // intermittently, depending on how far the contract's own accrual has
      // caught up. A flaky harness for the same reason an integrator's flow
      // would be flaky.
      await run(
        await sdk.buildConvertDynamicToFixedParams({
          chainId: CHAIN_ID,
          brokerAddress: broker,
          amount: before.dynamicPosition.principal,
          termId: shortest.termId,
        }),
      );

      const after = await sdk.getBrokerUserPositions(
        CHAIN_ID,
        broker,
        account.address,
      );

      // The strongest assertion available: the SDK's own accounting against the
      // contract's. Matured positions still owe, and excluding them used to
      // understate this figure by the whole matured balance — 22% on this very
      // account. A small positive drift is the intentional repayment buffer.
      const contractDebt = await debtOf();
      const sdkDebt = after.totalOutstanding.numerator;
      const drift =
        sdkDebt > contractDebt
          ? sdkDebt - contractDebt
          : contractDebt - sdkDebt;
      record(
        "SDK total debt agrees with the contract",
        // Inverted deliberately: zero contract debt with a non-zero SDK figure
        // is precisely the accounting bug this exists to catch, and
        // `contractDebt === 0n || ...` would have waved it through.
        contractDebt === 0n
          ? sdkDebt === 0n
          : (drift * 10_000n) / contractDebt < 10n,
        `contract ${contractDebt}, sdk ${sdkDebt}, drift ${drift}`,
      );

      record(
        "convertDynamicToFixed grows the fixed leg",
        after.fixedOutstanding.numerator > before.fixedOutstanding.numerator,
        `${before.fixedOutstanding.toString()} -> ${after.fixedOutstanding.toString()}`,
      );
      record(
        "convertDynamicToFixed shrinks the flexible leg",
        (after.dynamicOutstanding?.numerator ?? 0n) <
          (before.dynamicOutstanding?.numerator ?? 0n),
        `${before.dynamicOutstanding?.toString() ?? "0"} -> ${after.dynamicOutstanding?.toString() ?? "0"}`,
      );

      // 3b. let the term mature, then roll it
      //
      // Off by default: the shortest term on this broker is 600 seconds, and a
      // harness that sleeps ten minutes is a harness nobody runs. With --slow it
      // is the only state-changing evidence there is for refinancing — the
      // alternative to rolling a matured position is repaying and re-borrowing
      // it, so this is part of the fixed-term lifecycle rather than a nicety.
      const maturing = after.fixedPositions.find(
        (p) => p.principal > p.principalRepaid,
      );
      if (process.argv.includes("--slow") && !maturing) {
        // Reported rather than thrown: a crash here would read as a harness bug
        // rather than what it is — the conversion left no position to roll. And
        // reported rather than returned, so the sections after this one still run.
        record("refinancing a matured position", false, "no open fixed leg");
      } else if (process.argv.includes("--slow")) {
        const now = () => BigInt(Math.floor(Date.now() / 1000));
        const waitFor = maturing.end > now() ? maturing.end - now() + 5n : 0n;
        if (waitFor > 0n) {
          console.log(
            `  ...waiting ${waitFor}s for term ${maturing.posId} to mature`,
          );
          await new Promise((r) => setTimeout(r, Number(waitFor) * 1000));
        }
        const debtBeforeRoll = await debtOf();
        await run(
          await sdk.buildBrokerRefinanceMaturedParams({
            chainId: CHAIN_ID,
            brokerAddress: broker,
            user: account.address,
            positionIds: [maturing.posId],
          }),
        );

        const rolled = await sdk.getBrokerUserPositions(
          CHAIN_ID,
          broker,
          account.address,
        );
        const openLegs = rolled.fixedPositions.filter(
          (p) => p.principal > p.principalRepaid,
        );
        const stillMatured = openLegs.filter((p) => p.end <= now());
        const debtAfterRoll = await debtOf();
        const drift =
          debtAfterRoll > debtBeforeRoll
            ? debtAfterRoll - debtBeforeRoll
            : debtBeforeRoll - debtAfterRoll;

        // The claim that holds whichever leg the debt lands on: the matured term
        // is gone and the debt is not. Asserting "a new fixed term appeared"
        // would have been asserting a guess — this broker moves the balance back
        // to the flexible leg rather than opening a fresh term, which is a fact
        // about the deployment and not something the ABI says.
        record(
          "refinancing clears the matured term without losing the debt",
          stillMatured.length === 0 &&
            debtAfterRoll > 0n &&
            (drift * 100n) / debtBeforeRoll < 1n,
          `debt ${debtBeforeRoll} -> ${debtAfterRoll}; ` +
            `fixed legs ${openLegs.length} (${openLegs.map((p) => p.posId).join(",") || "none"}), ` +
            `flexible ${rolled.dynamicOutstanding?.numerator ?? 0n}`,
        );
      } else {
        note(
          "refinancing a matured position is skipped: the shortest term here is " +
            "600s. Run with --slow to wait it out and exercise it.",
        );
      }

      // 4. settle everything and clean up after ourselves
      //
      // repayAll is absent from this broker's deployed implementation — the
      // testnet runs an older build than mainnet, which the ABI conformance job
      // records as a known-absent selector. Rather than failing opaquely, detect
      // it and fall back to per-position repayment so the run still cleans up.
      const debtToClear = await debtOf();
      const brokerCode = await publicClient.getCode({ address: broker });
      const implSlot = await publicClient.getStorageAt({
        address: broker,
        slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      });
      const impl =
        implSlot && BigInt(implSlot) !== 0n
          ? `0x${implSlot.slice(-40)}`
          : broker;
      const implCode = await publicClient.getCode({ address: impl });
      // Derived from the ABI, not a literal: a hardcoded selector that drifts
      // out of date would silently route every run down the fallback branch.
      const repayAllSelector = toFunctionSelector(
        "function repayAll(address)",
      ).slice(2);
      const hasRepayAll = (implCode ?? brokerCode ?? "").includes(
        repayAllSelector,
      );

      if (hasRepayAll) {
        await run(
          await sdk.buildBrokerRepayAllParams({
            chainId: CHAIN_ID,
            brokerAddress: broker,
            onBehalf: account.address,
            maxRepayAmount: (debtToClear * 12n) / 10n,
            loanToken: FIXED_TERM_MARKET.loanToken,
            walletAddress: account.address,
          }),
        );
        record("repayAll clears every leg", (await debtOf()) === 0n);
      } else {
        // A note, not a PASS. This broker does not have `repayAll`, so nothing
        // about it was tested here; recording it as passing would have counted a
        // permanent absence as evidence on every single run. The mainnet broker
        // does have it, and fork-flows exercises it there.
        note(
          "repayAll is not on this broker (older testnet build) — falling back " +
            "to per-position repay. The mainnet broker has it; see " +
            "scripts/fork-flows.mjs --only broker.",
        );
        // Repay each leg. Two things bite here, and both were found by running
        // this, not by reading the ABI.
        //
        // `posId` is the position's own id, not its index in this array. On this
        // account the ids ran 5, 7, 8, 9, 10 against indices 0..4, so the index
        // form reverts with PositionNotFound() — which before this release
        // surfaced as a bare `0x6ec9be11`, the ABI carrying no custom errors for
        // viem to decode against.
        //
        // And the amount must carry headroom. Quoting the exact settlement figure
        // from `previewRepayFixedLoanPosition` and passing it back looks precise
        // and is wrong: interest accrues between the quote and inclusion, so the
        // repay falls a few wei short of the principal and the position is left
        // below the market minimum — `remain borrow too low`. Measured on chain:
        // repaying a 20.000000061 leg with a 40.0 amount moved exactly
        // 20.000002877 and cleared the position, so the broker pulls only what is
        // owed and the headroom costs nothing.
        const { fixedPositions: legs } = await sdk.getBrokerUserPositions(
          CHAIN_ID,
          broker,
          account.address,
        );
        for (const leg of legs) {
          const owed = leg.principal - leg.principalRepaid;
          if (owed <= 0n) continue;
          await run(
            await sdk.buildBrokerRepayParams({
              chainId: CHAIN_ID,
              brokerAddress: broker,
              amount: owed * 2n,
              posId: leg.posId,
              onBehalf: account.address,
              loanToken: FIXED_TERM_MARKET.loanToken,
              walletAddress: account.address,
            }),
          );
        }

        // Whatever sits on the flexible leg settles through the two-argument
        // `repay`, which takes no position id at all.
        const stillDynamic = (
          await sdk.getBrokerUserPositions(CHAIN_ID, broker, account.address)
        ).dynamicOutstanding;
        if (stillDynamic && stillDynamic.numerator > 0n) {
          await run(
            await sdk.buildBrokerRepayParams({
              chainId: CHAIN_ID,
              brokerAddress: broker,
              amount: stillDynamic.numerator * 2n,
              onBehalf: account.address,
              loanToken: FIXED_TERM_MARKET.loanToken,
              walletAddress: account.address,
            }),
          );
        }

        const left = await debtOf();
        record(
          "per-position repay clears the debt",
          left === 0n,
          `${debtToClear} -> ${left}`,
        );
      }

      // 5. take the collateral back out, if the remaining debt allows it
      if ((await debtOf()) === 0n) {
        await run(
          await sdk.buildWithdrawParams({
            chainId: CHAIN_ID,
            marketId,
            assets: COLLATERAL_TO_SUPPLY,
            walletAddress: account.address,
          }),
        );
        const afterWithdraw = await sdk.getMarketUserData(
          CHAIN_ID,
          marketId,
          account.address,
        );
        record(
          "collateral comes back out once the debt is clear",
          afterWithdraw.collateral.numerator < afterSupply.collateral.numerator,
          `${afterSupply.collateral.numerator} -> ${afterWithdraw.collateral.numerator}`,
        );
      } else {
        note(
          "collateral withdrawal skipped: debt remains, so the collateral is " +
            "still backing it. Not a pass — nothing was exercised.",
        );
      }
    } finally {
      // Reached wherever the lend happened — a revert in the middle of the
      // lifecycle used to leave it supplied, and so did a run that ended with
      // debt remaining, because the withdraw sat inside the debt-is-clear
      // branch. The account has to end where it started on every path.
      //
      // Wrapped the same way the vault and Smart sections wrap theirs: an
      // exception thrown inside a `finally` replaces the one that sent us
      // here, so a failed cleanup withdraw would erase the actual failure.
      try {
        if (lentShortfall > 0n) {
          await run(
            await sdk.buildMoolahWithdrawParams({
              chainId: CHAIN_ID,
              marketId: FIXED_TERM_MARKET.id,
              assets: lentShortfall,
              walletAddress: account.address,
            }),
          );
        }
      } catch (e) {
        note(
          `could not unwind the shortfall this run lent in: ${String(e?.message ?? e).slice(0, 160)}`,
        );
      }
    }
  }

  // ---- vault lifecycle ------------------------------------------------------
  // deposit and mint are the two entry points, withdraw and redeem the two
  // exits. mint is the one this release added, and the one a stale approval
  // quietly breaks.
  if (shouldRun("vault")) {
    console.log("\nvault lifecycle");
    const vaultInfo = await sdk.getVaultInfo(CHAIN_ID, VAULT);
    const asset = vaultInfo.assetInfo.address;
    const balanceOfAsset = () =>
      publicClient.readContract({
        address: asset,
        abi: [
          {
            inputs: [{ name: "", type: "address" }],
            name: "balanceOf",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function",
          },
        ],
        functionName: "balanceOf",
        args: [account.address],
      });
    const sharesOf = async () =>
      (await sdk.getVaultUserData(CHAIN_ID, VAULT, account.address)).shares
        .numerator;

    const sharesStart = await sharesOf();
    const assetsBefore = await balanceOfAsset();
    // Everything from here on has put shares in the vault. A revert, a builder
    // error or an RPC failure between the deposit and the redeem below would
    // otherwise walk away leaving them there — the harness spends real testnet
    // funds, so an abandoned position is a defect and not just untidiness.
    try {
      await run(
        await sdk.buildVaultDepositParams({
          chainId: CHAIN_ID,
          vaultAddress: VAULT,
          assets: VAULT_DEPOSIT,
          walletAddress: account.address,
        }),
      );
      const sharesAfterDeposit = await sharesOf();
      record(
        "deposit converts assets into shares",
        sharesAfterDeposit > sharesStart &&
          (await balanceOfAsset()) === assetsBefore - VAULT_DEPOSIT,
        `+${sharesAfterDeposit - sharesStart} shares for ${VAULT_DEPOSIT}`,
      );

      // The approval here is sized from previewMint plus headroom. An exact quote
      // goes stale the moment a block is mined — the vault reprices and `mint`
      // reverts with `ERC20: insufficient allowance`.
      await run(
        await sdk.buildVaultMintParams({
          chainId: CHAIN_ID,
          vaultAddress: VAULT,
          shares: VAULT_SHARES_TO_MINT,
          walletAddress: account.address,
          vaultInfo,
        }),
      );
      const sharesAfterMint = await sharesOf();
      record(
        "mint credits exactly the shares asked for",
        sharesAfterMint - sharesAfterDeposit === VAULT_SHARES_TO_MINT,
        `+${sharesAfterMint - sharesAfterDeposit}`,
      );

      // A vault is only as liquid as the markets underneath it, so bound the
      // request by maxWithdraw rather than testing today's utilisation.
      const maxWithdraw = await publicClient.readContract({
        address: VAULT,
        abi: MOOLAH_VAULT_ABI,
        functionName: "maxWithdraw",
        args: [account.address],
      });
      const half = VAULT_DEPOSIT / 2n;
      const toWithdraw = maxWithdraw < half ? maxWithdraw : half;
      const beforeWithdraw = await balanceOfAsset();
      await run(
        await sdk.buildVaultWithdrawParams({
          chainId: CHAIN_ID,
          vaultAddress: VAULT,
          assets: toWithdraw,
          walletAddress: account.address,
        }),
      );
      record(
        "withdraw returns the stated asset amount",
        (await balanceOfAsset()) - beforeWithdraw === toWithdraw,
        `+${toWithdraw} (maxWithdraw ${maxWithdraw})`,
      );

      // Give back whatever this run added, so the account does not drift.
      const maxRedeem = await publicClient.readContract({
        address: VAULT,
        abi: MOOLAH_VAULT_ABI,
        functionName: "maxRedeem",
        args: [account.address],
      });
      const held = await sharesOf();
      const toRedeem = held - sharesStart;
      const redeemable = maxRedeem < toRedeem ? maxRedeem : toRedeem;
      if (redeemable === 0n) {
        // `redeem(0)` settles nothing, so `held - after === redeemable` would be
        // `0n === 0n` — a PASS over a transaction that was never sent.
        record(
          "share-denominated redeem burns exactly the shares given",
          false,
          "nothing redeemable at this block, so nothing was exercised",
        );
      } else {
        await run(
          await sdk.buildVaultWithdrawParams({
            chainId: CHAIN_ID,
            vaultAddress: VAULT,
            shares: redeemable,
            walletAddress: account.address,
          }),
        );
        record(
          "share-denominated redeem burns exactly the shares given",
          held - (await sharesOf()) === redeemable,
          `redeemed ${redeemable} of ${toRedeem} added this run`,
        );
      }
    } finally {
      // Whatever this run still holds, not "did the block above finish". A
      // redeem capped by `maxRedeem` completes the try block and still leaves
      // shares behind, so a flag saying "we got to the end" is not the same
      // question as "is anything stranded" — ask the balance.
      //
      // The whole thing is wrapped, and the wrap is the point: an exception
      // thrown inside a `finally` replaces the one that sent us here, so a
      // failed cleanup would erase the actual failure from the report.
      try {
        const stranded = (await sharesOf()) - sharesStart;
        if (stranded > 0n) {
          await run(
            await sdk.buildVaultWithdrawParams({
              chainId: CHAIN_ID,
              vaultAddress: VAULT,
              shares: stranded,
              walletAddress: account.address,
            }),
          );
          note(`unwound ${stranded} vault shares left over from this run`);
        }
      } catch (e) {
        note(
          `could not unwind this run's vault shares: ${String(e?.message ?? e).slice(0, 160)}`,
        );
      }
    }
  }

  // ---- Smart Lending lifecycle ---------------------------------------------
  if (shouldRun("smart")) {
    console.log("\nSmart Lending lifecycle");

    // Read every market first. One of the four points at a FixedRateIrm
    // deployment in neither address-book slot; before this release that made
    // the whole read revert, so this assertion is the fix, not decoration.
    const readable = [];
    for (const id of SMART_MARKETS_ZONE_3) {
      const cfg = await sdk
        .getSmartMarketExtraInfo(CHAIN_ID, id)
        .catch(() => null);
      if (cfg) readable.push({ id, cfg });
    }
    record(
      "every zone-3 Smart Lending market reads",
      readable.length === SMART_MARKETS_ZONE_3.length,
      `${readable.length}/${SMART_MARKETS_ZONE_3.length}, ` +
        `${readable.filter((m) => m.cfg.isFixedRate).length} of them fixed-rate`,
    );

    // And the two the backend mislabels are refused with an explanation rather
    // than a bare "the contract function token reverted".
    const refusals = await Promise.all(
      SMART_MARKETS_ZONE_6.map((id) =>
        sdk
          .getSmartMarketExtraInfo(CHAIN_ID, id)
          .then(() => null)
          .catch((e) => String(e.message)),
      ),
    );
    record(
      "zone-6 markets are refused with a reason, not a revert",
      refusals.every((r) => r && /is not a Smart Lending market/.test(r)),
      refusals[0]?.slice(0, 60) ?? "",
    );

    const cfg = await sdk.getSmartMarketExtraInfo(CHAIN_ID, SMART_MARKET);
    const userData = () =>
      sdk.getSmartMarketUserData(CHAIN_ID, SMART_MARKET, account.address);
    const erc20BalanceOf = (token) =>
      publicClient.readContract({
        address: token,
        abi: [
          {
            inputs: [{ name: "", type: "address" }],
            name: "balanceOf",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function",
          },
        ],
        functionName: "balanceOf",
        args: [account.address],
      });

    const before = await userData();
    // As with the vault: from the supply below until the pair comes back out,
    // a failure would leave LP collateral in the position.
    try {
      await run(
        await sdk.buildSmartSupplyCollateralParams({
          chainId: CHAIN_ID,
          marketId: SMART_MARKET,
          tokenAAmount: SMART_SUPPLY_PER_TOKEN,
          tokenBAmount: SMART_SUPPLY_PER_TOKEN,
          minLpAmount: 0n,
          walletAddress: account.address,
          smartConfig: cfg,
        }),
      );
      const supplied = await userData();
      const minted =
        supplied.collateral.numerator - before.collateral.numerator;
      record(
        "supplying the pair mints LP collateral",
        minted > 0n,
        // Raw units: the LP is worth a fraction of one token here, and the
        // rounded display reads "0 -> 0" while the position really moved.
        `${before.collateral.numerator} -> ${supplied.collateral.numerator} LP wei ` +
          `for 0.01 ${cfg.tokenAInfo.symbol} + 0.01 ${cfg.tokenBInfo.symbol}`,
      );

      // The flow this release added: leave with one of the pair rather than both.
      // The caller absorbs the pool's imbalance cost, so the payout is bounded
      // below, not equal — which is exactly why `minTokenAmount` exists.
      const tokenBBefore = await erc20BalanceOf(cfg.tokenBInfo.address);
      const burn = minted / 4n;
      await run(
        await sdk.buildSmartWithdrawCollateralOneCoinParams({
          chainId: CHAIN_ID,
          marketId: SMART_MARKET,
          collateralAmount: burn,
          tokenIndex: 1,
          minTokenAmount: 0n,
          walletAddress: account.address,
          smartConfig: cfg,
        }),
      );
      const received =
        (await erc20BalanceOf(cfg.tokenBInfo.address)) - tokenBBefore;
      const afterOneCoin = await userData();
      record(
        "one-coin withdrawal pays out in the chosen token only",
        received > 0n &&
          afterOneCoin.collateral.numerator ===
            supplied.collateral.numerator - burn,
        `+${received} ${cfg.tokenBInfo.symbol} wei, collateral ` +
          `${supplied.collateral.numerator} -> ${afterOneCoin.collateral.numerator}`,
      );

      // Take the rest back out, so the account is left as it was found.
      const remaining =
        afterOneCoin.collateral.numerator - before.collateral.numerator;
      if (remaining > 0n) {
        await run(
          await sdk.buildSmartWithdrawCollateralFixedParams({
            chainId: CHAIN_ID,
            marketId: SMART_MARKET,
            lpAmount: remaining,
            minTokenAAmount: 0n,
            minTokenBAmount: 0n,
            walletAddress: account.address,
            smartConfig: cfg,
          }),
        );
      }
      record(
        "the pair comes back out, leaving the position as it was found",
        (await userData()).collateral.numerator === before.collateral.numerator,
        `collateral back to ${(await userData()).collateral.numerator}`,
      );
    } finally {
      // As in the vault lifecycle: ask the position what it still holds rather
      // than asking a flag whether the block finished, and never let a failing
      // cleanup throw over the failure that caused it.
      try {
        const stranded =
          (await userData()).collateral.numerator - before.collateral.numerator;
        if (stranded > 0n) {
          await run(
            await sdk.buildSmartWithdrawCollateralFixedParams({
              chainId: CHAIN_ID,
              marketId: SMART_MARKET,
              lpAmount: stranded,
              minTokenAAmount: 0n,
              minTokenBAmount: 0n,
              walletAddress: account.address,
              smartConfig: cfg,
            }),
          );
          note(`unwound ${stranded} LP wei left over from this run`);
        }
      } catch (e) {
        note(
          `could not unwind this run's LP collateral: ${String(e?.message ?? e).slice(0, 160)}`,
        );
      }
    }

    note(
      "borrow and repay against LP collateral run on a mainnet fork, not here: " +
        "this market's oracle prices the LP at zero, and the pools that are " +
        "priced refuse deposits. See scripts/fork-flows.mjs --only smart.",
    );
  }

  if (results.length === 0) {
    console.log("\nFAILED — no testnet checks ran at all");
    process.exit(1);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length === 0
      ? `\nOK — ${results.length} testnet checks passed`
      : `\nFAILED — ${failed.length}/${results.length}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  // Never let a key reach the log, even inside an error from a signer.
  console.error(String(err?.shortMessage ?? err?.message ?? err));
  process.exit(1);
});
