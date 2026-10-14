import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  ALREADY_DEPLOYED,
  CHAIN_NOT_READY,
  DEPLOY_NOT_CONFIRMED,
  DEPLOY_REVERTED,
  DEPLOY_TIMED_OUT,
  DEPLOY_USED,
  LINK_REQUIRED,
  NOT_FOUND,
  NOT_THIS_DEPLOY,
  OTHER_CODE,
  OTHER_CONTRACT,
  SIGNED_OUT,
  THROWN,
  UNSAVED,
  type ActionResult,
} from '@/lib/art/result'
import { toWei } from '@/lib/demo/helpers'
import type { DeployForm, DeployRecord, Prepared } from '@/lib/deploy/deploy-types'
import {
  deployReducer,
  forgetDeploy,
  pendingDeploy,
  rememberDeploy,
  retryHash,
  runDeploy,
  sentSettings,
  type DeployDeps,
  type DeployEvent,
  type DeployInput,
  type KeyStore,
  type PendingDeploy,
} from './deploy-machine'
import type { TxPhase } from './tx-progress'

const DEPLOYER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const STRANGER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const FACTORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const HASH: Hex = `0x${'ab'.repeat(32)}`

const form: DeployForm = {
  chainId: 31337,
  payout: DEPLOYER,
  royaltyBps: 500,
  royaltyReceiver: DEPLOYER,
  publicMaxPerWallet: 3,
  groups: [{ name: 'Public', priceWei: '0', maxSupply: 777 }],
}

const prepared: Prepared = {
  chainId: 31337,
  factory: FACTORY,
  deployer: DEPLOYER,
  salt: `0x${'0f'.repeat(16)}${'0'.repeat(32)}`,
  codeHash: `0x${'a5'.repeat(32)}`,
  args: {
    name: 'Night Owls',
    symbol: 'OWLS',
    payout: DEPLOYER,
    baseUri: 'ipfs://start/',
    maxSupply: '777',
    groupSupplies: ['777'],
    groupPrices: ['0'],
    publicMaxPerWallet: '3',
    royaltyBps: 500,
    owner: DEPLOYER,
    royaltyReceiver: DEPLOYER,
  },
  groups: form.groups,
  encodedArgs: '0x',
  predicted: '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85',
  baseUri: 'ipfs://start/',
  revealsTo: null,
  fees: { mintFeeFlatWei: '0', mintFeeBps: 0, airdropFeePerTokenWei: '0' },
}

const record: DeployRecord = {
  chainId: 31337,
  contractAddress: prepared.predicted,
  txHash: HASH,
  deployer: DEPLOYER,
  deployedAt: 1_791_000_000,
  baseUri: 'ipfs://start/',
  payout: DEPLOYER,
  royaltyBps: 500,
  royaltyReceiver: DEPLOYER,
  publicMaxPerWallet: 3,
  fees: prepared.fees,
  groups: [{ onchainId: 0, name: 'Public', priceWei: '0', maxSupply: 777 }],
}

const input: DeployInput = { form, account: DEPLOYER, connectedChainId: 31337 }
const NOT_YET: ActionResult<DeployRecord> = { ok: false, error: DEPLOY_NOT_CONFIRMED }

function fakeDeps(confirms: ActionResult<DeployRecord>[], overrides: Partial<DeployDeps> = {}) {
  let clock = 0
  const calls = {
    prepare: 0,
    switchChain: [] as number[],
    simulate: 0,
    send: 0,
    confirm: 0,
    remember: [] as PendingDeploy[],
    forget: 0,
    sleeps: [] as number[],
  }
  const deps: DeployDeps = {
    prepare: async () => {
      calls.prepare++
      return { ok: true, data: prepared }
    },
    switchChain: async (chainId) => {
      calls.switchChain.push(chainId)
    },
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
      return confirms.shift() ?? NOT_YET
    },
    remember: (hash, remembered) => {
      calls.remember.push({ hash, form: remembered })
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

async function run(deps: DeployDeps, deployInput: DeployInput = input) {
  const events: DeployEvent[] = []
  let phase: TxPhase = { step: 'idle' }
  const result = await runDeploy(deployInput, deps, (event) => {
    events.push(event)
    phase = deployReducer(phase, event)
  })
  return { result, events, last: events[events.length - 1], phase }
}

describe('runDeploy', () => {
  it('prepares, simulates, sends, waits, then polls the server every 3 seconds until it records', async () => {
    const { deps, calls } = fakeDeps([NOT_YET, NOT_YET, { ok: true, data: record }])
    const { result, events } = await run(deps)
    expect(events.map((event) => event.type)).toEqual([
      'preparing',
      'simulating',
      'wallet',
      'confirming',
      'verifying',
      'success',
    ])
    expect(calls.prepare).toBe(1)
    expect(calls.switchChain).toEqual([])
    expect(calls.sleeps).toEqual([3_000, 3_000])
    expect(calls.remember).toEqual([{ hash: HASH, form }])
    expect(calls.forget).toBe(1)
    expect(result).toEqual(record)
  })

  it('switches the wallet first when it is on another chain, and never deploys there (Review Focus 2)', async () => {
    const { deps, calls } = fakeDeps([{ ok: true, data: record }])
    const { events, result } = await run(deps, { ...input, connectedChainId: 1 })
    expect(events.map((event) => event.type)).toEqual([
      'preparing',
      'switching',
      'simulating',
      'wallet',
      'confirming',
      'verifying',
      'success',
    ])
    expect(calls.switchChain).toEqual([31337])
    expect(result).toEqual(record)
  })

  it('checks a deploy already sent instead of deploying again', async () => {
    const { deps, calls } = fakeDeps([{ ok: true, data: record }])
    const { events } = await run(deps, { ...input, sentHash: HASH })
    expect(calls.prepare).toBe(0)
    expect(calls.simulate).toBe(0)
    expect(events.map((event) => event.type)).toEqual(['verifying', 'success'])
  })

  it('never opens the wallet without an account, for an account that is not the sign-in wallet, or when the server refuses to prepare (Review Focus 4)', async () => {
    const noWallet = fakeDeps([])
    const first = await run(noWallet.deps, { ...input, account: undefined })
    expect(noWallet.calls.prepare).toBe(0)
    expect(first.last).toMatchObject({
      type: 'failed',
      failure: { kind: 'refused', title: 'Connect your wallet' },
    })

    const other = fakeDeps([])
    const second = await run(other.deps, { ...input, account: STRANGER })
    expect(other.calls.simulate).toBe(0)
    expect(second.last).toMatchObject({
      type: 'failed',
      failure: { kind: 'refused', title: 'Use your sign-in wallet' },
    })

    const refused = fakeDeps([], { prepare: async () => ({ ok: false, error: LINK_REQUIRED }) })
    const third = await run(refused.deps)
    expect(refused.calls.simulate).toBe(0)
    expect(third.last).toMatchObject({ type: 'failed', failure: { kind: 'refused', message: LINK_REQUIRED } })
    expect(third.phase).toMatchObject({ step: 'failed', at: 'preparing' })

    const thrown = fakeDeps([], {
      prepare: async () => {
        throw new Error('fetch failed')
      },
    })
    const fourth = await run(thrown.deps)
    expect(fourth.last).toMatchObject({ type: 'failed', failure: { kind: 'refused', message: THROWN } })
  })

  it('a rejected switch simulates nothing, sends nothing and remembers nothing (Review Focus 4)', async () => {
    const { deps, calls } = fakeDeps([], {
      switchChain: async () => {
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      },
    })
    const { last, phase } = await run(deps, { ...input, connectedChainId: 1 })
    expect(calls.simulate).toBe(0)
    expect(calls.send).toBe(0)
    expect(calls.remember).toEqual([])
    expect(last).toMatchObject({
      type: 'failed',
      failure: { kind: 'switch', title: 'Network switch cancelled' },
    })
    expect(phase).toMatchObject({ step: 'failed', at: 'switching' })
  })

  it('reports a transaction that reverted on chain and forgets its hash', async () => {
    const { deps, calls } = fakeDeps([], { wait: async () => 'reverted' })
    const { last, result } = await run(deps)
    expect(result).toBeNull()
    expect(last).toMatchObject({
      type: 'failed',
      failure: { kind: 'reverted', title: 'The deploy failed on chain' },
    })
    expect(calls.forget).toBe(1)
  })

  it('stops after 2 minutes of "not confirmed yet" and keeps the hash to check again', async () => {
    const { deps, calls } = fakeDeps([])
    const { last, phase } = await run(deps)
    expect(calls.confirm).toBe(41)
    expect(last).toMatchObject({
      type: 'failed',
      failure: { kind: 'unconfirmed', message: DEPLOY_TIMED_OUT },
    })
    expect(calls.forget).toBe(0)
    expect(retryHash(phase)).toBe(HASH)
  })

  it.each([NOT_THIS_DEPLOY, OTHER_CODE, OTHER_CONTRACT, DEPLOY_REVERTED, DEPLOY_USED, ALREADY_DEPLOYED])(
    'a terminal refusal (%s) is shown as it is and forgets the hash',
    async (error) => {
      const { deps, calls } = fakeDeps([{ ok: false, error }])
      const { last } = await run(deps, { ...input, sentHash: HASH })
      expect(last).toMatchObject({ type: 'failed', failure: { kind: 'refused', message: error } })
      expect(calls.forget).toBe(1)
    },
  )

  it('a prepare refusal on confirm (the link lapsed meanwhile) keeps the hash and stays checkable (Review Focus 3)', async () => {
    const { deps, calls } = fakeDeps([{ ok: false, error: LINK_REQUIRED }])
    const { last, phase } = await run(deps)
    expect(last).toMatchObject({ type: 'failed', failure: { kind: 'unconfirmed', message: LINK_REQUIRED } })
    expect(calls.remember).toEqual([{ hash: HASH, form }])
    expect(calls.forget).toBe(0)
    expect(retryHash(phase)).toBe(HASH)
  })

  it.each([SIGNED_OUT, THROWN, UNSAVED, CHAIN_NOT_READY, NOT_FOUND])(
    'a transient refusal (%s) keeps the hash and stays checkable',
    async (error) => {
      const { deps, calls } = fakeDeps([{ ok: false, error }])
      const { phase } = await run(deps)
      expect(phase).toMatchObject({ step: 'failed', failure: { kind: 'unconfirmed', message: error } })
      expect(retryHash(phase)).toBe(HASH)
      expect(calls.forget).toBe(0)
    },
  )

  it('a wait that throws keeps the sent hash and offers a check; a confirm that throws is transient too', async () => {
    const waitThrows = fakeDeps([], {
      wait: async () => {
        throw new Error('timeout')
      },
    })
    const first = await run(waitThrows.deps)
    expect(first.last).toMatchObject({ type: 'failed', failure: { kind: 'unconfirmed' } })
    expect(waitThrows.calls.remember).toEqual([{ hash: HASH, form }])
    expect(waitThrows.calls.forget).toBe(0)
    expect(waitThrows.calls.confirm).toBe(0)

    const confirmThrows = fakeDeps([], {
      confirm: async () => {
        throw new Error('fetch failed')
      },
    })
    const second = await run(confirmThrows.deps, { ...input, sentHash: HASH })
    expect(second.last).toMatchObject({ type: 'failed', failure: { kind: 'unconfirmed', message: THROWN } })
    expect(confirmThrows.calls.forget).toBe(0)
  })

  it('a simulation failure sends nothing and remembers nothing; a wallet rejection reads as rejected', async () => {
    const simulateFails = fakeDeps([], {
      simulate: async () => {
        throw Object.assign(new Error('reverted'), { shortMessage: 'Execution reverted: DeploymentFailed.' })
      },
    })
    const first = await run(simulateFails.deps)
    expect(first.last).toMatchObject({
      type: 'failed',
      failure: { kind: 'reverted', title: 'The deploy would fail' },
    })
    expect((first.last as { failure: { message: string } }).failure.message).toContain('DeploymentFailed')
    expect(simulateFails.calls.send).toBe(0)
    expect(simulateFails.calls.remember).toEqual([])

    const rejected = fakeDeps([], {
      simulate: async () => async () => {
        throw Object.assign(new Error('User rejected'), { code: 4001 })
      },
    })
    const second = await run(rejected.deps)
    expect(second.last).toMatchObject({
      type: 'failed',
      failure: { kind: 'rejected', title: 'Deploy cancelled in your wallet' },
    })
    expect(rejected.calls.remember).toEqual([])
  })
})

describe('deployReducer and retryHash', () => {
  it('fails at the step it was on and keeps the sent hash; an idle failure is at preparing', () => {
    const failure = { kind: 'unconfirmed' as const, title: 't', message: 'm' }
    const confirming = deployReducer({ step: 'idle' }, { type: 'confirming', txHash: HASH })
    const failed = deployReducer(confirming, { type: 'failed', failure })
    expect(failed).toEqual({ step: 'failed', at: 'confirming', failure, txHash: HASH })
    expect(deployReducer({ step: 'idle' }, { type: 'failed', failure })).toEqual({
      step: 'failed',
      at: 'preparing',
      failure,
    })
    expect(deployReducer({ step: 'idle' }, { type: 'switching' })).toEqual({ step: 'switching' })
    expect(retryHash(failed)).toBe(HASH)
    expect(
      retryHash({ step: 'failed', at: 'verifying', failure: { ...failure, kind: 'refused' }, txHash: HASH }),
    ).toBeUndefined()
    expect(retryHash({ step: 'idle' })).toBeUndefined()
  })
})

describe('the pending deploy kept in the browser', () => {
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

  it('remembers the sent hash and the form per collection until they are forgotten', () => {
    const store = memoryStore()
    rememberDeploy(store, 'col-1', { hash: HASH, form })
    expect(pendingDeploy(store, 'col-1')).toEqual({ hash: HASH, form })
    expect(pendingDeploy(store, 'col-2')).toBeNull()
    expect(store.getItem('cobweb-deploy:col-1')).toContain(HASH)
    forgetDeploy(store, 'col-1')
    expect(pendingDeploy(store, 'col-1')).toBeNull()
  })

  it('ignores a value that is not a pending deploy and a store that throws', () => {
    const store = memoryStore()
    store.setItem('cobweb-deploy:col-1', 'nonsense')
    expect(pendingDeploy(store, 'col-1')).toBeNull()
    store.setItem('cobweb-deploy:col-1', JSON.stringify({ hash: 'not-a-hash', form }))
    expect(pendingDeploy(store, 'col-1')).toBeNull()
    store.setItem('cobweb-deploy:col-1', JSON.stringify({ hash: HASH }))
    expect(pendingDeploy(store, 'col-1')).toBeNull()
    expect(() => rememberDeploy(blocked, 'col-1', { hash: HASH, form })).not.toThrow()
    expect(pendingDeploy(blocked, 'col-1')).toBeNull()
    expect(pendingDeploy(null, 'col-1')).toBeNull()
    expect(() => forgetDeploy(null, 'col-1')).not.toThrow()
  })
})

describe('sentSettings: the form after a reload mid-deploy (spec section 2.11)', () => {
  it('gives the form the settings the remembered deploy was sent with, prices in the native unit', () => {
    expect(
      sentSettings({
        chainId: 8453,
        payout: DEPLOYER,
        royaltyBps: 250,
        royaltyReceiver: STRANGER,
        publicMaxPerWallet: 3,
        groups: [
          { name: 'Public', priceWei: '0', maxSupply: 600 },
          { name: 'Holders', priceWei: '3000000000000000', maxSupply: 177 },
        ],
      }),
    ).toEqual({
      chainId: 8453,
      payout: DEPLOYER,
      royalty: '2.5',
      royaltyReceiver: STRANGER,
      publicCap: '3',
      phases: [
        { key: 'public', name: 'Public', price: '0', supply: '600' },
        { key: 'wl-1', name: 'Holders', price: '0.003', supply: '177' },
      ],
    })
  })

  it('keeps royalties on the payout when the receiver is the payout, whatever the case', () => {
    expect(
      sentSettings({ ...form, royaltyReceiver: DEPLOYER.toLowerCase() as Address })?.royaltyReceiver,
    ).toBeNull()
  })

  it('reads back the exact wei and basis points the deploy was sent with', () => {
    for (const priceWei of ['1', '2500000000000000', '1000000000000000000', '1234500000000000000001']) {
      const phases = sentSettings({ ...form, groups: [{ name: 'Public', priceWei, maxSupply: 1 }] })?.phases
      expect(toWei(phases?.[0]?.price ?? '')).toBe(priceWei)
    }
    const royalty = (royaltyBps: number) => sentSettings({ ...form, royaltyBps })?.royalty
    expect([0, 1, 250, 333, 999, 1000].map(royalty)).toEqual(['0', '0.01', '2.5', '3.33', '9.99', '10'])
  })

  it('answers null for a remembered form it cannot read', () => {
    expect(sentSettings({ ...form, groups: [{ name: 'Public', priceWei: 'free', maxSupply: 1 }] })).toBeNull()
  })
})
