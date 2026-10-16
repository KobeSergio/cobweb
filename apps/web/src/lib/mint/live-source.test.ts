import type { SupabaseClient } from '@supabase/supabase-js'
import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/lib/database.types'
import { liveMintSource, type Tiers } from './live-source'
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
})
