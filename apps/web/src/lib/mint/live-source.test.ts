import type { StateBody } from '@cobweb/shared'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/lib/database.types'
import { FRESH_AFTER_MS, liveMintSource, type Tiers } from './live-source'
import type { MintChain } from './mint-run'
import type { MintPageStatic } from './page-doc'

const COLLECTION: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const REAL = 'ipfs://bafybeireal/'

const page: MintPageStatic = {
  slug: 'night-owls',
  name: 'Night Owls',
  symbol: 'OWLS',
  projectType: 'generative',
  chain: { id: 31337, name: 'Anvil', nativeSymbol: 'ETH', explorerUrl: '', transferLock: false },
  contract: COLLECTION,
  description: '',
  bannerUrl: null,
  avatarUrl: null,
  aboutBannerUrl: null,
  socials: {},
  featuredTokenIds: [],
  sections: {},
  phases: [],
  placeholders: [],
  gateway: 'https://ipfs.io/ipfs',
}

/** A Supabase client whose `rpc` answers `data`, recording what it was asked. */
function fakeSupabase(data: unknown) {
  const rpc = vi.fn(async () => ({ data, error: null }))
  return { supabase: { rpc } as unknown as SupabaseClient<Database>, rpc }
}

const chain: MintChain = {
  simulate: async () => async () => '0x',
  receipt: async () => {
    throw new Error('not used')
  },
}

describe('liveMintSource tiers (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7)', () => {
  it('asks for the first 20 ids of a larger mint, which the function answers, never 21 (Review Focus 5)', async () => {
    const { supabase, rpc } = fakeSupabase({ total: 500, ranks: { '1': 12, '2': 480 } })
    const source = liveMintSource(page, { freshnessUrl: 'https://fresh.example', chain, supabase })
    const ids = Array.from({ length: 25 }, (_, index) => index + 1)
    await expect(source.tiers(REAL, ids)).resolves.toEqual<Tiers>({ total: 500, ranks: { 1: 12, 2: 480 } })
    expect(rpc).toHaveBeenCalledWith('mint_page_tiers', {
      p_slug: 'night-owls',
      p_base_uri: REAL,
      p_ids: ids.slice(0, 20),
    })
  })

  it('answers null for no ranks, an answer of another shape, an error and a throw', async () => {
    const source = (supabase: SupabaseClient<Database>) =>
      liveMintSource(page, { freshnessUrl: undefined, chain, supabase })
    expect(await source(fakeSupabase(null).supabase).tiers(REAL, [1])).toBeNull()
    expect(await source(fakeSupabase({ ranks: {} }).supabase).tiers(REAL, [1])).toBeNull()
    const failing = { rpc: async () => ({ data: null, error: { message: 'no' } }) }
    expect(await source(failing as unknown as SupabaseClient<Database>).tiers(REAL, [1])).toBeNull()
    const throwing = {
      rpc: async () => {
        throw new Error('offline')
      },
    }
    expect(await source(throwing as unknown as SupabaseClient<Database>).tiers(REAL, [1])).toBeNull()
  })

  it('keeps the ranks that are numbers on whole-number ids and drops the rest', async () => {
    const { supabase } = fakeSupabase({
      total: 500,
      ranks: { '1': 12, '2': 'high', '3': null, '4': 480, abc: 5, '1.5': 7 },
    })
    const source = liveMintSource(page, { freshnessUrl: undefined, chain, supabase })
    await expect(source.tiers(REAL, [1, 2, 3, 4])).resolves.toEqual<Tiers>({
      total: 500,
      ranks: { 1: 12, 4: 480 },
    })
  })

  it('answers null when the set size is not a number or the ranks are not an object', async () => {
    const source = (supabase: SupabaseClient<Database>) =>
      liveMintSource(page, { freshnessUrl: undefined, chain, supabase })
    const sized = fakeSupabase({ total: '500', ranks: { '1': 12 } }).supabase
    expect(await source(sized).tiers(REAL, [1])).toBeNull()
    expect(await source(fakeSupabase({ total: 500, ranks: 'none' }).supabase).tiers(REAL, [1])).toBeNull()
    expect(await source(fakeSupabase({ total: 500, ranks: null }).supabase).tiers(REAL, [1])).toBeNull()
  })
})

describe('liveMintSource pollState (fix round 1, item 1)', () => {
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
    mintFeeFlatWei: '0',
    mintFeeBps: 0,
    airdropFeePerTokenWei: '0',
    mintOnBehalfActive: false,
    groups: [],
    owner: COLLECTION,
    royalty: { receiver: COLLECTION, bps: 0 },
    baseUri: '',
    transferValidator: '0x0000000000000000000000000000000000000000',
    transferLevel: 'none',
  }
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

  it("asks past the browser's stored copy until the first body lands, then conditionally", async () => {
    const answers = [json({ error: 'not-read-yet' }, 503), json(body), json(body)]
    const caches: (RequestCache | undefined)[] = []
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      caches.push(init?.cache)
      return answers.shift() ?? json({}, 502)
    }) as unknown as typeof fetch
    const source = liveMintSource(page, {
      freshnessUrl: 'https://fresh.example',
      chain,
      supabase: fakeSupabase(null).supabase,
      fetchImpl,
    })
    expect((await source.pollState()).kind).toBe('retry')
    expect((await source.pollState()).kind).toBe('body')
    expect((await source.pollState()).kind).toBe('body')
    expect(caches).toEqual(['reload', 'reload', 'no-cache'])
  })

  it('asks past the stored copy again once more than 60 s passed since the last body, as after a sleep (final fix wave M3)', async () => {
    let now = 1_791_039_600_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const answers = [
        json(body),
        json(body),
        json({ error: 'busy' }, 503),
        json(body),
        json(body),
        json(body),
      ]
      const caches: (RequestCache | undefined)[] = []
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        caches.push(init?.cache)
        return answers.shift() ?? json({}, 502)
      }) as unknown as typeof fetch
      const source = liveMintSource(page, {
        freshnessUrl: 'https://fresh.example',
        chain,
        supabase: fakeSupabase(null).supabase,
        fetchImpl,
      })
      expect((await source.pollState()).kind).toBe('body')
      now += 3_000
      expect((await source.pollState()).kind).toBe('body')
      // 61 s with no body: the wall clock ran while the page slept, so the next poll skips the stored copy.
      now += FRESH_AFTER_MS + 1_000
      expect((await source.pollState()).kind).toBe('retry')
      now += 1_000
      expect((await source.pollState()).kind).toBe('body')
      now += 3_000
      expect((await source.pollState()).kind).toBe('body')
      now += FRESH_AFTER_MS
      expect((await source.pollState()).kind).toBe('body')
      // A failed poll is no body: the one after it still asks past the stored copy.
      expect(caches).toEqual(['reload', 'no-cache', 'reload', 'reload', 'no-cache', 'no-cache'])
    } finally {
      clock.mockRestore()
    }
  })
})
