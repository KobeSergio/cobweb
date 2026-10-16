import type { Address, Hex } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { MintParams } from '@/lib/mint/mint-call'
import { runMint, type MintChain } from '@/lib/mint/mint-run'
import { flowRuns, MintCancelled } from './use-mint-flow'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ACCOUNT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const HASH: Hex = `0x${'cd'.repeat(32)}`
const params: MintParams = {
  contract: CONTRACT,
  chainId: 31337,
  groupId: 0,
  amount: 1,
  vault: null,
  valueWei: 1_000n,
  account: ACCOUNT,
}

describe("the mint flow's runs (final fix wave O5)", () => {
  it('keep only the latest run alive, and none once the flow closes', () => {
    const runs = flowRuns()
    const first = runs.begin()
    expect(first()).toBe(true)
    const second = runs.begin()
    expect([first(), second()]).toEqual([false, true])
    runs.close()
    expect(second()).toBe(false)
  })

  it('end a run closed during its check at the wallet step, as the hook wires it: nothing is sent', async () => {
    const runs = flowRuns()
    const alive = runs.begin()
    const send = vi.fn(async () => HASH)
    const chain: MintChain = {
      // The visitor closes the flow while the check runs.
      simulate: async () => {
        runs.close()
        return send
      },
      receipt: vi.fn(async () => {
        throw new Error('no receipt is read')
      }),
    }
    const wallet = vi.fn(() => {
      if (!alive()) throw new MintCancelled()
    })
    const live = { isLive: () => true, nextAnswer: async () => {} }
    await expect(runMint(chain, params, live, { wallet, sent: vi.fn() })).rejects.toBeInstanceOf(
      MintCancelled,
    )
    expect(wallet).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
    expect(chain.receipt).not.toHaveBeenCalled()
  })
})
