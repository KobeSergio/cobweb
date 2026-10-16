import type { Address, Hex } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { MintParams } from '@/lib/mint/mint-call'
import { runMint, type MintChain } from '@/lib/mint/mint-run'
import type { MintAction } from './model'
import { flowRuns, MintCancelled, retryOffered } from './use-mint-flow'

const CONTRACT: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const ACCOUNT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VAULT: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const OTHER_VAULT: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
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

describe('retryOffered (fix wave 2 W1)', () => {
  const mint: Pick<MintAction, 'kind'> = { kind: 'mint' }
  // Holders (group 1) failed with a vault; the panel may have moved on since.
  const failed: MintParams = { ...params, groupId: 1, vault: VAULT }

  it('sends the mint again on the same phase with the same vault, in any case of the address', () => {
    expect(retryOffered(mint, 1, VAULT, failed)).toBe(true)
    expect(retryOffered(mint, 1, VAULT.toLowerCase() as Address, failed)).toBe(true)
    expect(retryOffered(mint, 0, null, params)).toBe(true)
    // The panel offers no mint (a switch, a limit, a closed phase): the flow closes.
    expect(retryOffered({ kind: 'blocked' }, 1, VAULT, failed)).toBe(false)
  })

  it('closes the flow once the panel moved to another phase, such as Public after Holders sold out', () => {
    expect(retryOffered(mint, 0, VAULT, failed)).toBe(false)
    expect(retryOffered(mint, null, VAULT, failed)).toBe(false)
  })

  it('closes the flow for another vault, or for the wallet itself in place of the vault', () => {
    expect(retryOffered(mint, 1, OTHER_VAULT, failed)).toBe(false)
    expect(retryOffered(mint, 1, null, failed)).toBe(false)
    expect(retryOffered(mint, 0, VAULT, params)).toBe(false)
  })
})
