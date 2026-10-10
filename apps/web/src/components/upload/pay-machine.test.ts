import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { TxPhase } from '@/components/deploy/tx-progress'
import {
  CHAIN_NOT_READY,
  NOT_CONFIRMED,
  OTHER_WALLET,
  PAYMENT_USED,
  SHORT_PAYMENT,
  TIMED_OUT,
  type ActionResult,
} from '@/lib/art/result'
import type { RenderJob } from '@/lib/demo/types'
import {
  classifyError,
  forgetPayment,
  isShortPayment,
  payReducer,
  pendingPayment,
  rememberPayment,
  retryHash,
  runPayment,
  type KeyStore,
  type PayDeps,
  type PayEvent,
  type PayInput,
} from './pay-machine'

const PAYER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const FACTORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const HASH: Hex = `0x${'ab'.repeat(32)}`
const OTHER_HASH: Hex = `0x${'cd'.repeat(32)}`

const paidWith = (txHash: Hex): RenderJob => ({
  id: 'job-1',
  jobId: `0x${'11'.repeat(32)}`,
  tokenCount: 2,
  lockedAt: 0,
  tokenListHash: `0x${'22'.repeat(32)}`,
  quote: {
    chainId: 31337,
    perTokenWei: '1',
    tokenCount: 2,
    totalWei: '2',
    payer: PAYER,
    expiresAt: 0,
    factory: FACTORY,
  },
  lockOptions: { allowDuplicates: false },
  placeholder: null,
  state: 'paid',
  payment: { txHash, paidAt: 0, amountWei: '2' },
  batches: { total: 1, done: 0, size: 100 },
})

const input: PayInput = {
  payer: PAYER,
  account: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  chainId: 31337,
  connectedChainId: 31337,
  chainName: 'Anvil',
  factory: FACTORY,
}

function fakeDeps(confirms: ActionResult<RenderJob>[], overrides: Partial<PayDeps> = {}) {
  let clock = 0
  const calls = { simulate: 0, send: 0, confirm: 0, remember: [] as Hex[], forget: 0, sleeps: [] as number[] }
  const deps: PayDeps = {
    simulate: async () => {
      calls.simulate++
      return async () => {
        calls.send++
        return HASH
      }
    },
    wait: async () => 'success',
    confirm: async () => {
      calls.confirm++
      return confirms.shift() ?? { ok: false, error: NOT_CONFIRMED }
    },
    reload: async () => ({ ok: true, data: paidWith(HASH) }),
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

async function run(deps: PayDeps, payInput: PayInput = input) {
  const events: PayEvent[] = []
  const job = await runPayment(payInput, deps, (event) => events.push(event))
  return { job, events, last: events[events.length - 1] }
}

const NOT_YET: ActionResult<RenderJob> = { ok: false, error: NOT_CONFIRMED }

describe('runPayment', () => {
  it('simulates, sends, waits, then polls the server every 3 seconds until it confirms', async () => {
    const { deps, calls } = fakeDeps([NOT_YET, NOT_YET, { ok: true, data: paidWith(HASH) }])
    const { job, events } = await run(deps)
    expect(events.map((event) => event.type)).toEqual([
      'simulating',
      'wallet',
      'confirming',
      'verifying',
      'success',
    ])
    expect(calls.sleeps).toEqual([3_000, 3_000])
    expect(calls.remember).toEqual([HASH])
    expect(calls.forget).toBe(1)
    expect(job?.state).toBe('paid')
  })

  it('checks a payment already sent instead of paying again', async () => {
    const { deps, calls } = fakeDeps([{ ok: true, data: paidWith(HASH) }])
    const { events } = await run(deps, { ...input, sentHash: HASH })
    expect(calls.simulate).toBe(0)
    expect(events.map((event) => event.type)).toEqual(['verifying', 'success'])
  })

  it('never opens the wallet for the wrong wallet, the wrong chain, no wallet or no factory', async () => {
    const cases: [Partial<PayInput>, string][] = [
      [{ account: undefined }, 'Connect your wallet'],
      [{ account: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' }, 'Use the wallet the quote was issued to'],
      [{ connectedChainId: 1 }, 'Switch to Anvil'],
      [{ factory: null }, 'Payments are not open on this network'],
    ]
    for (const [change, title] of cases) {
      const { deps, calls } = fakeDeps([])
      const { last } = await run(deps, { ...input, ...change })
      expect(calls.simulate).toBe(0)
      expect(last).toMatchObject({ type: 'failed', failure: { title } })
    }
    const { deps } = fakeDeps([])
    const { last } = await run(deps, { ...input, factory: null })
    expect(last).toMatchObject({ failure: { message: CHAIN_NOT_READY } })
  })

  it('reports a transaction that reverted on chain and forgets its hash', async () => {
    const { deps, calls } = fakeDeps([], { wait: async () => 'reverted' })
    const { last, job } = await run(deps)
    expect(job).toBeNull()
    expect(last).toMatchObject({
      type: 'failed',
      failure: { kind: 'reverted', title: 'The payment failed on chain' },
    })
    expect(calls.forget).toBe(1)
  })

  it('stops after 2 minutes of "not confirmed yet" and keeps the hash to check again', async () => {
    const { deps, calls } = fakeDeps([])
    const { last } = await run(deps)
    expect(calls.confirm).toBe(41)
    expect(last).toMatchObject({ type: 'failed', failure: { kind: 'unconfirmed', message: TIMED_OUT } })
    expect(calls.forget).toBe(0)
  })

  it('shows a refusal as it is and forgets the hash', async () => {
    const { deps, calls } = fakeDeps([{ ok: false, error: OTHER_WALLET }])
    const { last } = await run(deps)
    expect(last).toMatchObject({ type: 'failed', failure: { kind: 'refused', message: OTHER_WALLET } })
    expect(calls.forget).toBe(1)
  })
})

describe('verifyPayment through runPayment (Review Focus 4)', () => {
  it('treats "already used" as success when the job was paid with this very hash', async () => {
    const { deps } = fakeDeps([{ ok: false, error: PAYMENT_USED }])
    const { last, job } = await run(deps, { ...input, sentHash: HASH })
    expect(last).toEqual({ type: 'success', txHash: HASH })
    expect(job?.state).toBe('paid')
  })

  it('refuses "already used" when the job was paid with another hash', async () => {
    const { deps } = fakeDeps([{ ok: false, error: PAYMENT_USED }], {
      reload: async () => ({ ok: true, data: paidWith(OTHER_HASH) }),
    })
    const { last } = await run(deps, { ...input, sentHash: HASH })
    expect(last).toMatchObject({ type: 'failed', failure: { message: PAYMENT_USED } })
  })
})

describe('classifyError', () => {
  it('reads a wallet rejection anywhere in the cause chain', () => {
    const error = Object.assign(new Error('Request failed'), { cause: { code: 4001 } })
    expect(classifyError(error, 'wallet').kind).toBe('rejected')
    expect(classifyError({ name: 'UserRejectedRequestError' }, 'wallet').kind).toBe('rejected')
  })

  it('reads a balance problem and otherwise names the simulation failure', () => {
    expect(classifyError(new Error('insufficient funds for gas * price + value'), 'simulating').kind).toBe(
      'balance',
    )
    const reverted = classifyError(
      { shortMessage: 'Execution reverted with reason: JobAlreadyPaid.' },
      'simulating',
    )
    expect(reverted.kind).toBe('reverted')
    expect(reverted.message).toContain('JobAlreadyPaid')
  })
})

describe('payReducer and retryHash', () => {
  it('fails at the step it was on and keeps the sent hash', () => {
    const failure = { kind: 'unconfirmed' as const, title: 't', message: 'm' }
    const confirming = payReducer({ step: 'idle' }, { type: 'confirming', txHash: HASH })
    const failed = payReducer(confirming, { type: 'failed', failure })
    expect(failed).toEqual({ step: 'failed', at: 'confirming', failure, txHash: HASH })
    expect(payReducer({ step: 'idle' }, { type: 'failed', failure })).toEqual({
      step: 'failed',
      at: 'simulating',
      failure,
    })
    expect(retryHash(failed)).toBe(HASH)
    const refused: TxPhase = {
      step: 'failed',
      at: 'verifying',
      failure: { ...failure, kind: 'refused' },
      txHash: HASH,
    }
    expect(retryHash(refused)).toBeUndefined()
    expect(retryHash({ step: 'idle' })).toBeUndefined()
  })
})

describe('the pending payment kept in the browser (Review Focus 1)', () => {
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

  it('remembers a sent hash per job until it is forgotten', () => {
    const store = memoryStore()
    rememberPayment(store, 'job-1', HASH)
    expect(pendingPayment(store, 'job-1')).toBe(HASH)
    expect(pendingPayment(store, 'job-2')).toBeNull()
    forgetPayment(store, 'job-1')
    expect(pendingPayment(store, 'job-1')).toBeNull()
  })

  it('ignores a value that is not a hash and a store that throws', () => {
    const store = memoryStore()
    store.setItem('cobweb-art-payment:job-1', 'nonsense')
    expect(pendingPayment(store, 'job-1')).toBeNull()
    expect(() => rememberPayment(blocked, 'job-1', HASH)).not.toThrow()
    expect(pendingPayment(blocked, 'job-1')).toBeNull()
    expect(pendingPayment(null, 'job-1')).toBeNull()
  })
})

describe('a short payment (the server records it and refuses with a sentence)', () => {
  it('shows the whole sentence, forgets the local hash and tells it from other refusals', async () => {
    const sentence = `${SHORT_PAYMENT} Tell support about job 0x11.`
    const { deps, calls } = fakeDeps([{ ok: false, error: sentence }])
    const { last } = await run(deps, { ...input, sentHash: HASH })
    expect(last).toMatchObject({
      type: 'failed',
      failure: { kind: 'refused', title: 'The payment was less than the quote', message: sentence },
    })
    expect(calls.forget).toBe(1)
    expect(isShortPayment(sentence)).toBe(true)
    expect(isShortPayment(OTHER_WALLET)).toBe(false)
  })
})

describe('rechecking a short payment and keeping a timed-out hash', () => {
  const shortJob = (): RenderJob => ({
    ...paidWith(HASH),
    state: 'payment_due',
    payment: { txHash: HASH, paidAt: 0, amountWei: '1' },
  })

  it('does not report success when the recorded hash belongs to a job still awaiting payment', async () => {
    const { deps } = fakeDeps([{ ok: false, error: PAYMENT_USED }], {
      reload: async () => ({ ok: true, data: shortJob() }),
    })
    const { last, job } = await run(deps, { ...input, sentHash: HASH })
    expect(job).toBeNull()
    expect(last).toMatchObject({ type: 'failed', failure: { kind: 'refused' } })
    const message = (last as { failure: { message: string } }).failure.message
    expect(isShortPayment(message)).toBe(true)
    expect(message.endsWith(`Tell support about job 0x${'11'.repeat(32)}.`)).toBe(true)
  })

  it('carries the hash in a timed-out phase, so Unlock stays guarded without storage', async () => {
    const { deps } = fakeDeps([])
    let phase: TxPhase = { step: 'idle' }
    await runPayment(input, deps, (event) => {
      phase = payReducer(phase, event)
    })
    expect(retryHash(phase)).toBe(HASH)
  })

  it('treats a receipt that cannot be read as unconfirmed, keeping the hash', async () => {
    const { deps, calls } = fakeDeps([], {
      wait: async () => {
        throw new Error('timeout')
      },
    })
    let phase: TxPhase = { step: 'idle' }
    await runPayment(input, deps, (event) => {
      phase = payReducer(phase, event)
    })
    expect(retryHash(phase)).toBe(HASH)
    expect(calls.forget).toBe(0)
  })
})
