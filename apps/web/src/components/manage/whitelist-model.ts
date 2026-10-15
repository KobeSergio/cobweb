import type { Address, Hex } from 'viem'
import type { ChunkEntry, GroupList, ListEntry } from '@/lib/manage/whitelist-types'
import { byAddress, isWritten, listOf, WHITELIST_MAX } from '@/lib/manage/whitelist-view'

/**
 * The Whitelist screen's local model (docs/specs/2026-10-15-whitelist.md, section 7.4): pure patches on a
 * group's list, applied once the server accepts an edit, each mirroring what the database did (section 4.2) and
 * counting again through `listOf`. Nothing here reaches the chain: an edit waits for the next chunk.
 */

/** How the table shows an entry: on chain as listed, waiting for a chunk, or a removal waiting for its zero. */
export type EntryState = 'written' | 'pending' | 'removing'

export function entryState(entry: ListEntry): EntryState {
  if (isWritten(entry)) return 'written'
  return entry.quota === 0 ? 'removing' : 'pending'
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The list with new entries, counted again; entries stay in lowercase address order. */
function withEntries(list: GroupList, entries: ListEntry[]): GroupList {
  return listOf(list.onchainId, entries, list.quotaUsed, list.chunks)
}

/**
 * An add as `whitelist_entries_add` makes it: a new address joins with its quota and no copy; a listed one takes
 * the new quota (a staged removal gets its quota back) and keeps its copies.
 */
export function withAdded(list: GroupList, rows: ChunkEntry[]): GroupList {
  const entries = [...list.entries]
  // Each address's place in `entries`, by lowercase address: one lookup per row, at the 10,000 cap too.
  const places = new Map<string, number>(entries.map((entry, index) => [entry.address.toLowerCase(), index]))
  for (const row of rows) {
    const key = row.address.toLowerCase()
    const at = places.get(key) ?? entries.length
    const listed = entries[at]
    if (listed) entries[at] = { ...listed, quota: row.quota }
    else {
      places.set(key, at)
      entries.push({ address: row.address, quota: row.quota, writtenQuota: null, writtenTx: null })
    }
  }
  return withEntries(list, entries.sort(byAddress))
}

/** One address's new quota. */
export function withQuota(list: GroupList, address: Address, quota: number): GroupList {
  return withEntries(
    list,
    list.entries.map((entry) => (same(entry.address, address) ? { ...entry, quota } : entry)),
  )
}

/** Set quota for all: every entry above 0 takes the quota; staged removals stay at 0. */
export function withQuotaForAll(list: GroupList, quota: number): GroupList {
  return withEntries(
    list,
    list.entries.map((entry) => (entry.quota > 0 ? { ...entry, quota } : entry)),
  )
}

/** A removal: an entry the chain never held (or holds at 0) leaves at once; a written one is staged at 0. */
export function withRemoved(list: GroupList, address: Address): GroupList {
  return withEntries(
    list,
    list.entries.flatMap((entry): ListEntry[] => {
      if (!same(entry.address, address)) return [entry]
      return entry.writtenQuota ? [{ ...entry, quota: 0 }] : []
    }),
  )
}

/** An entry put back as given (Undo, or Keep on a staged removal), in its place by address. */
export function withRestored(list: GroupList, entry: ListEntry): GroupList {
  const others = list.entries.filter((candidate) => !same(candidate.address, entry.address))
  return withEntries(list, [...others, entry].sort(byAddress))
}

/**
 * Room for an add under the 10,000 cap: the rows it would create (addresses not listed) and how many more the
 * list holds. A staged removal is still a row until its zero is written, so it counts.
 */
export function capRoom(existing: Set<string>, rows: { address: string }[]): { fresh: number; room: number } {
  const fresh = new Set(
    rows.map((row) => row.address.toLowerCase()).filter((address) => !existing.has(address)),
  ).size
  return { fresh, room: Math.max(0, WHITELIST_MAX - existing.size) }
}

/** One row of the On-chain write panel: a chunk written, the next one (or the one that failed), or one waiting. */
export type ChunkRow = {
  number: number
  addresses: number
  status: 'written' | 'next' | 'failed' | 'waiting'
  txHash?: Hex
  error?: string
}

/**
 * The chunks as the panel lists them: the written ones with their transactions, then what the unwritten entries
 * need, `size` at a time, the first marked failed with its error after a failure in this visit.
 */
export function chunkRows(list: GroupList, size: number, failure: string | null): ChunkRow[] {
  const rows: ChunkRow[] = list.chunks.map((chunk, index) => ({
    number: index + 1,
    addresses: chunk.addresses,
    status: 'written',
    txHash: chunk.txHash,
  }))
  const written = rows.length
  for (let from = 0; from < list.unwritten; from += size) {
    const first = from === 0
    rows.push({
      number: written + from / size + 1,
      addresses: Math.min(size, list.unwritten - from),
      status: first ? (failure ? 'failed' : 'next') : 'waiting',
      ...(first && failure ? { error: failure } : {}),
    })
  }
  return rows
}
