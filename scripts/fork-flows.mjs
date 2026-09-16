#!/usr/bin/env node
/**
 * State-changing verification, on a BSC mainnet fork, for the flows a testnet
 * cannot host.
 *
 * The testnet harness covers fixed-term lending end to end. Three surfaces stay
 * out of its reach:
 *
 *   - Liquidation needs a position that is actually unhealthy. No testnet hands
 *     you one on demand, and waiting for one is not a test.
 *   - Smart Lending needs a real stable-swap pool with real depth; a fresh
 *     testnet pool prices nothing meaningful.
 *   - The vaults need real deposits before a share price means anything.
 *
 * A fork gives all three against the actually-deployed contracts, and lets the
 * harness move state that mainnet would never let it move — halving a
 * borrower's collateral is how a liquidation gets tested at all.
 *
 * Requires anvil (foundry). Starts and stops its own fork.
 *
 *   BSC_RPC_URL=...   optional upstream; falls back to a public node
 *
 * Usage: node scripts/fork-flows.mjs [--only vault|smart|liquidation]
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  pad,
  toHex,
  formatUnits,
} from "viem";
import { bsc } from "viem/chains";
import { MoolahSDK } from "@lista-dao/moolah-lending-sdk";
import {
  LENDING_BROKER_ABI,
  MOOLAH_ABI,
  MOOLAH_VAULT_ABI,
  getContractAddress,
  positionHealthFactor,
} from "@lista-dao/moolah-sdk-core";
import { FLASH_RECEIVER_RUNTIME } from "./fixtures/flashReceiverBytecode.mjs";

/** Just the forwarder; see scripts/fixtures/FlashReceiver.sol. */
const FLASH_RECEIVER_ABI = [
  {
    inputs: [
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
    ],
    name: "execute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
import {
  withAnvil,
  raw,
  fundToken,
  grantRoleOnFork,
  parseOnly,
  recorder,
  reportAndExit,
  DEFAULT_UPSTREAM,
  redactUrl,
} from "./lib/fork.mjs";

const CHAIN = 56;

/** Gauntlet x Lista DAO U Vault — the largest vault on the U market. */
const VAULT = "0x9a17fd5cb8efc25d11567e713ae795a89775a759";

/**
 * A live Smart Lending market: USDT/USDC stable-swap LP as collateral against
 * a U loan, at 96.5% LLTV. Its SmartProvider is what makes single-sided supply
 * and single-coin withdrawal possible at all.
 */
const SMART_MARKET =
  "0x7942468d613d1d781e16fe1a3d5e357a586f02190aba261b7e4140ac9c699f94";

/** A plain variable-rate market: sUSDe collateral, USDT loan, 91.5% LLTV. */
const MARKET =
  "0x8a1fffce64f5b29d59e7ebfd7a927e29acdb932cc73508c9861157eeef9b8e1a";

/**
 * The BSC fixed-term broker and the market it serves. Unlike the testnet
 * broker this one has `repayAll` deployed, which is the only place that call
 * can be exercised at all.
 */
const BROKER = "0xca5929b8ff8b1a4b9b8d77dfc5340977bfa425b3";
const BROKER_MARKET =
  "0x212d0a36fccb86ff79994d6094271c21149c6a65e97e5ed797429ee56f44ce64";

/** Where the flash-loan counterparty is installed on the fork. */
const FLASH_RECEIVER = "0x00000000000000000000000000000000f1a54100";

const { results, record } = recorder();

const SECTIONS = ["vault", "market", "broker", "smart", "dexlp", "liquidation"];
const only = parseOnly(process.argv, SECTIONS);
const shouldRun = (name) => !only || only === name;

async function main() {
  console.log(`forking BSC from ${redactUrl(DEFAULT_UPSTREAM)} ...\n`);

  await withAnvil(async (rpcUrl) => {
    // A fork-cache miss can take many seconds upstream; viem's 10s default
    // turns that into a timeout that looks like a contract failure.
    const publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrl, { timeout: 180_000 }),
    });
    const [account] = await publicClient.request({ method: "eth_accounts" });
    const wallet = createWalletClient({
      account,
      chain: bsc,
      transport: http(rpcUrl, { timeout: 180_000 }),
    });
    const sdk = new MoolahSDK({
      rpcUrls: { [CHAIN]: rpcUrl },
      transport: { timeout: 180_000, retryCount: 3 },
    });

    /** Execute a built sequence in order, exactly as the README prescribes. */
    const run = async (steps) => {
      for (const step of steps) {
        // Estimate, then send with headroom. A vault withdrawal walks the
        // withdraw queue and touches however many markets it needs to cover the
        // request, and interest accrues between the estimate and the next block
        // — so the cost is not stable across one block boundary. Sending at the
        // bare estimate runs out of gas and reverts with no reason at all,
        // which reads exactly like a bad call.
        const gas = await publicClient.estimateGas({
          account,
          to: step.params.to,
          data: step.params.data,
          value: step.params.value,
        });
        const hash = await wallet.sendTransaction({
          to: step.params.to,
          data: step.params.data,
          value: step.params.value,
          gas: (gas * 3n) / 2n,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          // Replay the call to recover the reason. A receipt carries only
          // `status: reverted`; the error data lives in the call, and now that
          // the ABIs carry their custom errors viem can name it.
          const reason = await publicClient
            .call({
              account,
              to: step.params.to,
              data: step.params.data,
              value: step.params.value,
            })
            .then(() => `no reason on replay; gasUsed ${receipt.gasUsed}, data ${step.params.data.slice(0, 10)}`)
            .catch((e) => String(e.shortMessage ?? e.message).split("\n")[0]);
          throw new Error(`step ${step.index} (${step.step}) reverted: ${reason}`);
        }
      }
    };

    const balanceOf = (token, who = account) =>
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [who],
      });

    const ctx = { sdk, publicClient, rpcUrl, account, run, balanceOf, wallet };
    if (shouldRun("vault")) await vaultFlow(ctx);
    if (shouldRun("market")) await marketFlow(ctx);
    if (shouldRun("broker")) await brokerFlow(ctx);
    if (shouldRun("dexlp")) await dexLpFlow(ctx);
    if (shouldRun("smart")) await smartFlow(ctx);
    if (shouldRun("liquidation")) await liquidationFlow(ctx);
  });

  reportAndExit(results, "fork flow checks");
}

// ---- ERC-4626 vault: deposit, mint, withdraw, redeem -----------------------

async function vaultFlow({ sdk, publicClient, rpcUrl, account, run, balanceOf }) {
  console.log("vault lifecycle");
  const info = await sdk.getVaultInfo(CHAIN, VAULT);
  const asset = info.assetInfo?.address ?? info.asset;
  const decimals = info.assetInfo?.decimals ?? 18;
  const unit = 10n ** BigInt(decimals);

  const funding = await fundToken(rpcUrl, publicClient, asset, account, 10_000n * unit);
  record(
    "harness can fund itself with the vault asset",
    (await balanceOf(asset)) >= 10_000n * unit,
    `${info.assetInfo?.symbol ?? "asset"} 10000 via ${funding}`,
  );

  const sharesOf = async () =>
    (await sdk.getVaultUserData(CHAIN, VAULT, account)).shares.numerator;

  // deposit: assets in, shares out
  const assetsBefore = await balanceOf(asset);
  await run(
    await sdk.buildVaultDepositParams({
      chainId: CHAIN,
      vaultAddress: VAULT,
      assets: 1_000n * unit,
      walletAddress: account,
    }),
  );
  const sharesAfterDeposit = await sharesOf();
  record(
    "deposit converts assets into shares",
    sharesAfterDeposit > 0n && (await balanceOf(asset)) === assetsBefore - 1_000n * unit,
    `shares ${formatUnits(sharesAfterDeposit, decimals)}`,
  );

  // mint: shares in, assets out — the inverse entry point, and the one that
  // was missing from this SDK entirely before this release.
  const toMint = 100n * unit;
  const assetsBeforeMint = await balanceOf(asset);
  await run(
    await sdk.buildVaultMintParams({
      chainId: CHAIN,
      vaultAddress: VAULT,
      shares: toMint,
      walletAddress: account,
    }),
  );
  const sharesAfterMint = await sharesOf();
  record(
    "mint credits exactly the shares asked for",
    sharesAfterMint - sharesAfterDeposit === toMint,
    `+${formatUnits(sharesAfterMint - sharesAfterDeposit, decimals)} shares for ` +
      `${formatUnits(assetsBeforeMint - (await balanceOf(asset)), decimals)} assets`,
  );

  // withdraw a stated asset amount
  //
  // A Moolah vault is only as liquid as the markets underneath it: `withdraw`
  // pulls from the withdraw queue, and anything already lent out is not
  // available. So bound the request by `maxWithdraw` — an unbounded request is
  // not a stronger test, it is just a test of the vault's utilisation on the
  // day it ran.
  const maxWithdraw = await publicClient.readContract({
    address: VAULT,
    abi: MOOLAH_VAULT_ABI,
    functionName: "maxWithdraw",
    args: [account],
  });
  const toWithdraw = maxWithdraw < 500n * unit ? maxWithdraw : 500n * unit;
  if (toWithdraw === 0n) {
    // `withdraw(0)` succeeds and moves nothing, so `after - before === 0n`
    // would record a PASS having tested nothing at all. "We could not test it"
    // and "it worked" must not look the same.
    record(
      "withdraw returns the stated asset amount",
      false,
      "the vault had no free liquidity at this block, so nothing was exercised",
    );
  } else {
    const assetsBeforeWithdraw = await balanceOf(asset);
    await run(
      await sdk.buildVaultWithdrawParams({
        chainId: CHAIN,
        vaultAddress: VAULT,
        assets: toWithdraw,
        walletAddress: account,
      }),
    );
    record(
      "withdraw returns the stated asset amount",
      (await balanceOf(asset)) - assetsBeforeWithdraw === toWithdraw,
      `+${formatUnits((await balanceOf(asset)) - assetsBeforeWithdraw, decimals)} ` +
        `(maxWithdraw ${formatUnits(maxWithdraw, decimals)})`,
    );
  }

  // redeem everything — the share-denominated exit
  const maxRedeem = await publicClient.readContract({
    address: VAULT,
    abi: MOOLAH_VAULT_ABI,
    functionName: "maxRedeem",
    args: [account],
  });
  const heldShares = await sharesOf();
  if (maxRedeem === 0n) {
    record(
      "share-denominated redeem burns exactly the shares given",
      false,
      "the vault could redeem nothing at this block, so nothing was exercised",
    );
  } else if (maxRedeem >= heldShares) {
    await run(
      await sdk.buildVaultWithdrawParams({
        chainId: CHAIN,
        vaultAddress: VAULT,
        withdrawAll: true,
        walletAddress: account,
      }),
    );
    record("withdrawAll empties the position", (await sharesOf()) === 0n, `shares ${await sharesOf()}`);
  } else {
    // Still exercise the share-denominated path, just within what the vault
    // can actually pay out right now.
    await run(
      await sdk.buildVaultWithdrawParams({
        chainId: CHAIN,
        vaultAddress: VAULT,
        shares: maxRedeem,
        walletAddress: account,
      }),
    );
    record(
      "share-denominated redeem burns exactly the shares given",
      heldShares - (await sharesOf()) === maxRedeem,
      `redeemed ${formatUnits(maxRedeem, decimals)} of ${formatUnits(heldShares, decimals)} ` +
        `(vault liquidity, not the SDK, is the bound)`,
    );
  }
}

// ---- Plain market: the surface every integrator touches first -------------

async function marketFlow({ sdk, publicClient, rpcUrl, account, run, balanceOf, wallet }) {
  console.log("\nvariable-rate market");
  const info = await sdk.getMarketExtraInfo(CHAIN, MARKET);
  const loan = info.loanInfo.address;
  const collateral = info.collateralInfo.address;
  const loanUnit = 10n ** BigInt(info.loanInfo.decimals);
  const collUnit = 10n ** BigInt(info.collateralInfo.decimals);

  await fundToken(rpcUrl, publicClient, collateral, account, 500n * collUnit);
  await fundToken(rpcUrl, publicClient, loan, account, 2_000n * loanUnit);

  const userData = () => sdk.getMarketUserData(CHAIN, MARKET, account);
  const supplySharesOf = async () =>
    (
      await publicClient.readContract({
        address: getContractAddress("bsc", "moolah"),
        abi: MOOLAH_ABI,
        functionName: "position",
        args: [MARKET, account],
      })
    )[0];

  // 1. lend into the market directly — no vault in between
  const sharesBeforeLend = await supplySharesOf();
  await run(
    await sdk.buildMoolahSupplyParams({
      chainId: CHAIN,
      marketId: MARKET,
      assets: 500n * loanUnit,
      walletAddress: account,
    }),
  );
  const sharesAfterLend = await supplySharesOf();
  record(
    "direct-to-market supply credits supply shares",
    sharesAfterLend > sharesBeforeLend,
    `${sharesBeforeLend} -> ${sharesAfterLend} supply shares`,
  );

  // 2. and take it back out
  const loanBeforeWithdraw = await balanceOf(loan);
  await run(
    await sdk.buildMoolahWithdrawParams({
      chainId: CHAIN,
      marketId: MARKET,
      assets: 200n * loanUnit,
      walletAddress: account,
    }),
  );
  record(
    "direct-to-market withdraw returns the stated assets",
    (await balanceOf(loan)) - loanBeforeWithdraw === 200n * loanUnit,
    `+${formatUnits(200n * loanUnit, info.loanInfo.decimals)} ${info.loanInfo.symbol}`,
  );

  // 3. borrow against collateral and repay it — the plainest write in the SDK,
  //    and until now the one with no executed evidence at all
  await run(
    await sdk.buildSupplyParams({
      chainId: CHAIN,
      marketId: MARKET,
      assets: 200n * collUnit,
      walletAddress: account,
    }),
  );
  const toBorrow = info.minLoan.numerator * 2n;
  await run(
    await sdk.buildBorrowParams({
      chainId: CHAIN,
      marketId: MARKET,
      assets: toBorrow,
      walletAddress: account,
    }),
  );
  const borrowed = await userData();
  record(
    "borrow against collateral lands",
    borrowed.borrowShares > 0n,
    `${borrowed.borrowShares} borrow shares`,
  );

  await run(
    await sdk.buildRepayParams({
      chainId: CHAIN,
      marketId: MARKET,
      shares: borrowed.borrowShares,
      walletAddress: account,
    }),
  );
  record(
    "share-denominated repay clears the debt exactly",
    (await userData()).borrowShares === 0n,
    `${borrowed.borrowShares} -> 0 shares`,
  );

  await run(
    await sdk.buildWithdrawParams({
      chainId: CHAIN,
      marketId: MARKET,
      assets: 200n * collUnit,
      walletAddress: account,
    }),
  );
  record(
    "collateral comes back once the debt is clear",
    (await userData()).collateral.numerator ===
      borrowed.collateral.numerator - 200n * collUnit,
    "collateral returned",
  );

  // 4. flash loan
  //
  // Moolah hands the loan to `msg.sender` and calls back on it, so an EOA
  // cannot initiate one — there has to be a contract. The fixture installed
  // here forwards the SDK's calldata unchanged and approves the repayment, so
  // what executes is still exactly what the builder produced.
  await raw(rpcUrl, "anvil_setCode", [FLASH_RECEIVER, FLASH_RECEIVER_RUNTIME]);
  const [flash] = await sdk.buildFlashLoanParams({
    chainId: CHAIN,
    token: loan,
    assets: 100n * loanUnit,
    data: encodeAbiParameters([{ type: "address" }], [loan]),
  });
  const moolahBefore = await balanceOf(loan, getContractAddress("bsc", "moolah"));
  const hash = await wallet.sendTransaction({
    to: FLASH_RECEIVER,
    data: encodeFunctionData({
      abi: FLASH_RECEIVER_ABI,
      functionName: "execute",
      args: [flash.params.to, flash.params.data],
    }),
    gas: 3_000_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  record(
    "a flash loan is taken and repaid in one transaction",
    receipt.status === "success" &&
      (await balanceOf(loan, getContractAddress("bsc", "moolah"))) ===
        moolahBefore,
    `${receipt.status}, Moolah's balance unchanged at ${moolahBefore}`,
  );
}

// ---- Fixed-term broker: the one call the testnet cannot reach --------------

async function brokerFlow({ sdk, publicClient, rpcUrl, account, run }) {
  console.log("\nfixed-term broker");
  const info = await sdk.getMarketExtraInfo(CHAIN, BROKER_MARKET);
  const loan = info.loanInfo.address;
  const collateral = info.collateralInfo.address;
  const collUnit = 10n ** BigInt(info.collateralInfo.decimals);
  const loanUnit = 10n ** BigInt(info.loanInfo.decimals);

  await fundToken(rpcUrl, publicClient, collateral, account, 500n * collUnit);
  await fundToken(rpcUrl, publicClient, loan, account, 2_000n * loanUnit);

  const debtOf = () =>
    publicClient.readContract({
      address: BROKER,
      abi: LENDING_BROKER_ABI,
      functionName: "getUserTotalDebt",
      args: [account],
    });

  await run(
    await sdk.buildSupplyParams({
      chainId: CHAIN,
      marketId: BROKER_MARKET,
      assets: 200n * collUnit,
      walletAddress: account,
    }),
  );

  const before = await debtOf();
  await run(
    await sdk.buildBrokerBorrowParams({
      chainId: CHAIN,
      brokerAddress: BROKER,
      amount: info.minLoan.numerator * 2n,
    }),
  );
  const after = await debtOf();
  record("broker borrow increases total debt", after > before, `${before} -> ${after}`);

  // `repayAll` is absent from the testnet broker, so this is the only place it
  // can run. It was previously recorded as a PASS there without ever executing.
  await run(
    await sdk.buildBrokerRepayAllParams({
      chainId: CHAIN,
      brokerAddress: BROKER,
      onBehalf: account,
      maxRepayAmount: (after * 12n) / 10n,
      loanToken: loan,
      walletAddress: account,
    }),
  );
  record(
    "repayAll clears every leg",
    (await debtOf()) === 0n,
    `${after} -> ${await debtOf()}`,
  );

  // And the approval does not outlive it. The repay ceiling is deliberately
  // over-sized — the debt grows between building and inclusion — so without the
  // trailing clear the broker keeps the remainder as standing allowance. This
  // is also the only executed evidence that the approve steps do what they say.
  const leftover = await publicClient.readContract({
    address: loan,
    abi: [
      {
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
        name: "allowance",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
    ],
    functionName: "allowance",
    args: [account, BROKER],
  });
  record(
    "the over-sized repay approval is returned to zero",
    leftover === 0n,
    `allowance to the broker is ${leftover}`,
  );
}

// ---- Smart Lending, the raw-LP half ---------------------------------------

async function dexLpFlow({ sdk, publicClient, rpcUrl, account, run, balanceOf }) {
  console.log("\nSmart Lending (raw LP)");
  const cfg = await sdk.getSmartMarketExtraInfo(CHAIN, SMART_MARKET);
  const lp = cfg.LPToken;
  const unit = 10n ** 18n;

  // The provider and the pool hold this LP by construction, so name them
  // rather than hoping the recent-Transfer window catches a holder.
  const funding = await fundToken(rpcUrl, publicClient, lp, account, 100n * unit, {
    candidates: [cfg.collateralProvider, cfg.stablePool],
  });
  const userData = () => sdk.getSmartMarketUserData(CHAIN, SMART_MARKET, account);

  const before = await userData();
  await run(
    await sdk.buildSmartSupplyDexLpParams({
      chainId: CHAIN,
      marketId: SMART_MARKET,
      lpAmount: 100n * unit,
      walletAddress: account,
      smartConfig: cfg,
    }),
  );
  const supplied = await userData();
  record(
    "supplying the raw LP token credits collateral one for one",
    supplied.collateral.numerator - before.collateral.numerator === 100n * unit,
    `+${supplied.collateral.numerator - before.collateral.numerator} LP wei (funded via ${funding})`,
  );

  // Custom-ratio withdrawal: name both amounts, cap the LP burnt.
  const aBefore = await balanceOf(cfg.tokenAInfo.address);
  const bBefore = await balanceOf(cfg.tokenBInfo.address);
  await run(
    await sdk.buildSmartWithdrawCollateralParams({
      chainId: CHAIN,
      marketId: SMART_MARKET,
      tokenAAmount: 10n * unit,
      tokenBAmount: 10n * unit,
      maxLpBurn: 60n * unit,
      walletAddress: account,
      smartConfig: cfg,
    }),
  );
  record(
    "custom-ratio withdrawal pays out both tokens",
    (await balanceOf(cfg.tokenAInfo.address)) - aBefore === 10n * unit &&
      (await balanceOf(cfg.tokenBInfo.address)) - bBefore === 10n * unit,
    `+10 ${cfg.tokenAInfo.symbol} and +10 ${cfg.tokenBInfo.symbol}`,
  );

  // And the raw-LP exit.
  const lpBefore = await balanceOf(lp);
  const held = (await userData()).collateral.numerator - before.collateral.numerator;
  await run(
    await sdk.buildSmartWithdrawDexLpParams({
      chainId: CHAIN,
      marketId: SMART_MARKET,
      lpAmount: held,
      walletAddress: account,
      smartConfig: cfg,
    }),
  );
  const lpReturned = (await balanceOf(lp)) - lpBefore;
  record(
    "withdrawing as raw LP returns the token itself",
    lpReturned === held,
    `+${held} LP wei`,
  );

  // Redeeming seized collateral into its pair.
  //
  // Not the raw LP: `redeemLpCollateral` burns the market's *collateral token*,
  // which is a different token from the pool LP, and the account only ever
  // holds it after seizing it in a liquidation. Trying it with raw LP in hand
  // reverts with ERC20InsufficientBalance against a zero balance — the token
  // named in that revert is the collateral token, not the LP. So put the
  // account in a liquidator's position directly.
  const smartCollateral = cfg.params.collateralToken;
  const seizedFunding = await fundToken(
    rpcUrl,
    publicClient,
    smartCollateral,
    account,
    50n * unit,
  );
  const aBeforeRedeem = await balanceOf(cfg.tokenAInfo.address);
  const bBeforeRedeem = await balanceOf(cfg.tokenBInfo.address);
  await run(
    await sdk.buildRedeemSmartLpCollateralParams({
      chainId: CHAIN,
      marketId: SMART_MARKET,
      lpAmount: 50n * unit,
      minAmount0: 0n,
      minAmount1: 0n,
      smartConfig: cfg,
    }),
  );
  record(
    "redeeming seized collateral returns the underlying pair",
    (await balanceOf(cfg.tokenAInfo.address)) > aBeforeRedeem &&
      (await balanceOf(cfg.tokenBInfo.address)) > bBeforeRedeem &&
      (await balanceOf(smartCollateral)) === 0n,
    `50 collateral tokens (via ${seizedFunding}) burnt into ` +
      `${cfg.tokenAInfo.symbol} + ${cfg.tokenBInfo.symbol}`,
  );
}

// ---- Smart Lending: single-sided supply, borrow, one-coin withdrawal -------

async function smartFlow({ sdk, publicClient, rpcUrl, account, run, balanceOf }) {
  console.log("\nSmart Lending lifecycle");
  const cfg = await sdk.getSmartMarketExtraInfo(CHAIN, SMART_MARKET);
  const tokenA = cfg.tokenAInfo.address;
  const tokenB = cfg.tokenBInfo.address;
  const loan = cfg.loanInfo.address;
  const unit = 10n ** BigInt(cfg.tokenAInfo.decimals);

  await fundToken(rpcUrl, publicClient, tokenA, account, 10_000n * unit);

  const userData = () => sdk.getSmartMarketUserData(CHAIN, SMART_MARKET, account);

  // 1. supply one side of the pair; the provider does the LP mint
  //
  // Measured as a delta, like the borrow below. An absolute `> 0n` would pass
  // on collateral this account already held, and the anvil default account is
  // a publicly known address that anyone can have supplied to.
  const beforeSupply = await userData();
  await run(
    await sdk.buildSmartSupplyCollateralParams({
      chainId: CHAIN,
      marketId: SMART_MARKET,
      tokenAAmount: 1_000n * unit,
      tokenBAmount: 0n,
      minLpAmount: 0n,
      walletAddress: account,
    }),
  );
  const supplied = await userData();
  const mintedLp =
    supplied.collateral.numerator - beforeSupply.collateral.numerator;
  record(
    "single-sided supply mints LP collateral",
    mintedLp > 0n,
    `+${mintedLp} LP wei for 1000 ${cfg.tokenAInfo.symbol}`,
  );

  // 2. borrow against it, clearing the market minimum
  //
  // Measure the delta, not the balance: the vault section runs first and leaves
  // its own loan-token float behind, and `balance >= borrowed` would pass on
  // that alone.
  const toBorrow = cfg.minLoan.numerator * 2n;
  const loanBefore = await balanceOf(loan);
  await run(
    await sdk.buildBorrowParams({
      chainId: CHAIN,
      marketId: SMART_MARKET,
      assets: toBorrow,
      walletAddress: account,
    }),
  );
  const borrowed = (await balanceOf(loan)) - loanBefore;
  record(
    "borrow against LP collateral lands",
    borrowed === toBorrow,
    `+${formatUnits(borrowed, cfg.loanInfo.decimals)} ${cfg.loanInfo.symbol}`,
  );

  // 3. take part of the collateral back out as a single coin — the flow this
  //    release added. The caller eats the pool's imbalance cost, so the amount
  //    received is bounded below, not equal.
  const tokenBBefore = await balanceOf(tokenB);
  const tokenABefore = await balanceOf(tokenA);
  const toBurn = mintedLp / 4n;
  await run(
    await sdk.buildSmartWithdrawCollateralOneCoinParams({
      chainId: CHAIN,
      marketId: SMART_MARKET,
      collateralAmount: toBurn,
      tokenIndex: 1,
      minTokenAmount: 0n,
      walletAddress: account,
    }),
  );
  const received = (await balanceOf(tokenB)) - tokenBBefore;
  const tokenAMoved = (await balanceOf(tokenA)) - tokenABefore;
  const afterWithdraw = await userData();
  record(
    "one-coin withdrawal pays out in the chosen token only",
    // "only" is the claim, so the other side of the pair not moving is the
    // half of it worth asserting — and the collateral burnt is exactly what
    // was asked for, not merely less than before.
    received > 0n &&
      tokenAMoved === 0n &&
      afterWithdraw.collateral.numerator ===
        supplied.collateral.numerator - toBurn,
    `+${formatUnits(received, cfg.tokenBInfo.decimals)} ${cfg.tokenBInfo.symbol}, ` +
      `${cfg.tokenAInfo.symbol} unchanged, collateral -${toBurn}`,
  );

  // 4. settle, so the position does not leak into the liquidation section
  await fundToken(rpcUrl, publicClient, loan, account, toBorrow * 2n);
  await run(
    await sdk.buildSmartRepayParams({
      chainId: CHAIN,
      marketId: SMART_MARKET,
      repayAll: true,
      walletAddress: account,
    }),
  );
  record(
    "repayAll clears the Smart Lending debt",
    (await userData()).borrowed.numerator === 0n,
    `borrowed ${(await userData()).borrowed.toString()}`,
  );
}

// ---- Liquidation: both modes, against a real position ---------------------

async function liquidationFlow({ sdk, publicClient, rpcUrl, account, run, balanceOf }) {
  console.log("\nliquidation");
  const moolah = getContractAddress("bsc", "moolah");

  const candidates = await sdk.getCloseToLiquidate({ page: 1, pageSize: 20 });
  const list = candidates.list ?? [];
  record("the API surfaces positions close to liquidation", list.length > 0, `${list.length} candidates`);
  if (list.length === 0) return;

  const target = list[0];
  const marketId = target.marketId;
  const borrower = target.user;

  const params = await marketParams(publicClient, moolah, marketId);
  const slot = await findPositionSlot(rpcUrl, publicClient, moolah, marketId, borrower);
  record("located Moolah's position storage", slot !== null, slot === null ? "" : `base slot ${slot.base}`);
  if (slot === null) return;

  // Halve the borrower's collateral. This is the whole reason the flow runs on
  // a fork: an unhealthy position cannot be conjured on a live chain, and
  // waiting for one to appear is not a test.
  const halved = (slot.collateral / 2n) << 128n | slot.borrowShares;
  await raw(rpcUrl, "anvil_setStorageAt", [moolah, slot.slot1, pad(toHex(halved), { size: 32 })]);

  const price = await publicClient.readContract({
    address: moolah, abi: MOOLAH_ABI, functionName: "getPrice", args: [params],
  });
  const position = await publicClient.readContract({
    address: moolah, abi: MOOLAH_ABI, functionName: "position", args: [marketId, borrower],
  });
  const market = await publicClient.readContract({
    address: moolah, abi: MOOLAH_ABI, functionName: "market", args: [marketId],
  });
  const borrowedAssets =
    market[3] === 0n ? 0n : (position[1] * market[2]) / market[3];
  const health = positionHealthFactor({
    collateral: position[2],
    collateralPrice: price,
    borrowed: borrowedAssets,
    lltv: params.lltv,
  });
  const WAD = 10n ** 18n;
  record(
    "the position now reads as liquidatable",
    health !== null && health < WAD,
    `health ${health === null ? "n/a" : `${Number(health) / 1e18}`} on ${marketId.slice(0, 10)}`,
  );
  if (health === null || health >= WAD) return;

  const loanToken = params.loanToken;
  const liquidator = getContractAddress("bsc", "moolahPublicLiquidation");

  // The gate, before anything else. The liquidator only serves markets an admin
  // has enabled, and at the time of writing not one market in the "close to
  // liquidation" feed was enabled — so the honest first assertion is that the
  // SDK refuses to build a call that can only revert.
  const enabled = await sdk.isLiquidationMarketEnabled(CHAIN, marketId);
  const refusal = await sdk
    .buildLiquidateParams({
      chainId: CHAIN, marketId, borrower, walletAddress: account,
      loanToken, maxRepayAmount: 1n, seizedAssets: 1n,
    })
    .then(() => null)
    .catch((e) => String(e.message));
  record(
    enabled
      ? "market is on the liquidator's allowlist, so the builder proceeds"
      : "the builder refuses a market the liquidator will not serve",
    enabled ? refusal === null : /not on the public liquidator/.test(refusal ?? ""),
    enabled ? "" : "would have reverted with NotWhitelisted()",
  );

  // Now enable it, so the rest of the flow can run at all. This is an admin
  // operation the SDK deliberately does not expose — a liquidator does not get
  // to choose which markets it may liquidate.
  if (!enabled) {
    // `setMarketWhitelist` is gated on BOT, not MANAGER — the two roles both
    // exist and the names do not say which guards what, so take both rather
    // than guess. Getting it wrong surfaces as
    // AccessControlUnauthorizedAccount with a role hash and no name.
    for (const roleName of ["BOT", "MANAGER"]) {
      const role = await publicClient.readContract({
        address: liquidator, abi: LIQUIDATOR_ADMIN_ABI, functionName: roleName,
      });
      await grantRoleOnFork(rpcUrl, publicClient, liquidator, role, account);
    }
    await run([
      {
        index: 0,
        step: "setMarketWhitelist",
        params: {
          to: liquidator,
          data: encodeFunctionData({
            abi: LIQUIDATOR_ADMIN_ABI,
            functionName: "setMarketWhitelist",
            args: [marketId, true],
          }),
        },
      },
    ]);
    record(
      "enabling the market on the liquidator lets the call through",
      (await sdk.isLiquidationMarketEnabled(CHAIN, marketId)) === true,
    );
  }

  const snapshot = await raw(rpcUrl, "evm_snapshot", []);

  // Mode 1: fix the collateral taken.
  const seized = position[2] / 10n;
  const quote = await sdk.quoteLiquidationCost({ chainId: CHAIN, marketId, seizedAssets: seized });
  record("quoteLiquidationCost prices a seizure", quote > 0n, `${quote} loan units for ${seized} collateral`);

  await fundToken(rpcUrl, publicClient, loanToken, account, quote * 4n);
  const collBefore = await balanceOf(params.collateralToken);
  await run(
    await sdk.buildLiquidateParams({
      chainId: CHAIN, marketId, borrower, walletAddress: account,
      loanToken, maxRepayAmount: quote * 2n, seizedAssets: seized,
    }),
  );
  const gained = (await balanceOf(params.collateralToken)) - collBefore;
  record(
    "seizedAssets mode transfers exactly the collateral asked for",
    gained === seized,
    `+${gained}`,
  );

  // anvil returns false when the snapshot is gone. Asserting the revert
  // happened is the difference between mode 2 running on the same position and
  // running on mode 1's leftovers.
  const reverted = await raw(rpcUrl, "evm_revert", [snapshot]);
  if (reverted !== true) {
    throw new Error("evm_revert did not restore the snapshot; mode 2 would run on mode 1's leftovers");
  }

  // Mode 2: fix the debt cleared instead. Same position, same block — the only
  // difference is which side of the trade the caller pins. The revert above put
  // the chain back, so this is not running on the leftovers of mode 1.
  const repaidShares = position[1] / 10n;
  const quote2 = await sdk.quoteLiquidationCost({ chainId: CHAIN, marketId, repaidShares });
  await fundToken(rpcUrl, publicClient, loanToken, account, quote2 * 4n);
  const sharesOf = async () =>
    (
      await publicClient.readContract({
        address: moolah, abi: MOOLAH_ABI, functionName: "position", args: [marketId, borrower],
      })
    )[1];
  const sharesBefore = await sharesOf();
  await run(
    await sdk.buildLiquidateParams({
      chainId: CHAIN, marketId, borrower, walletAddress: account,
      loanToken, maxRepayAmount: quote2 * 2n, repaidShares,
    }),
  );
  const sharesAfter = await sharesOf();
  record(
    "repaidShares mode clears exactly the shares asked for",
    sharesBefore - sharesAfter === repaidShares,
    `-${sharesBefore - sharesAfter} shares`,
  );
}

/**
 * The liquidator's admin surface. Deliberately not part of the SDK: choosing
 * which markets may be liquidated is a protocol decision, not a caller's.
 */
const LIQUIDATOR_ADMIN_ABI = [
  {
    inputs: [],
    name: "MANAGER",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "BOT",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "status", type: "bool" },
    ],
    name: "setMarketWhitelist",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

/**
 * Find where Moolah keeps `position[id][user]`.
 *
 * Moolah is an upgradeable fork, so it does not inherit Morpho's fixed layout
 * and the slot cannot be assumed. Search for it instead: for each candidate
 * base slot, compute `keccak(user . keccak(id . base))` and check whether the
 * second word matches the (borrowShares, collateral) pair the contract reports.
 */
async function findPositionSlot(rpcUrl, publicClient, moolah, marketId, user) {
  const [, borrowShares, collateral] = await publicClient.readContract({
    address: moolah, abi: MOOLAH_ABI, functionName: "position", args: [marketId, user],
  });
  const packed = (collateral << 128n) | borrowShares;
  for (let base = 0; base < 200; base += 1) {
    const inner = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [marketId, BigInt(base)]),
    );
    const outer = keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [user, inner]),
    );
    const slot1 = toHex(BigInt(outer) + 1n, { size: 32 });
    const value = await raw(rpcUrl, "eth_getStorageAt", [moolah, slot1, "latest"]);
    if (BigInt(value) === packed && packed !== 0n) {
      return { base, slot1, borrowShares, collateral };
    }
  }
  return null;
}

async function marketParams(publicClient, moolah, marketId) {
  const [loanToken, collateralToken, oracle, irm, lltv] =
    await publicClient.readContract({
      address: moolah, abi: MOOLAH_ABI, functionName: "idToMarketParams", args: [marketId],
    });
  return { loanToken, collateralToken, oracle, irm, lltv };
}

main().catch((err) => {
  console.error(String(err?.shortMessage ?? err?.message ?? err));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
