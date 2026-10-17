import type { MintBody } from '@cobweb/shared'
import { createClient } from '@supabase/supabase-js'
import type { Address, Hex } from 'viem'
import type { Summary } from './activity.ts'
import type { IndexerOptions } from './config.ts'
import type { Records } from './indexer-records.ts'

/**
 * The indexer's database (docs/specs/2026-10-16-indexer-overview.md, section 6.2): the four service-role
 * functions of its migration, through supabase-js with the service role key, as the render worker's client.
 * The request path never uses it. A failure throws `IndexerWriteError`, which names the function and the
 * code, never the database's message or the key.
 */

export type { Summary } from './activity.ts'

/**
 * A deployed collection as `indexer_targets` lists it: without a cursor, its blocks and sync time are null.
 */
export type Target = {
  collectionId: string
  contract: Address
  deployTx: Hex
  fromBlock: bigint | null
  indexedBlock: bigint | null
  /** Unix seconds. */
  syncedAt: number | null
}

/** One write: one segment of one scan, for the scan's collections. */
export type RecordWrite = {
  chainId: number
  fromBlock: bigint
  toBlock: bigint
  /** The head's time when the segment ends at the safe block (Unix seconds), else null. */
  syncedAt: number | null
  collections: string[]
  records: Records
}

export type IndexerDb = {
  targets(chainId: number): Promise<Target[]>
  start(collectionId: string, fromBlock: bigint): Promise<void>
  record(write: RecordWrite): Promise<Summary[]>
  summaries(chainId: number): Promise<Summary[]>
}

/** How long one database call may take before it is abandoned and counts as failed (Review Focus 1). */
export const DB_TIMEOUT_MS = 10_000

/** The refusals that mean the cursors in memory no longer match the database's. */
const GAP_SENTENCES: readonly string[] = [
  'The indexer would skip blocks.',
  'A collection is not indexed on this chain.',
]

/**
 * A database call that failed: the function and the code, a Postgres code such as 23514, PostgREST's such as
 * PGRST202 (the migration is missing), `HTTP_<status>` for an answer without a code (the gateway's 401 for a
 * wrong key, a proxy's 502 page, an answer with no data), TIMEOUT when the call was abandoned, or NETWORK
 * when no answer came. `gap` when the refusal means the cursors in memory no longer match the database's, so
 * the targets are read again.
 */
export class IndexerWriteError extends Error {
  readonly code: string
  readonly gap: boolean

  constructor(fn: string, code: string, gap: boolean) {
    super(`The indexer's ${fn} call failed (${code}).`)
    this.name = 'IndexerWriteError'
    this.code = code
    this.gap = gap
  }
}

/**
 * A mint as the functions answer it: the transaction, the recipient as stored, the block's time in Unix
 * seconds.
 */
type DbMint = {
  tx: Hex
  recipient: Address
  groupId: number
  amount: number
  firstTokenId: number
  blockTime: number
}
type DbSummary = Omit<Summary, 'recentMints'> & { recentMints: DbMint[] }
type DbTarget = Omit<Target, 'fromBlock' | 'indexedBlock'> & {
  fromBlock: number | null
  indexedBlock: number | null
}

const summaryOf = (raw: DbSummary): Summary => ({
  collectionId: raw.collectionId,
  contract: raw.contract,
  holders: raw.holders,
  syncedAt: raw.syncedAt,
  recentMints: raw.recentMints.map((mint): MintBody => ({
    txHash: mint.tx,
    recipient: mint.recipient,
    groupId: mint.groupId,
    amount: mint.amount,
    firstTokenId: mint.firstTokenId,
    blockTimestamp: mint.blockTime,
  })),
})

const blockOf = (value: number | null) => (value === null ? null : BigInt(value))

/**
 * The port on supabase-js. Blocks travel as numbers, which hold any block below 2^53 exactly, and the sync
 * time as ISO. Each call is abandoned after `DB_TIMEOUT_MS`, so a connection that never answers cannot hold a
 * chain's passes, which never overlap, or the server's close.
 */
export function supabaseIndexerDb(options: IndexerOptions, fetchImpl: typeof fetch = fetch): IndexerDb {
  const client = createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchImpl },
  })

  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), DB_TIMEOUT_MS)
    try {
      const { data, error, status } = await client.rpc(fn, args).abortSignal(timeout.signal)
      // Every function answers JSON, so an answer without data failed too: postgrest-js reads a 404 with an
      // empty body as a 204 with no data and no error. A fetch that failed comes back with status 0.
      if (error || data === null) {
        const code =
          error?.code || (timeout.signal.aborted ? 'TIMEOUT' : status > 0 ? `HTTP_${status}` : 'NETWORK')
        throw new IndexerWriteError(fn, code, GAP_SENTENCES.includes(error?.message ?? ''))
      }
      return data as T
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async targets(chainId) {
      const rows = await call<DbTarget[]>('indexer_targets', { p_chain_id: chainId })
      return rows.map((row) => ({
        ...row,
        fromBlock: blockOf(row.fromBlock),
        indexedBlock: blockOf(row.indexedBlock),
      }))
    },
    async start(collectionId, fromBlock) {
      await call('indexer_start', { p_collection_id: collectionId, p_from_block: Number(fromBlock) })
    },
    async record(write) {
      const answer = await call<Record<string, DbSummary>>('indexer_record', {
        p_chain_id: write.chainId,
        p_from_block: Number(write.fromBlock),
        p_to_block: Number(write.toBlock),
        p_synced_at: write.syncedAt === null ? null : new Date(write.syncedAt * 1_000).toISOString(),
        p_collections: write.collections,
        p_records: write.records,
      })
      return Object.values(answer).map(summaryOf)
    },
    async summaries(chainId) {
      return (await call<DbSummary[]>('indexer_summaries', { p_chain_id: chainId })).map(summaryOf)
    },
  }
}
