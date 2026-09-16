import type { Address, PublicClient } from "viem";
import { zeroAddress } from "viem";
import {
  MOOLAH_VAULT_ABI,
  NATIVE_PROVIDER_ABI,
  getContractAddressOptional,
  type NetworkName,
  type VaultInfo,
  type VaultUserData,
} from "@lista-dao/moolah-sdk-core";
import type { ChainId, StepParam } from "../types.js";
import { buildCallParams, finalizeSteps, type DraftStep } from "../utils.js";
import {
  buildApproveSteps,
  buildClearAllowanceStep,
  priorAllowanceOf,
} from "./approve.js";
import { withResolvedVaultProvider } from "../resolveProviders.js";

export interface VaultBuilderDeps {
  publicClient: PublicClient;
  network: NetworkName;
}

export async function buildVaultDepositSteps(
  params: {
    chainId: ChainId;
    vaultAddress: Address;
    assets: bigint;
    walletAddress: Address;
    receiver?: Address;
  },
  vaultInfo: VaultInfo,
  deps: VaultBuilderDeps,
): Promise<StepParam[]> {
  // A vault names its own provider, and that provider is the approval spender.
  vaultInfo = await withResolvedVaultProvider(
    params.vaultAddress,
    vaultInfo,
    deps.publicClient,
    deps.network,
  );

  const { publicClient, network } = deps;
  const receiver = params.receiver ?? params.walletAddress;
  const wbnb = getContractAddressOptional(network, "wbnb");
  // Case-insensitive, and guarded on wbnb being configured at all: it is 0x0
  // on Ethereum, where comparing a real asset against it silently said "not
  // native" and took the ERC-20 path.
  const isNativeBNB =
    vaultInfo.isNative &&
    wbnb !== zeroAddress &&
    vaultInfo.assetInfo.address.toLowerCase() === wbnb.toLowerCase();

  const steps: DraftStep[] = [];

  if (!isNativeBNB) {
    const contractAddress =
      vaultInfo.provider !== zeroAddress
        ? vaultInfo.provider
        : params.vaultAddress;

    const approveSteps = await buildApproveSteps(
      {
        chainId: params.chainId,
        owner: params.walletAddress,
        token: vaultInfo.assetInfo.address,
        spender: contractAddress,
        amount: params.assets,
      },
      publicClient,
      network,
    );
    steps.push(...approveSteps);

    steps.push({
      step: "depositVault",
      params: buildCallParams({
        to: contractAddress,
        abi: MOOLAH_VAULT_ABI,
        functionName: "deposit",
        args: [params.assets, receiver],
        chainId: params.chainId,
      }),
    });
    return finalizeSteps(steps);
  }

  if (vaultInfo.provider !== zeroAddress) {
    steps.push({
      step: "depositVault",
      params: buildCallParams({
        to: vaultInfo.provider,
        abi: NATIVE_PROVIDER_ABI,
        functionName: "deposit",
        args: [params.vaultAddress, receiver],
        value: params.assets,
        chainId: params.chainId,
      }),
    });
    return finalizeSteps(steps);
  }

  steps.push({
    step: "depositVault",
    params: buildCallParams({
      to: params.vaultAddress,
      abi: MOOLAH_VAULT_ABI,
      functionName: "deposit",
      args: [params.assets, receiver],
      chainId: params.chainId,
    }),
  });

  return finalizeSteps(steps);
}

/**
 * The exit resolves its provider too, and takes `deps` rather than a bare
 * `network` so it can.
 *
 * Deposit and mint resolved and this did not, which is the one combination
 * that turns a provider migration into a stranded position: the assets go in
 * through the address the chain names and the withdrawal asks the address the
 * cached config remembers. Resolving neither would have failed the deposit
 * too, loudly and recoverably.
 */
export async function buildVaultWithdrawSteps(
  params: {
    chainId: ChainId;
    vaultAddress: Address;
    assets?: bigint;
    shares?: bigint;
    withdrawAll?: boolean;
    walletAddress: Address;
    receiver?: Address;
  },
  vaultInfo: VaultInfo,
  deps: VaultBuilderDeps,
  userData?: VaultUserData,
): Promise<StepParam[]> {
  vaultInfo = await withResolvedVaultProvider(
    params.vaultAddress,
    vaultInfo,
    deps.publicClient,
    deps.network,
  );

  const { network } = deps;
  const receiver = params.receiver ?? params.walletAddress;
  // In ERC-4626 `owner` is whose shares are burned, and `receiver` is who gets
  // the assets. They coincide only when no receiver is given. Deriving owner
  // from receiver meant that withdrawing to another address tried to burn that
  // address's shares — usually a revert, but where the receiver had granted
  // this caller a share allowance it would succeed against the wrong position.
  const owner = params.walletAddress;
  const wbnb = getContractAddressOptional(network, "wbnb");
  // Case-insensitive, and guarded on wbnb being configured at all: it is 0x0
  // on Ethereum, where comparing a real asset against it silently said "not
  // native" and took the ERC-20 path.
  const isNativeBNB =
    vaultInfo.isNative &&
    wbnb !== zeroAddress &&
    vaultInfo.assetInfo.address.toLowerCase() === wbnb.toLowerCase();

  let shares = params.shares;
  const assets = params.assets;

  if (params.withdrawAll) {
    // Without the position there is nothing to resolve "all" to. Falling
    // through used to withdraw whatever `assets` happened to carry instead —
    // a smaller withdrawal reported as a full exit. The market twin throws for
    // exactly this shape.
    if (!userData) {
      throw new Error(
        "buildVaultWithdrawSteps: withdrawAll requires userData to size the withdrawal",
      );
    }
    shares = userData.shares.numerator;
  }

  // A zero-valued withdrawal encodes cleanly and settles nothing. It is the
  // failure mode with no signal: the transaction succeeds, the balance does not
  // move, and a harness asserting `after - before === requested` proves nothing
  // because both sides are zero. Say so instead.
  if (shares !== undefined && shares <= 0n) {
    throw new Error(
      params.withdrawAll
        ? "buildVaultWithdrawSteps: withdrawAll with no shares held — there is nothing to withdraw"
        : "buildVaultWithdrawSteps: shares must be greater than zero",
    );
  }
  if (shares === undefined && assets !== undefined && assets <= 0n) {
    throw new Error(
      "buildVaultWithdrawSteps: assets must be greater than zero",
    );
  }

  const contractAddress =
    vaultInfo.provider !== zeroAddress
      ? vaultInfo.provider
      : params.vaultAddress;

  if (shares !== undefined) {
    if (isNativeBNB && vaultInfo.provider !== zeroAddress) {
      return finalizeSteps([
        {
          step: "withdrawVault",
          params: buildCallParams({
            to: vaultInfo.provider,
            abi: NATIVE_PROVIDER_ABI,
            functionName: "redeem",
            args: [params.vaultAddress, shares, receiver, owner],
            chainId: params.chainId,
          }),
        },
      ]);
    }

    return finalizeSteps([
      {
        step: "withdrawVault",
        params: buildCallParams({
          to: contractAddress,
          abi: MOOLAH_VAULT_ABI,
          functionName: "redeem",
          args: [shares, receiver, owner],
          chainId: params.chainId,
        }),
      },
    ]);
  }

  if (assets === undefined) {
    throw new Error("assets or shares is required for vault withdraw");
  }

  if (isNativeBNB && vaultInfo.provider !== zeroAddress) {
    return finalizeSteps([
      {
        step: "withdrawVault",
        params: buildCallParams({
          to: vaultInfo.provider,
          abi: NATIVE_PROVIDER_ABI,
          functionName: "withdraw",
          args: [params.vaultAddress, assets, receiver, owner],
          chainId: params.chainId,
        }),
      },
    ]);
  }

  return finalizeSteps([
    {
      step: "withdrawVault",
      params: buildCallParams({
        to: contractAddress,
        abi: MOOLAH_VAULT_ABI,
        functionName: "withdraw",
        args: [assets, receiver, owner],
        chainId: params.chainId,
      }),
    },
  ]);
}

/**
 * Deposit into a vault for an exact number of shares (ERC-4626 `mint`).
 *
 * `deposit` is asset-denominated: you say how much to put in and receive
 * whatever shares that buys. `mint` is the inverse, which is what an
 * integrator holding a share target needs.
 */
/**
 * Default headroom on an approval sized from `previewMint`.
 *
 * A vault that earns interest reprices every block, so an allowance set to the
 * exact quote is stale before the transaction is mined and `mint` reverts with
 * `ERC20: insufficient allowance`. Observed on a mainnet fork: the same
 * sequence passed or failed depending only on whether a block boundary fell
 * between building and sending. An allowance is a ceiling, not a payment —
 * `mint` pulls what it needs and the approve step carries its own reversal — so
 * the headroom costs nothing.
 */
export const DEFAULT_MINT_APPROVAL_BUFFER_BPS = 100n;

export async function buildVaultMintSteps(
  params: {
    chainId: ChainId;
    vaultAddress: Address;
    shares: bigint;
    walletAddress: Address;
    receiver?: Address;
    /** Approval ceiling. Omit to size it from `previewMint` plus headroom. */
    maxAssets?: bigint;
    /** Override the headroom on an auto-sized approval. */
    approvalBufferBps?: bigint;
    /** Keep the leftover allowance instead of returning it to zero. */
    keepAllowance?: boolean;
    /**
     * Route mint through the vault's provider. Only meaningful for a
     * non-native provider you have verified implements `mint`.
     */
    allowProviderRouting?: boolean;
  },
  vaultInfo: VaultInfo,
  deps: VaultBuilderDeps,
): Promise<StepParam[]> {
  // A vault names its own provider, and that provider is the approval spender.
  vaultInfo = await withResolvedVaultProvider(
    params.vaultAddress,
    vaultInfo,
    deps.publicClient,
    deps.network,
  );

  if (params.shares <= 0n) {
    throw new Error("buildVaultMintSteps: shares must be greater than zero");
  }

  // Provider-backed vaults are refused by default, and the reason differs.
  //
  // The NativeProvider exposes deposit, withdraw and redeem and no mint at all,
  // so a native-backed vault has no share-denominated entry point: routing
  // around the provider would approve the wrong spender and call a contract
  // that never sees the value.
  //
  // For any other provider the honest answer is that we do not know. The one
  // provider ABI this SDK holds is not 4626-shaped — NativeProvider's `deposit`
  // is `deposit(address vault, address receiver)` — so "providers speak
  // ERC-4626" is an assumption, not a fact, and acting on it would send a real
  // approve transaction before the mint reverted as a missing function,
  // leaving the allowance standing because the sequence aborts before the
  // clear step. A refusal costs nothing; a wrong guess costs an approval.
  if (
    vaultInfo.provider !== zeroAddress &&
    (vaultInfo.isNative || !params.allowProviderRouting)
  ) {
    throw new Error(
      vaultInfo.isNative
        ? `buildVaultMintSteps: vault ${params.vaultAddress} deposits through ` +
            `the native provider ${vaultInfo.provider}, which has no mint entry ` +
            `point. Use buildVaultDepositParams (assets-denominated) instead.`
        : `buildVaultMintSteps: vault ${params.vaultAddress} deposits through ` +
            `provider ${vaultInfo.provider}, and this SDK has not established ` +
            `that the provider implements mint(uint256,address). Use ` +
            `buildVaultDepositParams, or pass allowProviderRouting once you have ` +
            `verified the provider yourself.`,
    );
  }

  const { publicClient, network } = deps;
  const target =
    vaultInfo.provider !== zeroAddress
      ? vaultInfo.provider
      : params.vaultAddress;
  const steps: DraftStep[] = [];

  let assetCeiling = params.maxAssets;
  if (assetCeiling === undefined) {
    const quoted = (await publicClient.readContract({
      address: params.vaultAddress,
      abi: MOOLAH_VAULT_ABI,
      functionName: "previewMint",
      args: [params.shares],
    })) as bigint;
    const bufferBps =
      params.approvalBufferBps ?? DEFAULT_MINT_APPROVAL_BUFFER_BPS;
    assetCeiling = quoted + (quoted * bufferBps) / 10_000n;
  }

  const approveSteps = await buildApproveSteps(
    {
      chainId: params.chainId,
      owner: params.walletAddress,
      token: vaultInfo.assetInfo.address,
      spender: target,
      amount: assetCeiling,
    },
    publicClient,
    network,
  );
  const approvedHere = approveSteps.length > 0;
  const priorAllowance = priorAllowanceOf(approveSteps);
  steps.push(...approveSteps);

  steps.push({
    step: "vaultMint",
    params: buildCallParams({
      to: target,
      abi: MOOLAH_VAULT_ABI,
      functionName: "mint",
      args: [params.shares, params.receiver ?? params.walletAddress],
      chainId: params.chainId,
    }),
    meta: {
      amount: params.shares,
      precondition:
        "approval sized from previewMint plus headroom; the share price moves between building and inclusion",
      observedState: { allowance: assetCeiling },
    },
  });

  // The headroom that makes the mint survive a reprice is also allowance the
  // vault keeps afterwards. Return it.
  if (approvedHere && !params.keepAllowance) {
    steps.push(
      ...buildClearAllowanceStep({
        chainId: params.chainId,
        token: vaultInfo.assetInfo.address,
        spender: target,
        restoreTo: priorAllowance,
        network: network,
      }),
    );
  }

  return finalizeSteps(steps);
}
