import { attributeKeyOf, buildTraitIndex, rankTokens, type Layer } from '@cobweb/dna'
import { errorSummary } from '@/lib/art/lock-core'
import { readArtRows } from '@/lib/art/read-rows'
import { toProject } from '@/lib/art/rows'
import { doneJobRow } from '@/lib/deploy/deploy-core'
import type { PhasesContext } from '@/lib/manage/phases-core'

/**
 * The rarity ranks of a rendered set (docs/specs/2026-10-16-mint-page-live-data.md, section 6.3), recorded in
 * `token_ranks` so the public page can show a minted token's tier once the collection is revealed. No
 * `server-only` marker, so verify:mint-page can import it; the browser never does.
 */

/** Each token's rank, 1 the rarest, laid out by id (`ranks[id - 1]`): the ranks Generate shows. */
export function ranksOf(tokens: readonly { id: number; dna: string[] }[], layers: Layer[]): number[] {
  const ranked = rankTokens(
    tokens.map((token) => ({ id: token.id, collectionId: '', dna: token.dna })),
    attributeKeyOf(buildTraitIndex(layers)),
  )
  const ranks: number[] = []
  for (const token of ranked) ranks[token.id - 1] = token.rank
  return ranks
}

/**
 * Records the ranks of the collection's done real job unless they are there: skipped for a collection that is
 * not generative or has no done real job, present when the owner reads a row for the job, else ranked from the
 * collection's `tokens` rows and the layers, and recorded with the service client. A generative job's list is
 * those rows: `art_lock` checks them against the job's hash and stores no `token_list` for them, the lock keeps
 * them as they are, and the worker renders them. Throws on a failed read or record; every caller logs that and
 * goes on.
 */
export async function ensureTokenRanksCore(ctx: PhasesContext): Promise<'recorded' | 'present' | 'skipped'> {
  const { collection } = ctx
  if (collection.project_type !== 'generative') return 'skipped'
  const job = await doneJobRow(ctx.supabase, collection.id, 'real')
  if (!job) return 'skipped'
  const present = await ctx.supabase.from('token_ranks').select('job_id').eq('job_id', job.id).maybeSingle()
  if (present.error) throw new Error(`The ranks could not be read: ${present.error.message}`)
  if (present.data) return 'present'
  const rows = await readArtRows(ctx.supabase, collection.id)
  const tokens = rows.tokens.map((row) => ({ id: row.token_id, dna: row.dna }))
  const layers = toProject({ collection, ...rows, tokens: [] }).layers ?? []
  const { data, error } = await ctx.service().rpc('token_ranks_record', {
    p_collection_id: collection.id,
    p_owner: ctx.owner,
    p_job_id: job.id,
    p_ranks: ranksOf(tokens, layers),
  })
  if (error) throw new Error(`The ranks could not be recorded: ${error.code} ${error.message}`)
  return data ? 'recorded' : 'present'
}

/**
 * `ensureTokenRanksCore` for its callers, none of which fails on it: the save of a published page, the public
 * switch and the reveal's confirm. A failure is logged with the collection's id and the error's summary, and the
 * caller's answer is unchanged.
 */
export async function recordTokenRanks(ctx: PhasesContext): Promise<void> {
  try {
    await ensureTokenRanksCore(ctx)
  } catch (error) {
    console.error(`The ranks of ${ctx.collection.id} could not be recorded: ${errorSummary(error)}`)
  }
}
