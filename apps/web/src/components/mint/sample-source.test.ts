import type { StateBody } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_MINTER, DEMO_NOW, DEMO_TOKENS, DEMO_VAULT } from '@/lib/demo'
import { mintCallOf, type MintParams } from '@/lib/mint/mint-call'
import { MintFailure, type MintFailureKind } from '@/lib/mint/mint-failure'
import { runMint } from '@/lib/mint/mint-run'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import {
  sampleMintSource,
  sampleSwitchesOf,
  SAMPLE_PLACEHOLDER_URI,
  SAMPLE_REVEALED_URI,
  type SampleSwitches,
} from './sample-source'

const page = {
  slug: 'night-owls',
  chain: {
    id: 8453,
    name: 'Base',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://basescan.org',
    transferLock: true,
  },
  contract: '0x4f2A9C7E1B3d5F6A8C0E2b4D6f8A1C3e5B7D9f0a',
} as unknown as MintPageStatic
const switches = (query = ''): SampleSwitches => sampleSwitchesOf(new URLSearchParams(query))
const params: MintParams = {
  contract: page.contract,
  chainId: page.chain.id,
  groupId: 1,
  amount: 1,
  vault: null,
  valueWei: 1_000n,
  account: DEMO_MINTER,
}

describe('sampleMintSource (docs/specs/2026-10-16-mint-page-live-data.md, section 8)', () => {
  let now = 0
  const clock = () => now
  beforeEach(() => {
    vi.useFakeTimers()
    now = 1_000_000
  })
  afterEach(() => vi.useRealTimers())

  /** Runs a promise's pauses on the fake timers, the sample's own clock moving with them; a rejection is the caller's. */
  async function settle<T>(promise: Promise<T>, ms = 10_000): Promise<T> {
    promise.catch(() => {})
    for (let step = 0; step < ms / 500; step++) {
      now += 500
      await vi.advanceTimersByTimeAsync(500)
    }
    return promise
  }
  async function state(source: ReturnType<typeof sampleMintSource>): Promise<StateBody> {
    const poll = await settle(source.pollState(), 500)
    if (poll.kind !== 'body') throw new Error(`no body: ${poll.kind}`)
    return poll.body
  }
  /** One mint through the page's own runMint on the sample's chain. */
  const mint = (source: ReturnType<typeof sampleMintSource>, overrides: Partial<MintParams> = {}) =>
    settle(
      runMint(
        source.chain,
        { ...params, ...overrides },
        { isLive: () => true, nextAnswer: async () => {} },
        { wallet: () => {}, sent: () => {} },
      ),
    )

  it('flips a scheduled group active 2 s after its start on its clock, which advances in real seconds', async () => {
    const source = sampleMintSource(page, switches('state=upcoming&start=30'), clock)
    const group = (body: StateBody) => body.groups.find((entry) => entry.startTimestamp === DEMO_NOW + 30)
    const first = await state(source)
    expect([first.blockTimestamp, group(first)?.active]).toEqual([DEMO_NOW, false])
    now = 1_000_000 + 31_000
    const atStart = await state(source)
    expect([atStart.blockTimestamp, group(atStart)?.active]).toEqual([DEMO_NOW + 31, false])
    now = 1_000_000 + 32_000
    expect(group(await state(source))?.active).toBe(true)
  })

  it('is revealed unless ?art=placeholder, and counts a confirmed mint from its block on', async () => {
    expect((await state(sampleMintSource(page, switches(), clock))).baseUri).toBe(SAMPLE_REVEALED_URI)
    const source = sampleMintSource(page, switches('art=placeholder'), clock)
    const before = await state(source)
    expect(before.baseUri).toBe(SAMPLE_PLACEHOLDER_URI)
    const result = await mint(source)
    expect(result.tokenIds).toEqual([before.totalMinted + 1])
    const after = await state(source)
    expect(after.totalMinted).toBe(before.totalMinted + 1)
    const wallet = await settle(source.pollWallet(DEMO_MINTER))
    expect(wallet.kind === 'body' && wallet.body.groups.find((entry) => entry.id === 1)?.claimed).toBe(2)
  })

  it('answers each ?refusal= as the server would: final, retried, or the first answer after 6 s', async () => {
    for (const refusal of ['not-a-collection', 'unavailable'] as const)
      expect(await settle(sampleMintSource(page, switches(`refusal=${refusal}`), clock).pollState())).toEqual(
        {
          kind: 'final',
          reason: refusal,
        },
      )
    expect(await settle(sampleMintSource(page, switches('refusal=slow'), clock).pollState())).toMatchObject({
      kind: 'retry',
    })
    const startedAt = now
    const reading = sampleMintSource(page, switches('refusal=reading'), clock)
    expect((await settle(reading.pollState())).kind).toBe('body')
    expect(now - startedAt).toBeGreaterThanOrEqual(6_000)
  })

  it('fails the first attempt as each ?fail= kind says, and lets "Try again" succeed', async () => {
    const kinds: MintFailureKind[] = [
      'rejected',
      'phase-closed',
      'sold-out',
      'quota-exceeded',
      'not-listed',
      'not-delegate',
      'price-changed',
      'insufficient-balance',
      'contract-wallet',
      'wrong-network',
      'check-failed',
      'wallet-failed',
      'reverted',
      'unconfirmed',
    ]
    for (const kind of kinds) {
      const source = sampleMintSource(page, switches(`fail=${kind}`), clock)
      const overrides = kind === 'not-delegate' ? { vault: DEMO_VAULT } : {}
      const failure = await mint(source, overrides).catch((error: unknown) => error)
      expect(failure, kind).toBeInstanceOf(MintFailure)
      expect((failure as MintFailure).kind, kind).toBe(kind)
      await expect(mint(source, overrides), kind).resolves.toMatchObject({ tokenIds: [expect.any(Number)] })
    }
    expect(mintCallOf(params).functionName).toBe('batchMint')
  })
})

describe('sampleMintSource tiers (docs/specs/2026-10-16-mint-page-live-data.md, sections 7.7 and 8)', () => {
  const sample = () => sampleMintSource(page, switches())

  it("answers the demo set's size and each id's rank at the revealed base URI", async () => {
    const ids = [1, 2, 3]
    expect(await sample().tiers(SAMPLE_REVEALED_URI, ids)).toEqual({
      total: DEMO_TOKENS.length,
      ranks: Object.fromEntries(ids.map((id) => [id, DEMO_TOKENS[id - 1]!.rank])),
    })
  })

  it('reads the first 20 ids only and leaves out an id the set does not have', async () => {
    const ids = Array.from({ length: 25 }, (_, index) => index + 1)
    const capped = await sample().tiers(SAMPLE_REVEALED_URI, ids)
    expect(Object.keys(capped?.ranks ?? {}).map(Number)).toEqual(ids.slice(0, 20))
    const unknown = await sample().tiers(SAMPLE_REVEALED_URI, [0, DEMO_TOKENS.length + 1])
    expect(unknown).toEqual({ total: DEMO_TOKENS.length, ranks: {} })
  })

  it('answers null before the reveal and for any other base URI', async () => {
    expect(await sample().tiers(SAMPLE_PLACEHOLDER_URI, [1])).toBeNull()
    expect(await sample().tiers('ipfs://elsewhere/', [1])).toBeNull()
  })
})
