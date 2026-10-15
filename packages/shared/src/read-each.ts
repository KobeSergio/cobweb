import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  ExecutionRevertedError,
  type ContractFunctionParameters,
  type PublicClient,
} from 'viem'

/** Calls in one `multicall` where viem's chain has `multicall3`. */
export const MULTICALL_GROUP = 500
/** Calls read side by side where it has none (Anvil). */
export const PARALLEL_GROUP = 50

/**
 * Whether a failed read is the call's own revert (or an empty answer), rather than the request failing. A
 * node's "execution reverted" without data counts as the call's own revert: Geth, Arbitrum Nitro and op-geth
 * answer a dataless revert (an unknown selector's) as -32000, which viem reports as `ExecutionRevertedError`.
 */
export function revertedRead(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk(
      (cause) =>
        cause instanceof ContractFunctionRevertedError ||
        cause instanceof ContractFunctionZeroDataError ||
        cause instanceof ExecutionRevertedError,
    ) !== null
  )
}

/** viem reports a multicall that failed as a whole as the failure of every call, its error naming `aggregate3`. */
const requestFailed = (error: unknown) =>
  error instanceof ContractFunctionExecutionError && error.functionName === 'aggregate3'

/**
 * One value per call, null where the call reverted (docs/specs/2026-10-15-whitelist.md, section 6.3): where
 * viem's chain has `multicall3`, groups of 500 as one `multicall`; otherwise (Anvil) groups of 50 calls side by
 * side. Groups run in turn, and a request that fails as a whole throws.
 */
export async function readEach<T>(
  client: PublicClient,
  calls: readonly ContractFunctionParameters[],
  options: { blockNumber?: bigint } = {},
): Promise<(T | null)[]> {
  const multicall = client.chain?.contracts?.multicall3 !== undefined
  const size = multicall ? MULTICALL_GROUP : PARALLEL_GROUP
  const answers: (T | null)[] = []
  for (let from = 0; from < calls.length; from += size) {
    const group = calls.slice(from, from + size)
    if (multicall) {
      const results = await client.multicall({
        contracts: group,
        allowFailure: true,
        batchSize: 0,
        blockNumber: options.blockNumber,
      })
      for (const result of results) {
        if (result.status === 'success') answers.push(result.result as T)
        else if (requestFailed(result.error)) throw result.error
        else answers.push(null)
      }
    } else {
      const settled = await Promise.allSettled(
        group.map((call) => client.readContract({ ...call, blockNumber: options.blockNumber })),
      )
      for (const result of settled) {
        if (result.status === 'fulfilled') answers.push(result.value as T)
        else if (revertedRead(result.reason)) answers.push(null)
        else throw result.reason
      }
    }
  }
  return answers
}
