import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  encodeEventTopics,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { MintCall, MintParams } from './mint-call'
import { MintFailure } from './mint-failure'
import { runMint, type MintChain } from './mint-run'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ACCOUNT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const HASH: Hex = `0x${'cd'.repeat(32)}`
const REPLACEMENT: Hex = `0x${'ef'.repeat(32)}`
const params: MintParams = {
  contract: CONTRACT,
  chainId: 31337,
  groupId: 0,
  amount: 2,
  vault: null,
  valueWei: 2_000n,
  account: ACCOUNT,
}

const inactive = () => {
  const data = encodeErrorResult({ abi: collectionAbi, errorName: 'MintGroupInactive', args: [0n] })
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: collectionAbi, data, functionName: 'batchMint' }),
    { abi: collectionAbi, functionName: 'batchMint', args: [2n, 0n], contractAddress: CONTRACT },
  )
}
const minted = (ids: number[], status: 'success' | 'reverted' = 'success'): TransactionReceipt =>
  ({
    status,
    blockNumber: 77n,
    logs: ids.map((id) => ({
      address: CONTRACT,
      data: '0x',
      topics: encodeEventTopics({
        abi: collectionAbi,
        eventName: 'Transfer',
        args: { from: zeroAddress, to: ACCOUNT, tokenId: BigInt(id) },
      }),
    })),
  }) as unknown as TransactionReceipt

/** A chain whose simulation answers from the queue: an error is thrown, a function is the send. */
function fakeChain(simulations: (Error | (() => Promise<Hex>))[], receipt = minted([4, 5])) {
  const calls: MintCall[] = []
  const chain: MintChain = {
    simulate: vi.fn(async (call: MintCall) => {
      calls.push(call)
      const next = simulations.shift()
      if (!next || next instanceof Error) throw next ?? new Error('no simulation')
      return next
    }),
    receipt: vi.fn(async () => receipt),
  }
  return { chain, calls }
}
const steps = () => ({ wallet: vi.fn(), sent: vi.fn() })
const live = (isLive: boolean) => ({ isLive: vi.fn(() => isLive), nextAnswer: vi.fn(async () => {}) })

describe('runMint (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5)', () => {
  it('opens no wallet and sends nothing when the simulation throws', async () => {
    const send = vi.fn(async () => HASH)
    const { chain } = fakeChain([new Error('execution reverted'), send])
    const step = steps()
    await expect(runMint(chain, params, live(false), step)).rejects.toMatchObject({ kind: 'check-failed' })
    expect(step.wallet).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('a wallet step that throws never sends', async () => {
    // A flow closed during the check throws from its wallet step (components/mint/use-mint-flow.ts): the run ends
    // there, so the wallet never opens and nothing is sent (Task 5 fix round 1).
    const send = vi.fn(async () => HASH)
    const { chain } = fakeChain([send])
    const closed = new Error('closed during the check')
    const step = {
      wallet: vi.fn(() => {
        throw closed
      }),
      sent: vi.fn(),
    }
    await expect(runMint(chain, params, live(true), step)).rejects.toBe(closed)
    expect(step.wallet).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
    expect(step.sent).not.toHaveBeenCalled()
    expect(chain.receipt).not.toHaveBeenCalled()
  })

  it('sends with the function the simulation answered, then reads the ids and the block from the receipt', async () => {
    const send = vi.fn(async () => HASH)
    const { chain, calls } = fakeChain([send])
    const step = steps()
    const result = await runMint(chain, params, live(true), step)
    expect(result).toEqual({ hash: HASH, tokenIds: [4, 5], block: 77 })
    expect(send).toHaveBeenCalledOnce()
    expect(step.wallet).toHaveBeenCalledOnce()
    expect(step.sent).toHaveBeenCalledWith(HASH)
    expect([calls[0]?.functionName, calls[0]?.args, calls[0]?.value]).toEqual(['batchMint', [2n, 0n], 2_000n])
    expect(chain.receipt).toHaveBeenCalledWith(HASH, 31337, expect.any(Function))
  })

  it('waits for the next answer and checks once more when the group reads live but the check finds it inactive', async () => {
    const send = vi.fn(async () => HASH)
    const { chain } = fakeChain([inactive(), send])
    const state = live(true)
    await expect(runMint(chain, params, state, steps())).resolves.toMatchObject({ tokenIds: [4, 5] })
    expect(state.nextAnswer).toHaveBeenCalledOnce()
    expect(chain.simulate).toHaveBeenCalledTimes(2)
  })

  it('does not check again when the group does not read live, nor more than once (Review Focus 3)', async () => {
    const notLive = fakeChain([inactive(), vi.fn(async () => HASH)])
    const closed = live(false)
    await expect(runMint(notLive.chain, params, closed, steps())).rejects.toMatchObject({
      kind: 'phase-closed',
    })
    expect(closed.nextAnswer).not.toHaveBeenCalled()
    const twice = fakeChain([inactive(), inactive(), vi.fn(async () => HASH)])
    await expect(runMint(twice.chain, params, live(true), steps())).rejects.toMatchObject({
      kind: 'phase-closed',
    })
    expect(twice.chain.simulate).toHaveBeenCalledTimes(2)
  })

  it('throws reverted for a reverted receipt, with the hash', async () => {
    const { chain } = fakeChain([vi.fn(async () => HASH)], minted([], 'reverted'))
    const failure = await runMint(chain, params, live(true), steps()).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(MintFailure)
    expect(failure).toMatchObject({ kind: 'reverted', detail: { hash: HASH } })
  })

  it("returns the mined transaction's hash when the wallet replaced it, a cancel as a success without ids (fix round 1, item 4)", async () => {
    /** A chain whose wallet replaced the sent transaction with one that has this receipt. */
    const replacing = (receipt: TransactionReceipt): MintChain => ({
      simulate: async () => async () => HASH,
      receipt: async (_hash, _chainId, replaced) => {
        replaced?.(REPLACEMENT)
        return receipt
      },
    })
    const step = steps()
    await expect(runMint(replacing(minted([4, 5])), params, live(true), step)).resolves.toEqual({
      hash: REPLACEMENT,
      tokenIds: [4, 5],
      block: 77,
    })
    expect(step.sent).toHaveBeenCalledWith(HASH)
    await expect(runMint(replacing(minted([])), params, live(true), steps())).resolves.toEqual({
      hash: REPLACEMENT,
      tokenIds: [],
      block: 77,
    })
    await expect(
      runMint(replacing(minted([], 'reverted')), params, live(true), steps()),
    ).rejects.toMatchObject({
      kind: 'reverted',
      detail: { hash: REPLACEMENT },
    })
  })
})
