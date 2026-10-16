import type { SupabaseClient } from '@supabase/supabase-js'
import type { Address } from 'viem'
import type { Database } from '@/lib/database.types'
import { pollState, pollWallet, type StatePoll, type WalletPoll } from './fresh-client'
import type { MintChain } from './mint-run'
import type { MintPageStatic } from './page-doc'
import { tokenArtOf, type TokenArt } from './token-art'

/**
 * Where the mint page reads and mints (docs/specs/2026-10-16-mint-page-live-data.md, decision 27): the state and
 * wallet polls, the chain the mint is checked, sent and confirmed on, the rarity ranks of minted tokens and token
 * art. The components see only the source: the live one on the freshness server, wagmi, Supabase and the IPFS
 * gateway, or the sample one on `lib/demo` (components/mint/sample-source.ts).
 */

/** Minted tokens' ranks at the revealed base URI, with the set's size. */
export type Tiers = { total: number; ranks: Record<number, number> }

export type MintSource = {
  pollState(): Promise<StatePoll>
  pollWallet(wallet: Address): Promise<WalletPoll>
  chain: MintChain
  /** Up to 20 ids' ranks; null before the reveal, without ranks, or when the read fails. */
  tiers(baseUri: string, ids: number[]): Promise<Tiers | null>
  tokenArt(baseUri: string, id: number): Promise<TokenArt | null>
}

/** The tiers read's answer, or null for anything else. */
function tiersOf(data: unknown): Tiers | null {
  const shaped = data as { total?: unknown; ranks?: unknown } | null
  if (!shaped || typeof shaped.total !== 'number' || !shaped.ranks || typeof shaped.ranks !== 'object')
    return null
  const ranks: Record<number, number> = {}
  for (const [id, rank] of Object.entries(shaped.ranks))
    if (typeof rank === 'number' && Number.isInteger(Number(id))) ranks[Number(id)] = rank
  return { total: shaped.total, ranks }
}

/**
 * The live source: polls the freshness server at `freshnessUrl`, mints through `chain`, reads the tiers through
 * `public.mint_page_tiers` and the art through the page's gateway.
 */
export function liveMintSource(
  page: MintPageStatic,
  deps: {
    freshnessUrl: string | undefined
    chain: MintChain
    supabase: SupabaseClient<Database>
    fetchImpl?: typeof fetch
  },
): MintSource {
  const fetchImpl = deps.fetchImpl ?? fetch
  return {
    pollState: () => pollState(deps.freshnessUrl, page.chain.id, page.contract, fetchImpl),
    pollWallet: (wallet) => pollWallet(deps.freshnessUrl, page.chain.id, page.contract, wallet, fetchImpl),
    chain: deps.chain,
    async tiers(baseUri, ids) {
      try {
        const { data, error } = await deps.supabase.rpc('mint_page_tiers', {
          p_slug: page.slug,
          p_base_uri: baseUri,
          p_ids: ids.slice(0, 20),
        })
        return error ? null : tiersOf(data)
      } catch {
        return null
      }
    },
    tokenArt: (baseUri, id) => tokenArtOf(baseUri, id, page.gateway, fetchImpl),
  }
}
