import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from 'wagmi'
import { realManageActions } from './manage-actions'

type Receipt = { status: 'success' | 'reverted' }
type FakeClient = { waitForTransactionReceipt: (args: { hash: Hex; timeout: number }) => Promise<Receipt> }

const wagmi = vi.hoisted(() => {
  const waitForTransactionReceipt = vi.fn<FakeClient['waitForTransactionReceipt']>()
  const getPublicClient = vi.fn<(config: Config, parameters: { chainId: number }) => FakeClient | undefined>(
    () => ({ waitForTransactionReceipt }),
  )
  return { waitForTransactionReceipt, getPublicClient }
})
vi.mock('wagmi/actions', () => ({ getPublicClient: wagmi.getPublicClient }))

const HASH: Hex = `0x${'ab'.repeat(32)}`
const config = {} as Config
const target: { chainId: number; contract: Address; wallet: Address } = {
  chainId: 31337,
  contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
}

describe('realManageActions wait', () => {
  beforeEach(() => {
    wagmi.waitForTransactionReceipt.mockReset()
    wagmi.getPublicClient.mockClear()
  })

  it('answers a reverted receipt with its status, so the machine can say the change failed on chain', async () => {
    wagmi.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' })
    await expect(realManageActions(config, target).wait(HASH)).resolves.toBe('reverted')
  })

  it('rejects when the receipt is not read in time, so the machine keeps the hash and offers Check again', async () => {
    const timedOut = new Error('Timed out while waiting for the transaction to be confirmed.')
    wagmi.waitForTransactionReceipt.mockRejectedValue(timedOut)
    const waiting = expect(realManageActions(config, target).wait(HASH)).rejects.toBe(timedOut)
    await waiting
  })

  it("reads the receipt on the collection's chain with a timeout of three minutes", async () => {
    wagmi.waitForTransactionReceipt.mockResolvedValue({ status: 'success' })
    await expect(realManageActions(config, target).wait(HASH)).resolves.toBe('success')
    expect(wagmi.getPublicClient).toHaveBeenCalledWith(config, { chainId: 31337 })
    expect(wagmi.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: HASH, timeout: 180_000 })
  })

  it('throws when the chain has no RPC, without waiting', async () => {
    wagmi.getPublicClient.mockReturnValueOnce(undefined)
    await expect(realManageActions(config, target).wait(HASH)).rejects.toThrow('No RPC for this chain')
    expect(wagmi.waitForTransactionReceipt).not.toHaveBeenCalled()
  })
})
