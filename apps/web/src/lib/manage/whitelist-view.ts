import { getAddress, type Hex } from 'viem'
import type { MintGroup } from '@/lib/demo/types'
import type { PhasesView } from './phases-types'
import type { ChunkPlan, GroupList, ListEntry, WrittenChunk } from './whitelist-types'

/**
 * The Whitelist view, pure (docs/specs/2026-10-15-whitelist.md, section 6.1), for the browser and the
 * server: the entries from their rows, the chunks the rows still name, a group's counts and the next chunk.
 * An entry is written when the chain was last proven to hold its quota.
 */

/** Addresses per `setMintQuota` transaction (MASTER_PLAN, whitelist quotas). */
export const WHITELIST_CHUNK = 500
/** Rows per group, the actions' and `whitelist_entries_add`'s cap. */
export const WHITELIST_MAX = 10_000
/** The largest quota the screens and the database take. */
export const QUOTA_MAX = 10_000
/** Addresses whose quota used one usage read covers: a page of the table. */
export const USAGE_PAGE = 25

/** A `whitelist_entries` row as the server reads it. */
export type EntryRow = {
  wallet_address: string
  quota: number
  written_quota: number | null
  written_tx: string | null
  written_at: string | null
}

export function isWritten(entry: Pick<ListEntry, 'quota' | 'writtenQuota'>): boolean {
  return entry.writtenQuota === entry.quota
}

/** Lowercase address order, the order of the database's key. */
export function byAddress(a: { address: string }, b: { address: string }): number {
  const left = a.address.toLowerCase()
  const right = b.address.toLowerCase()
  return left < right ? -1 : left > right ? 1 : 0
}

/** The rows as entries, checksummed, in lowercase address order. */
export function entriesOf(rows: EntryRow[]): ListEntry[] {
  return rows
    .map((row): ListEntry => ({
      address: getAddress(row.wallet_address),
      quota: row.quota,
      writtenQuota: row.written_quota,
      writtenTx: row.written_tx as Hex | null,
    }))
    .sort(byAddress)
}

/** The chunks the rows name, each counting its rows, in the order they were recorded. */
export function writtenChunksOf(rows: EntryRow[]): WrittenChunk[] {
  const chunks = new Map<string, WrittenChunk>()
  for (const row of rows) {
    if (!row.written_tx || !row.written_at) continue
    const at = Date.parse(row.written_at)
    const known = chunks.get(row.written_tx)
    if (known) {
      known.addresses++
      known.writtenAt = Math.min(known.writtenAt, at)
    } else chunks.set(row.written_tx, { txHash: row.written_tx as Hex, addresses: 1, writtenAt: at })
  }
  return [...chunks.values()].sort(
    (a, b) => a.writtenAt - b.writtenAt || (a.txHash < b.txHash ? -1 : a.txHash > b.txHash ? 1 : 0),
  )
}

/**
 * A group's list and its counts. Each chunk counts the entries that still name it, and a chunk no entry
 * names is left out, so a patch to the entries keeps the chunks right.
 */
export function listOf(
  onchainId: number,
  entries: ListEntry[],
  quotaUsed: number,
  chunks: WrittenChunk[],
): GroupList {
  const named = new Map<string, number>()
  let total = 0
  let written = 0
  let totalQuota = 0
  for (const entry of entries) {
    if (entry.quota > 0) total++
    if (isWritten(entry)) written++
    totalQuota += entry.quota
    if (entry.writtenTx) named.set(entry.writtenTx, (named.get(entry.writtenTx) ?? 0) + 1)
  }
  return {
    onchainId,
    entries,
    total,
    written,
    unwritten: entries.length - written,
    totalQuota,
    quotaUsed,
    chunks: chunks.flatMap((chunk) => {
      const addresses = named.get(chunk.txHash) ?? 0
      return addresses > 0 ? [{ ...chunk, addresses }] : []
    }),
  }
}

/**
 * The next chunk: the first `size` entries not written, in address order, a removal sending 0; null when
 * every entry is written. Its number follows the written chunks; `of` adds what the unwritten entries need.
 */
export function chunkPlanOf(list: GroupList, size = WHITELIST_CHUNK): ChunkPlan | null {
  const waiting = list.entries.filter((entry) => !isWritten(entry))
  if (waiting.length === 0) return null
  return {
    onchainId: list.onchainId,
    number: list.chunks.length + 1,
    of: list.chunks.length + Math.ceil(waiting.length / size),
    entries: waiting.slice(0, size).map((entry) => ({ address: entry.address, quota: entry.quota })),
  }
}

/** The phases view's whitelist groups (id 1 and up), in its order. */
export function whitelistGroups(view: PhasesView): MintGroup[] {
  return view.groups.filter((group) => group.kind === 'whitelist')
}
