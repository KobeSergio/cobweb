import { collectionAbi } from '@cobweb/shared/collection-abi'
import { ContractFunctionRevertedError, encodeErrorResult, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { deployReducer, retryHash, type DeployEvent, type KeyStore } from '@/components/deploy/deploy-machine'
import type { TxPhase } from '@/components/deploy/tx-progress'
import {
  CHAIN_NOT_READY,
  NOT_FOUND,
  NOT_FROM_WALLET,
  NOT_THIS_CHANGE,
  NOT_THIS_CONTRACT,
  PHASE_NAME_TAKEN,
  PHASE_NOT_CONFIRMED,
  PHASE_REVERTED,
  PHASE_TIMED_OUT,
  SIGNED_OUT,
  THROWN,
  UNSAVED,
  type ActionResult,
} from '@/lib/art/result'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import {
  forgetAdd,
  pendingAdd,
  rememberAdd,
  runManage,
  type ManageDeps,
  type ManageInput,
  type PendingAdd,
} from './manage-machine'

const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const HASH: Hex = `0x${'ab'.repeat(32)}`
const VIEW = 'the fresh view'
const NOT_YET: ActionResult<string> = { ok: false, error: PHASE_NOT_CONFIRMED }

const input: ManageInput = {
  call: phaseCalls.open(1),
  account: WALLET.toLowerCase(),
  wallet: WALLET,
  chainId: 31337,
  connectedChainId: 31337,
}

function fakeDeps(confirms: ActionResult<string>[], overrides: Partial<ManageDeps<string>> = {}) {
  let clock = 0
  const calls = {
    switchChain: [] as number[],
    simulated: [] as (ManageCall | null)[],
    send: 0,
    confirm: 0,
    remember: [] as Hex[],
    forget: 0,
    sleeps: [] as number[],
  }
  const deps: ManageDeps<string> = {
    switchChain: async (chainId) => {
      calls.switchChain.push(chainId)
    },
    simulate: async (call) => {
      calls.simulated.push(call)
      return async () => {
        calls.send++
        return HASH
      }
    },
    wait: async () => 'success',
    confirm: async () => {
      calls.confirm++
      return confirms.shift() ?? NOT_YET
    },
    remember: (hash) => {
      calls.remember.push(hash)
    },
    forget: () => {
      calls.forget++
    },
    sleep: async (ms) => {
      calls.sleeps.push(ms)
      clock += ms
    },
    now: () => clock,
    ...overrides,
  }
  return { deps, calls }
}

async function run(deps: ManageDeps<string>, manageInput: ManageInput = input) {
  const events: DeployEvent[] = []
  let phase: TxPhase = { step: 'idle' }
  const result = await runManage(manageInput, deps, (event) => {
    events.push(event)
    phase = deployReducer(phase, event)
  })
  return { result, events, last: events[events.length - 1], phase }
}

describe('runManage', () => {
  it('simulates, sends, waits, then polls the server every 3 seconds until it confirms, and answers the view', async () => {
    const { deps, calls } = fakeDeps([NOT_YET, NOT_YET, { ok: true, data: VIEW }])
    const { result, events } = await run(deps)
    expect(events.map((event) => event.type)).toEqual([
      'simulating',
      'wallet',
      'confirming',
      'verifying',
      'success',
    ])
    expect(calls.simulated).toEqual([phaseCalls.open(1)])
    expect(calls.switchChain).toEqual([])
    expect(calls.sleeps).toEqual([3_000, 3_000])
    expect(result).toBe(VIEW)
  })

  it('switches the wallet first when it is on another chain', async () => {
    const { deps, calls } = fakeDeps([{ ok: true, data: VIEW }])
    const { events } = await run(deps, { ...input, connectedChainId: 1 })
    expect(events.map((event) => event.type)).toEqual([
      'switching',
      'simulating',
      'wallet',
      'confirming',
      'verifying',
      'success',
    ])
    expect(calls.switchChain).toEqual([31337])
  })

  it('never opens the wallet without an account, or for an account that is not the sign-in wallet', async () => {
    const noWallet = fakeDeps([])
    const first = await run(noWallet.deps, { ...input, account: undefined })
    expect(noWallet.calls.simulated).toEqual([])
    expect(first.last).toEqual({
      type: 'failed',
      failure: {
        kind: 'refused',
        title: 'Connect your wallet',
        message: 'Connect your wallet to make this change. Nothing was sent.',
      },
    })

    const other = fakeDeps([])
    const second = await run(other.deps, { ...input, account: STRANGER })
    expect(other.calls.simulated).toEqual([])
    expect(other.calls.switchChain).toEqual([])
    expect(second.last).toEqual({
      type: 'failed',
      failure: {
        kind: 'refused',
        title: 'Use your sign-in wallet',
        message: `Cobweb checks changes sent from ${WALLET}, your sign-in wallet. Switch to that account in your wallet, then try again.`,
      },
    })
  })

  it('a rejected switch simulates nothing and sends nothing', async () => {
    const { deps, calls } = fakeDeps([], {
      switchChain: async () => {
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      },
    })
    const { last, phase } = await run(deps, { ...input, connectedChainId: 1 })
    expect(calls.simulated).toEqual([])
    expect(calls.send).toBe(0)
    expect(last).toMatchObject({
      type: 'failed',
      failure: { kind: 'switch', title: 'Network switch cancelled' },
    })
    expect(phase).toMatchObject({ step: 'failed', at: 'switching' })
  })

  it("a simulation revert sends nothing and reads as the contract's sentence", async () => {
    const { deps, calls } = fakeDeps([], {
      simulate: async () => {
        throw new ContractFunctionRevertedError({
          abi: collectionAbi,
          data: encodeErrorResult({ abi: collectionAbi, errorName: 'BelowMinted', args: [1n] }),
          functionName: 'setMintGroupMaxSupply',
        })
      },
    })
    const { last, phase } = await run(deps, { ...input, call: phaseCalls.allocation(0, 0) })
    expect(calls.send).toBe(0)
    expect(calls.remember).toEqual([])
    expect(last).toEqual({
      type: 'failed',
      failure: {
        kind: 'reverted',
        title: 'The change would fail',
        message: 'It cannot go below 1, the tokens this phase has already minted. Nothing was sent.',
      },
    })
    expect(phase).toMatchObject({ step: 'failed', at: 'simulating' })
  })

  it('a rejection in the wallet reads as cancelled and remembers nothing', async () => {
    const { deps, calls } = fakeDeps([], {
      simulate: async () => async () => {
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      },
    })
    const { last } = await run(deps)
    expect(last).toMatchObject({
      type: 'failed',
      failure: { kind: 'rejected', title: 'Cancelled in your wallet' },
    })
    expect(calls.remember).toEqual([])
  })

  it('reports a change that reverted on chain and forgets a remembered add', async () => {
    const { deps, calls } = fakeDeps([], { wait: async () => 'reverted' })
    const { last, result } = await run(deps, { ...input, call: phaseCalls.register(2, '0', 1, 0), addId: 2 })
    expect(result).toBeNull()
    expect(calls.remember).toEqual([HASH])
    expect(calls.forget).toBe(1)
    expect(last).toEqual({
      type: 'failed',
      failure: {
        kind: 'reverted',
        title: 'The change failed on chain',
        message:
          'The transaction was included but reverted, so nothing changed. You paid gas only. Try again.',
      },
    })
  })

  it('a wait that throws keeps the sent hash to check again', async () => {
    const { deps, calls } = fakeDeps([], {
      wait: async () => {
        throw new Error('timeout')
      },
    })
    const { last, phase } = await run(deps)
    expect(last).toMatchObject({ type: 'failed', failure: { kind: 'unconfirmed' } })
    expect(calls.confirm).toBe(0)
    expect(calls.forget).toBe(0)
    expect(retryHash(phase)).toBe(HASH)
  })

  it('stops after 2 minutes of "not confirmed yet" and keeps the hash to check again', async () => {
    const { deps, calls } = fakeDeps([])
    const { last, phase } = await run(deps)
    expect(calls.confirm).toBe(41)
    expect(last).toEqual({
      type: 'failed',
      failure: { kind: 'unconfirmed', title: 'Change not confirmed yet', message: PHASE_TIMED_OUT },
    })
    expect(calls.forget).toBe(0)
    expect(retryHash(phase)).toBe(HASH)
  })

  it.each([PHASE_REVERTED, NOT_THIS_CONTRACT, NOT_FROM_WALLET, NOT_THIS_CHANGE])(
    'a terminal answer (%s) is shown as it is and forgets a remembered add',
    async (error) => {
      const { deps, calls } = fakeDeps([{ ok: false, error }])
      const { last, phase } = await run(deps)
      expect(last).toEqual({
        type: 'failed',
        failure: { kind: 'refused', title: 'Cobweb could not confirm this change', message: error },
      })
      expect(calls.forget).toBe(1)
      expect(retryHash(phase)).toBeUndefined()
    },
  )

  it('a taken name after an add says where the phase is, and forgets the add', async () => {
    const { deps, calls } = fakeDeps([{ ok: false, error: PHASE_NAME_TAKEN }])
    const { last } = await run(deps, { ...input, call: phaseCalls.register(2, '0', 1, 0), addId: 2 })
    expect(last).toMatchObject({
      type: 'failed',
      failure: {
        kind: 'refused',
        message: 'The phase is on the contract as Group 2, but its name is taken. Name it from its menu.',
      },
    })
    expect(calls.forget).toBe(1)
  })

  it.each([SIGNED_OUT, THROWN, UNSAVED, CHAIN_NOT_READY, NOT_FOUND])(
    'a transient answer (%s) keeps the hash to check again',
    async (error) => {
      const { deps, calls } = fakeDeps([{ ok: false, error }])
      const { phase } = await run(deps)
      expect(phase).toMatchObject({ step: 'failed', failure: { kind: 'unconfirmed', message: error } })
      expect(retryHash(phase)).toBe(HASH)
      expect(calls.forget).toBe(0)
    },
  )

  it('a confirm that throws is transient', async () => {
    const { deps } = fakeDeps([], {
      confirm: async () => {
        throw new Error('fetch failed')
      },
    })
    const { last } = await run(deps)
    expect(last).toMatchObject({ type: 'failed', failure: { kind: 'unconfirmed', message: THROWN } })
  })

  it('checks a remembered add instead of sending it again, with no wallet or chain needed', async () => {
    const { deps, calls } = fakeDeps([{ ok: true, data: VIEW }])
    const { events, result } = await run(deps, {
      ...input,
      call: null,
      account: undefined,
      connectedChainId: undefined,
      sentHash: HASH,
      addId: 2,
    })
    expect(events.map((event) => event.type)).toEqual(['verifying', 'success'])
    expect(calls.simulated).toEqual([])
    expect(calls.switchChain).toEqual([])
    expect(calls.forget).toBe(1)
    expect(result).toBe(VIEW)
  })

  it("remembers an add's hash when the wallet sends it and forgets it once confirmed", async () => {
    const { deps, calls } = fakeDeps([{ ok: true, data: VIEW }])
    await run(deps, { ...input, call: phaseCalls.register(2, '0', 1, 0), addId: 2 })
    expect(calls.remember).toEqual([HASH])
    expect(calls.forget).toBe(1)
  })

  it('passes a null call to the simulation (a tab still on sample data)', async () => {
    const { deps, calls } = fakeDeps([{ ok: true, data: VIEW }])
    await run(deps, { ...input, call: null })
    expect(calls.simulated).toEqual([null])
  })
})

describe('the pending add kept in the browser', () => {
  function memoryStore(): KeyStore {
    const map = new Map<string, string>()
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value)
      },
      removeItem: (key) => {
        map.delete(key)
      },
    }
  }
  const blocked: KeyStore = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }
  const pending: PendingAdd = {
    hash: HASH,
    form: { onchainId: 2, name: 'Allowlist', description: 'Friends of the project.', visible: false },
  }

  it('remembers the sent hash and the form per collection until they are forgotten', () => {
    const store = memoryStore()
    rememberAdd(store, 'col-1', pending)
    expect(pendingAdd(store, 'col-1')).toEqual(pending)
    expect(pendingAdd(store, 'col-2')).toBeNull()
    expect(store.getItem('cobweb-phase:col-1')).toContain(HASH)
    forgetAdd(store, 'col-1')
    expect(pendingAdd(store, 'col-1')).toBeNull()
  })

  it('ignores a stored value that is not a pending add, and a store that throws', () => {
    const store = memoryStore()
    for (const value of [
      'nonsense',
      JSON.stringify({ hash: 'not-a-hash', form: pending.form }),
      JSON.stringify({ hash: HASH }),
      JSON.stringify({ hash: HASH, form: { ...pending.form, onchainId: 0 } }),
      JSON.stringify({ hash: HASH, form: { ...pending.form, name: '' } }),
      JSON.stringify({ hash: HASH, form: { ...pending.form, visible: 'no' } }),
    ]) {
      store.setItem('cobweb-phase:col-1', value)
      expect(pendingAdd(store, 'col-1')).toBeNull()
    }
    expect(() => rememberAdd(blocked, 'col-1', pending)).not.toThrow()
    expect(pendingAdd(blocked, 'col-1')).toBeNull()
    expect(pendingAdd(null, 'col-1')).toBeNull()
    expect(() => forgetAdd(null, 'col-1')).not.toThrow()
  })
})
