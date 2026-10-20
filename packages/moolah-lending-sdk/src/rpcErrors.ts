import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  ExecutionRevertedError,
} from "viem";

/**
 * Did this call fail because the contract said no, or because the network did?
 *
 * The distinction is load-bearing wherever a failed read is treated as
 * evidence. A revert or an empty return says something about the contract — a
 * missing function, a rejected call. A timeout, a 429 from a rate-limited
 * provider, a dropped connection: those say nothing, and treating them as
 * evidence turns a retryable error into silently wrong data.
 *
 * `ExecutionRevertedError` is included deliberately. Some nodes report a revert
 * as `-32000 execution reverted` with no revert data at all, and viem cannot
 * build a `ContractFunctionRevertedError` without data — so the narrower
 * predicate would rethrow a plain revert as though the node were unreachable.
 */
export function isContractLevelFailure(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk(
      (e) =>
        e instanceof ContractFunctionRevertedError ||
        e instanceof ContractFunctionZeroDataError ||
        e instanceof ExecutionRevertedError,
    ) !== null
  );
}

/** Read an optional view: absent means null, unreachable means throw. */
export async function optionalRead<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (isContractLevelFailure(error)) return null;
    throw error;
  }
}
