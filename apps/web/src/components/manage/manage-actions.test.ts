import { DEFAULT_TRANSFER_VALIDATOR, validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import type { Address, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from 'wagmi'
import { airdropCalls, settingsCalls } from '@/lib/manage/phase-calls'
import { realManageActions } from './manage-actions'

type Receipt = { status: 'success' | 'reverted' }
type FakeClient = { waitForTransactionReceipt: (args: { hash: Hex; timeout: number }) => Promise<Receipt> }

const wagmi = vi.hoisted(() => {
  const waitForTransactionReceipt = vi.fn<FakeClient['waitForTransactionReceipt']>()
  const getPublicClient = vi.fn<(config: Config, parameters: { chainId: number }) => FakeClient | undefined>(
    () => ({ waitForTransactionReceipt }),
  )
  const simulateContract = vi.fn<(config: Config, parameters: unknown) => Promise<{ request: unknown }>>()
  const writeContract = vi.fn<(config: Config, request: unknown) => Promise<Hex>>()
  return { waitForTransactionReceipt, getPublicClient, simulateContract, writeContract }
})
vi.mock('wagmi/actions', () => ({
  getPublicClient: wagmi.getPublicClient,
  simulateContract: wagmi.simulateContract,
  writeContract: wagmi.writeContract,
}))

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

describe('realManageActions simulate (docs/specs/2026-10-15-airdrop-settings.md, section 7.1)', () => {
  const request = { simulated: true }

  beforeEach(() => {
    wagmi.simulateContract.mockReset()
    wagmi.writeContract.mockReset()
    wagmi.simulateContract.mockResolvedValue({ request })
    wagmi.writeContract.mockResolvedValue(HASH)
  })

  it('simulates a batch on the collection with its value, then sends the simulated request unchanged', async () => {
    const call = airdropCalls.batch([{ address: target.wallet, amount: 2 }], '100')
    const send = await realManageActions(config, target).simulate(call)
    expect(wagmi.simulateContract).toHaveBeenCalledWith(config, {
      address: target.contract,
      abi: collectionAbi,
      functionName: 'airdropNFTs',
      args: call.args,
      value: 200n,
      chainId: 31337,
      account: target.wallet,
    })
    expect(await send()).toBe(HASH)
    expect(wagmi.writeContract).toHaveBeenCalledWith(config, request)
  })

  it("simulates the level call on the validator's address with the validator's ABI and no value", async () => {
    const call = settingsCalls.level(DEFAULT_TRANSFER_VALIDATOR, target.contract, 9)
    await realManageActions(config, target).simulate(call)
    expect(wagmi.simulateContract).toHaveBeenCalledWith(config, {
      address: DEFAULT_TRANSFER_VALIDATOR,
      abi: validatorAbi,
      functionName: 'setTransferSecurityLevelOfCollection',
      args: [target.contract, 9, false, false, false],
      value: undefined,
      chainId: 31337,
      account: target.wallet,
    })
  })
})
