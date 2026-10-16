import type { StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import {
  cadenceMs,
  chainNowOf,
  EMPTY_TRACK,
  foldState,
  ownDegraded,
  pollState,
  pollWallet,
  POLL_TIMEOUT_MS,
  RETRY_MAX_MS,
  type FreshTrack,
  type StatePoll,
} from './fresh-client'

const BASE = 'https://fresh.example'
const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const OTHER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

const body: StateBody = {
  chainId: 31337,
  address: COLLECTION,
  block: 120,
  blockTimestamp: 1_791_039_600,
  readAt: 1_791_039_601,
  degraded: false,
  maxSupply: 3,
  totalMinted: 0,
  publicMaxMintPerWallet: 1,
  mintFeeFlatWei: '10000000000000',
  mintFeeBps: 250,
  airdropFeePerTokenWei: '0',
  mintOnBehalfActive: false,
  groups: [
    {
      id: 0,
      priceWei: '1000000000000000',
      maxSupply: 2,
      minted: 0,
      startTimestamp: 0,
      flag: true,
      active: true,
    },
  ],
  owner: WALLET,
  royalty: { receiver: WALLET, bps: 500 },
  baseUri: 'ipfs://bafybeiexample/',
  transferValidator: '0x0000000000000000000000000000000000000000',
  transferLevel: 'none',
}
const wallet: WalletBody = {
  chainId: 31337,
  address: COLLECTION,
  wallet: WALLET,
  block: 121,
  publicMinted: 1,
  groups: [{ id: 0, quota: 0, claimed: 0 }],
  vaults: [],
}

type Call = { url: string; init: RequestInit | undefined }

/** A fetch that answers each call with the next response, or throws for a network error. */
function fakeFetch(answers: (Response | Error)[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const answer = answers.shift()
    if (!answer || answer instanceof Error) throw answer ?? new Error('no answer')
    return answer
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('pollState (docs/specs/2026-10-16-mint-page-live-data.md, section 7.1)', () => {
  it("asks for the collection in lowercase with the browser's conditional request", async () => {
    const { fetchImpl, calls } = fakeFetch([json(body)])
    await pollState(BASE, 31337, COLLECTION, fetchImpl)
    expect(calls[0]?.url).toBe(`${BASE}/v1/state/31337/${COLLECTION.toLowerCase()}`)
    expect(calls[0]?.init?.cache).toBe('no-cache')
  })

  it("asks a fresh poll past the browser's stored copy and the others conditionally (fix round 1, item 1)", async () => {
    const { fetchImpl, calls } = fakeFetch([json(body), json(body), json(body)])
    await pollState(BASE, 31337, COLLECTION, fetchImpl, { fresh: true })
    await pollState(BASE, 31337, COLLECTION, fetchImpl, { fresh: false })
    await pollState(BASE, 31337, COLLECTION, fetchImpl)
    expect(calls.map((call) => call.init?.cache)).toEqual(['reload', 'no-cache', 'no-cache'])
  })

  it('builds both URLs on an origin given with a trailing slash (fix round 1, item 9)', async () => {
    const { fetchImpl, calls } = fakeFetch([json(body), json(wallet)])
    await pollState(`${BASE}/`, 31337, COLLECTION, fetchImpl)
    await pollWallet(`${BASE}//`, 31337, COLLECTION, WALLET, fetchImpl)
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/v1/state/31337/${COLLECTION.toLowerCase()}`,
      `${BASE}/v1/wallet/31337/${COLLECTION.toLowerCase()}/${WALLET.toLowerCase()}`,
    ])
  })

  it('reads a body with its Age: 10 s is a body, 11 s a failed poll', async () => {
    const { fetchImpl } = fakeFetch([
      json(body, 200, { Age: '10' }),
      json(body, 200, { Age: '11' }),
      json(body),
    ])
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'body',
      body,
      ageSeconds: 10,
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'retry',
      afterMs: 1_000,
      reason: 'stale',
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'body',
      body,
      ageSeconds: 0,
    })
  })

  it('counts a body for another address or chain, a body that does not parse and a network error as failed polls', async () => {
    const { fetchImpl } = fakeFetch([
      json({ ...body, address: OTHER }),
      json({ ...body, chainId: 1 }),
      json({ ...body, groups: 'none' }),
      new Response('not json', { status: 200 }),
      new Error('offline'),
      json({}, 502),
    ])
    for (let poll = 0; poll < 6; poll++)
      expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
        kind: 'retry',
        afterMs: 1_000,
        reason: 'network',
      })
  })

  it('abandons a poll that has not answered after 5 s as a network failure, so the polls go on (Review Focus 1)', async () => {
    const timeout = new AbortController()
    const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    // A request that never answers until its signal aborts, as a connection stuck at the edge does.
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('The operation timed out.')))
      })) as unknown as typeof fetch
    try {
      const state = pollState(BASE, 31337, COLLECTION, hanging)
      const own = pollWallet(BASE, 31337, COLLECTION, WALLET, hanging)
      timeout.abort()
      await expect(state).resolves.toEqual<StatePoll>({ kind: 'retry', afterMs: 1_000, reason: 'network' })
      await expect(own).resolves.toEqual({ kind: 'retry', afterMs: 1_000 })
      expect(timer).toHaveBeenCalledWith(POLL_TIMEOUT_MS)
      expect(POLL_TIMEOUT_MS).toBe(5_000)
    } finally {
      timer.mockRestore()
    }
  })

  it('waits for a 503 its Retry-After, 1 s without one, naming its reason', async () => {
    const { fetchImpl } = fakeFetch([
      json({ error: 'not-read-yet' }, 503, { 'Retry-After': '2' }),
      json({ error: 'busy' }, 503),
      json({ error: 'chain-unreadable' }, 503, { 'Retry-After': '1' }),
    ])
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'retry',
      afterMs: 2_000,
      reason: 'not-read-yet',
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toMatchObject({
      afterMs: 1_000,
      reason: 'busy',
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toMatchObject({ reason: 'chain-unreadable' })
  })

  it('is final for a 404 not-a-collection, as unavailable for chain-not-served, a 400 and a build without the origin', async () => {
    const { fetchImpl, calls } = fakeFetch([
      json({ error: 'not-a-collection' }, 404),
      json({ error: 'chain-not-served' }, 404),
      json({ error: 'bad-request' }, 400),
    ])
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'final',
      reason: 'not-a-collection',
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'final',
      reason: 'unavailable',
    })
    expect(await pollState(BASE, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'final',
      reason: 'unavailable',
    })
    expect(await pollState(undefined, 31337, COLLECTION, fetchImpl)).toEqual<StatePoll>({
      kind: 'final',
      reason: 'unavailable',
    })
    expect(calls).toHaveLength(3)
  })
})

describe('pollWallet', () => {
  it('asks with both addresses in lowercase and reads the body for that wallet only, an answer for another wallet being a failed poll (Review Focus 2)', async () => {
    const { fetchImpl, calls } = fakeFetch([json(wallet), json({ ...wallet, wallet: OTHER })])
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({
      kind: 'body',
      body: wallet,
    })
    expect(calls[0]?.url).toBe(`${BASE}/v1/wallet/31337/${COLLECTION.toLowerCase()}/${WALLET.toLowerCase()}`)
    expect(calls[0]?.init?.cache).toBe('no-cache')
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({
      kind: 'retry',
      afterMs: 1_000,
    })
  })

  it('retries a 503 after its Retry-After and stops on a 404, a 400 or no origin', async () => {
    const { fetchImpl } = fakeFetch([
      json({ error: 'wallet-unreadable' }, 503, { 'Retry-After': '3' }),
      json({ error: 'not-a-collection' }, 404),
      json({ error: 'bad-request' }, 400),
    ])
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({
      kind: 'retry',
      afterMs: 3_000,
    })
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({ kind: 'final' })
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({ kind: 'final' })
    expect(await pollWallet('', 31337, COLLECTION, WALLET, fetchImpl)).toEqual({ kind: 'final' })
  })

  it('reads a wallet answer with its Age: 10 s is a body, 11 s a failed poll (fix round 1, item 10)', async () => {
    const { fetchImpl } = fakeFetch([json(wallet, 200, { Age: '10' }), json(wallet, 200, { Age: '11' })])
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({
      kind: 'body',
      body: wallet,
    })
    expect(await pollWallet(BASE, 31337, COLLECTION, WALLET, fetchImpl)).toEqual({
      kind: 'retry',
      afterMs: 1_000,
    })
  })
})

describe('foldState and the chain clock', () => {
  const at = (block: number, extra: Partial<StateBody> = {}): StatePoll => ({
    kind: 'body',
    body: { ...body, block, blockTimestamp: body.blockTimestamp + (block - 120) * 2, ...extra },
    ageSeconds: 0,
  })

  it('anchors the clock on a body above the highest block at its block time plus Age, and runs it from there', () => {
    const track = foldState(EMPTY_TRACK, { ...at(120), ageSeconds: 3 } as StatePoll, 5_000)
    expect(track.highestBlock).toBe(120)
    expect(track.anchor).toEqual({ seconds: body.blockTimestamp + 3, at: 5_000 })
    expect(chainNowOf(track, 7_500)).toBe(body.blockTimestamp + 5)
    expect(chainNowOf(EMPTY_TRACK, 7_500)).toBeNull()
  })

  it('takes a body at the same block without moving the clock, so a changed degraded shows', () => {
    const first = foldState(EMPTY_TRACK, at(120), 1_000)
    const same = foldState(
      first,
      at(120, { degraded: true, blockTimestamp: body.blockTimestamp + 50 }),
      4_000,
    )
    expect(same.body?.degraded).toBe(true)
    expect(same.anchor).toEqual(first.anchor)
    expect(same.lastGoodAt).toBe(4_000)
  })

  it('ignores a body below the highest block, which counts as nothing', () => {
    const newer = foldState(EMPTY_TRACK, at(130), 1_000)
    const failed = foldState(newer, { kind: 'retry', afterMs: 1_000, reason: 'network' }, 2_000)
    const older = foldState(failed, at(125, { degraded: true }), 3_000)
    expect(older).toBe(failed)
  })

  it('doubles the wait after each failure up to 8 s, from the 503 Retry-After, and clears it on a body', () => {
    let track: FreshTrack = foldState(EMPTY_TRACK, at(120), 0)
    const waits: (number | null)[] = []
    for (let failure = 0; failure < 5; failure++) {
      track = foldState(track, { kind: 'retry', afterMs: 1_500, reason: 'not-read-yet' }, failure)
      waits.push(track.retryMs)
    }
    expect(waits).toEqual([1_500, 3_000, 6_000, RETRY_MAX_MS, RETRY_MAX_MS])
    const back = foldState(track, at(121), 10)
    expect([back.failures, back.retryMs]).toEqual([0, null])
  })

  it('stops after a final refusal', () => {
    const track = foldState(EMPTY_TRACK, { kind: 'final', reason: 'not-a-collection' }, 0)
    expect(track.final).toBe('not-a-collection')
    expect(cadenceMs(track, [])).toBeNull()
  })

  it('keeps a final refusal through a later body and a later retry (fix round 1, item 10)', () => {
    const stopped = foldState(EMPTY_TRACK, { kind: 'final', reason: 'unavailable' }, 0)
    const afterBody = foldState(stopped, at(121), 1)
    const afterRetry = foldState(afterBody, { kind: 'retry', afterMs: 1_000, reason: 'network' }, 2)
    expect([afterBody.final, afterRetry.final]).toEqual(['unavailable', 'unavailable'])
    expect([cadenceMs(afterBody, []), cadenceMs(afterRetry, [])]).toEqual([null, null])
  })
})

describe('cadenceMs and ownDegraded', () => {
  const shown = foldState(EMPTY_TRACK, { kind: 'body', body, ageSeconds: 0 }, 0)

  it('polls every second with no body, a phase starting, or one scheduled 60 s ahead; 3 s at 61 s', () => {
    expect(cadenceMs(EMPTY_TRACK, [])).toBe(1_000)
    expect(cadenceMs(shown, [{ status: 'starting', startsIn: -2 }])).toBe(1_000)
    expect(cadenceMs(shown, [{ status: 'scheduled', startsIn: 60 }])).toBe(1_000)
    expect(cadenceMs(shown, [{ status: 'scheduled', startsIn: 61 }])).toBe(3_000)
    expect(cadenceMs(shown, [{ status: 'live', startsIn: null }])).toBe(3_000)
  })

  it('waits the retry after a failure', () => {
    const failed = foldState(shown, { kind: 'retry', afterMs: 1_000, reason: 'network' }, 1)
    expect(cadenceMs(failed, [{ status: 'scheduled', startsIn: 10 }])).toBe(1_000)
    expect(cadenceMs(foldState(failed, { kind: 'retry', afterMs: 1_000, reason: 'network' }, 2), [])).toBe(
      2_000,
    )
  })

  it('turns on 10 s after the last accepted body, and not before', () => {
    expect(ownDegraded(shown, 9_999)).toBe(false)
    expect(ownDegraded(shown, 10_000)).toBe(true)
    expect(ownDegraded(EMPTY_TRACK, 60_000)).toBe(false)
  })
})
