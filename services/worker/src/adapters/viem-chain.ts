/**
 * The `Chain` port on viem: the factory's `jobPayment(jobId, payer)` for a job, read on the job's
 * `quote_chain_id` from its `quote_factory`, at the chain's confirmation depth
 * (docs/specs/2026-10-09-lock-and-pay.md, section 4). Chain config, the ABI and the factory address
 * come from `@cobweb/shared` (the browser-safe entry: `@cobweb/shared/server` imports `server-only`,
 * which only resolves inside Next). RPC URLs come from the worker's own environment.
 */
import { chainById, factoryAbi, factoryAddress } from '@cobweb/shared'
import type { Env } from '@cobweb/shared'
import { createPublicClient, http } from 'viem'
import type { Address, Hex } from 'viem'
import type { Chain } from '../ports.ts'

/** The three reads the payment check makes, so a test can stand in for viem. */
export type PaymentReader = {
  getBlockNumber(args: { cacheTime: number }): Promise<bigint>
  /** Throws an error named `TransactionReceiptNotFoundError` when the node has no such receipt. */
  getTransactionReceipt(args: { hash: Hex }): Promise<{ blockNumber: bigint }>
  readContract(args: {
    address: Address
    abi: typeof factoryAbi
    functionName: 'jobPayment'
    args: readonly [Hex, Address]
    blockNumber: bigint
  }): Promise<bigint>
}

/**
 * The payment exists at the latest block but is not yet buried under the chain's confirmations (or
 * the node lags behind). Thrown, so the message is redelivered and the check is made again later.
 */
export class PaymentUnconfirmed extends Error {
  constructor() {
    super('The payment is not yet confirmed to the required depth.')
    this.name = 'PaymentUnconfirmed'
  }
}

/**
 * The payment is short at the latest block this node knows, and the node has not shown that it has
 * seen the payment transaction (none is recorded, no receipt, or the receipt is above the block read).
 * Thrown, so the message is redelivered and the job is never failed because a node lags.
 */
export class PaymentUnproven extends Error {
  constructor() {
    super('This node has not yet seen the payment transaction.')
    this.name = 'PaymentUnproven'
  }
}

function viemReader(chainId: number, env: Env): PaymentReader {
  const chain = chainById(chainId)
  const url = chain ? env[chain.rpcEnv] : undefined
  if (!chain || !url) throw new Error(`The RPC URL for chain ${chainId} is not configured.`)
  // No retries inside viem: the step retries the whole read itself, and stacked retries could outlast the function.
  const client = createPublicClient({ chain: chain.viem, transport: http(url, { retryCount: 0 }) })
  return {
    getBlockNumber: (args) => client.getBlockNumber(args),
    getTransactionReceipt: async (args) => {
      const receipt = await client.getTransactionReceipt(args)
      return { blockNumber: receipt.blockNumber }
    },
    readContract: (args) => client.readContract(args),
  }
}

export function viemChain(
  env: Env,
  readerFor: (chainId: number) => PaymentReader = (chainId) => viemReader(chainId, env),
): Chain {
  const readers = new Map<number, PaymentReader>()
  return {
    async jobPayment(job) {
      // Fails closed: a job with no on-chain id, chain or payer has no payment the worker can verify.
      if (job.onchainJobId === '' || job.quoteChainId === null || job.quotePayer === null) return 0n
      const chain = chainById(job.quoteChainId)
      if (!chain) throw new Error(`Chain ${job.quoteChainId} is not configured.`)
      const factory = job.quoteFactory ? (job.quoteFactory as Address) : factoryAddress(chain.id, env)
      let reader = readers.get(chain.id)
      if (!reader) {
        reader = readerFor(chain.id)
        readers.set(chain.id, reader)
      }
      const read = (blockNumber: bigint) =>
        reader.readContract({
          address: factory,
          abi: factoryAbi,
          functionName: 'jobPayment',
          args: [job.onchainJobId as Hex, job.quotePayer as Address],
          blockNumber,
        })
      // Read at the block the chain's confirmations bury, so a payment too shallow to survive a
      // reorg does not count yet. cacheTime 0: viem would otherwise reuse an older block number.
      const latest = await reader.getBlockNumber({ cacheTime: 0 })
      const depth = BigInt(chain.confirmations - 1)
      const buried = latest > depth ? latest - depth : 0n
      const paid = await read(buried)
      if (paid >= job.quoteTotalWei) return paid
      // Short at depth. If the latest block already shows the full amount, the payment exists and
      // only lacks depth (or the node lags): ask for a redelivery.
      if (buried !== latest && (await read(latest)) >= job.quoteTotalWei) throw new PaymentUnconfirmed()
      // Short at latest too. That is final only when this node has seen the payment: a node that
      // lags, or a transaction this chain view does not hold, must not fail a paid job for good.
      if (job.paymentTxHash === null) throw new PaymentUnproven()
      try {
        const receipt = await reader.getTransactionReceipt({ hash: job.paymentTxHash as Hex })
        if (receipt.blockNumber > latest) throw new PaymentUnproven()
        // Seen but not yet buried: a reorg between the two reads could still change it, so wait.
        if (receipt.blockNumber > buried) throw new PaymentUnconfirmed()
      } catch (error) {
        if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError')
          throw new PaymentUnproven()
        throw error
      }
      return paid
    },
  }
}
