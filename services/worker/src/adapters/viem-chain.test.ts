import { describe, expect, it } from 'vitest'
import { jobRecord } from '../testing/fixtures.ts'
import { viemChain } from './viem-chain.ts'
import type { PaymentReader } from './viem-chain.ts'

const FACTORY = '0x00000000000000000000000000000000000000fa'

/**
 * A stand-in reader. `paidAt` answers each read by its block number, so a test can have a payment that
 * is short at one depth and covered at another.
 */
const reader = (latest: bigint, paidAt: bigint | ((block: bigint) => bigint)) => {
  const reads: { address: string; args: readonly unknown[]; blockNumber: bigint }[] = []
  const made: number[] = []
  const stub: PaymentReader = {
    getBlockNumber: async () => latest,
    readContract: async (args) => {
      reads.push({ address: args.address, args: args.args, blockNumber: args.blockNumber })
      return typeof paidAt === 'function' ? paidAt(args.blockNumber) : paidAt
    },
  }
  return {
    reads,
    made,
    readerFor: (chainId: number) => {
      made.push(chainId)
      return stub
    },
  }
}

const caught = async (run: () => Promise<unknown>): Promise<{ name?: string; message?: string }> => {
  try {
    await run()
  } catch (error) {
    return error as { name?: string; message?: string }
  }
  return {}
}

describe('viemChain', () => {
  it('reads jobPayment for the job id and payer from the quote factory, and returns it when it covers the quote', async () => {
    const { reads, readerFor } = reader(100n, 125n)
    const job = jobRecord()
    expect(await viemChain({}, readerFor).jobPayment(job)).toBe(125n)
    expect(reads).toEqual([{ address: FACTORY, args: [job.onchainJobId, job.quotePayer], blockNumber: 100n }])
  })

  it('reads at latest minus (confirmations - 1): 1, 3 and 5 confirmations', async () => {
    // Anvil (31337) asks for 1, Arbitrum (42161) for 3 and Ethereum (1) for 5.
    for (const [chainId, expected] of [
      [31337, 100n],
      [42161, 98n],
      [1, 96n],
    ] as const) {
      const covered = reader(100n, 125n)
      await viemChain({ [`FACTORY_ADDRESS_${chainId}`]: FACTORY }, covered.readerFor).jobPayment(
        jobRecord({ quoteChainId: chainId, quoteFactory: FACTORY }),
      )
      expect(covered.reads.map((read) => read.blockNumber)).toEqual([expected])
    }
    const young = reader(2n, 125n)
    await viemChain({}, young.readerFor).jobPayment(jobRecord({ quoteChainId: 1 }))
    expect(young.reads[0]?.blockNumber).toBe(0n)
  })

  it('throws PaymentUnconfirmed when the payment is short at depth but covers the quote at latest', async () => {
    const { reads, readerFor } = reader(100n, (block) => (block >= 100n ? 125n : 0n))
    const error = await caught(() => viemChain({}, readerFor).jobPayment(jobRecord({ quoteChainId: 1 })))
    expect(error.name).toBe('PaymentUnconfirmed')
    expect(reads.map((read) => read.blockNumber)).toEqual([96n, 100n])
  })

  it('returns the short amount when the payment is short at depth and at latest', async () => {
    const { reads, readerFor } = reader(100n, 40n)
    expect(await viemChain({}, readerFor).jobPayment(jobRecord({ quoteChainId: 1 }))).toBe(40n)
    expect(reads.map((read) => read.blockNumber)).toEqual([96n, 100n])
  })

  it('does not read twice when the depth block is the latest block', async () => {
    const { reads, readerFor } = reader(100n, 40n)
    expect(await viemChain({}, readerFor).jobPayment(jobRecord())).toBe(40n)
    expect(reads).toHaveLength(1)
  })

  it('passes an RPC error on, from either read', async () => {
    const failing = viemChain({}, () => ({
      getBlockNumber: () => Promise.reject(new Error('rpc down')),
      readContract: async () => 0n,
    }))
    await expect(failing.jobPayment(jobRecord())).rejects.toThrow('rpc down')
    const second = viemChain({}, () => ({
      getBlockNumber: async () => 100n,
      readContract: async (args) => {
        if (args.blockNumber === 100n) throw new Error('rpc lagging')
        return 0n
      },
    }))
    await expect(second.jobPayment(jobRecord({ quoteChainId: 1 }))).rejects.toThrow('rpc lagging')
  })

  it('answers zero, without a read, for a job with no on-chain id, no chain or no payer', async () => {
    const { reads, readerFor } = reader(10n, 99n)
    const chain = viemChain({}, readerFor)
    expect(await chain.jobPayment(jobRecord({ onchainJobId: '' }))).toBe(0n)
    expect(await chain.jobPayment(jobRecord({ quoteChainId: null }))).toBe(0n)
    expect(await chain.jobPayment(jobRecord({ quotePayer: null }))).toBe(0n)
    expect(reads).toEqual([])
  })

  it('falls back to the configured factory when the job has none', async () => {
    const { reads, readerFor } = reader(10n, 125n)
    const env = { FACTORY_ADDRESS_31337: '0x5FbDB2315678afecb367f032d93F642f64180aa3' }
    await viemChain(env, readerFor).jobPayment(jobRecord({ quoteFactory: null }))
    expect(reads[0]?.address).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3')
    await expect(viemChain({}, readerFor).jobPayment(jobRecord({ quoteFactory: null }))).rejects.toThrow(
      'The factory address for chain 31337 is not configured.',
    )
  })

  it('throws for a chain that is not offered', async () => {
    const { readerFor } = reader(10n, 1n)
    await expect(viemChain({}, readerFor).jobPayment(jobRecord({ quoteChainId: 999 }))).rejects.toThrow(
      'Chain 999 is not configured.',
    )
  })

  it('throws when the chain has no RPC URL configured', async () => {
    await expect(viemChain({}).jobPayment(jobRecord())).rejects.toThrow(
      'The RPC URL for chain 31337 is not configured.',
    )
  })

  it('makes one reader a chain', async () => {
    const { made, readerFor } = reader(10n, 125n)
    const chain = viemChain({}, readerFor)
    await chain.jobPayment(jobRecord())
    await chain.jobPayment(jobRecord())
    expect(made).toEqual([31337])
  })
})
