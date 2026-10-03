import { WHITELIST_CHUNK_SIZE, type GroupWhitelist, type Hex, type WhitelistEntry } from '@/lib/demo'
import type { Recipient } from './recipients'

/**
 * A whitelist as the screen edits it. Every change is staged on the entry first; it reaches the
 * chain when the chunk holding it is written with `setMintQuota`. Re-sending an address is safe:
 * the contract stores the quota issued and the quota used apart, so a retried chunk never
 * re-grants spent quota.
 */
export type EntryState = 'onchain' | 'pending' | 'removing'
/** `everWritten`: the address has reached the chain at least once, so removing it needs a write. */
export type ListEntry = WhitelistEntry & { state: EntryState; everWritten: boolean }
export type WrittenChunk = { size: number; txHash?: Hex }

export type ListState = {
  groupId: number
  entries: ListEntry[]
  chunkSize: number
  /** Chunks already on chain, oldest first. */
  written: WrittenChunk[]
  /** Why the last write failed. It belongs to the next chunk, which is the one that failed. */
  failure: string | null
}

export type PendingChunk = {
  /** 1-based, continuing after the written chunks. */
  number: number
  entries: ListEntry[]
  status: 'pending' | 'failed'
  error?: string
}

/** Builds the editable state from the sample data's entries and chunk table. */
export function fromGroupWhitelist(list: GroupWhitelist): ListState {
  const written = list.chunks.filter((chunk) => chunk.status === 'written')
  const writtenRanges = written.map((chunk) => [chunk.from, chunk.to] as const)
  const failed = list.chunks.find((chunk) => chunk.status === 'failed')
  return {
    groupId: list.groupId,
    chunkSize: list.chunkSize,
    entries: list.entries.map((entry, index) => {
      const onChain = writtenRanges.some(([from, to]) => index >= from && index < to)
      return { ...entry, state: onChain ? 'onchain' : 'pending', everWritten: onChain }
    }),
    written: written.map((chunk) => ({ size: chunk.to - chunk.from, txHash: chunk.txHash })),
    failure: failed ? (failed.error ?? 'The last write failed.') : null,
  }
}

export function emptyList(groupId: number, chunkSize = WHITELIST_CHUNK_SIZE): ListState {
  return { groupId, entries: [], chunkSize, written: [], failure: null }
}

/** Entries waiting to be written, split into transactions of `chunkSize`. */
export function pendingChunks(state: ListState): PendingChunk[] {
  const waiting = state.entries.filter((entry) => entry.state !== 'onchain')
  const chunks: PendingChunk[] = []
  for (let from = 0; from < waiting.length; from += state.chunkSize) {
    const first = from === 0
    chunks.push({
      number: state.written.length + chunks.length + 1,
      entries: waiting.slice(from, from + state.chunkSize),
      status: first && state.failure ? 'failed' : 'pending',
      error: first && state.failure ? state.failure : undefined,
    })
  }
  return chunks
}

/** A chunk landed: its entries are on chain, removals leave the list. */
export function markWritten(state: ListState, chunk: PendingChunk, txHash: Hex): ListState {
  const done = new Set(chunk.entries.map((entry) => entry.address))
  return {
    ...state,
    failure: null,
    written: [...state.written, { size: chunk.entries.length, txHash }],
    entries: state.entries
      .filter((entry) => !(done.has(entry.address) && entry.state === 'removing'))
      .map((entry) => (done.has(entry.address) ? { ...entry, state: 'onchain', everWritten: true } : entry)),
  }
}

export function markFailed(state: ListState, message: string): ListState {
  return { ...state, failure: message }
}

/** Adds new addresses and restates existing ones with the new quota. */
export function addEntries(
  state: ListState,
  rows: Recipient[],
): { state: ListState; added: number; updated: number } {
  const index = new Map(state.entries.map((entry, position) => [entry.address.toLowerCase(), position]))
  const entries = [...state.entries]
  let added = 0
  let updated = 0
  for (const row of rows) {
    const at = index.get(row.address.toLowerCase())
    if (at === undefined) {
      entries.push({
        address: row.address,
        quota: row.amount,
        minted: 0,
        state: 'pending',
        everWritten: false,
      })
      added++
    } else {
      const current = entries[at]!
      if (current.quota !== row.amount || current.state === 'removing') {
        entries[at] = { ...current, quota: row.amount, state: 'pending' }
        updated++
      }
    }
  }
  return { state: { ...state, entries }, added, updated }
}

export function setQuota(state: ListState, address: string, quota: number): ListState {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.address === address && entry.quota !== quota ? { ...entry, quota, state: 'pending' } : entry,
    ),
  }
}

export function setQuotaForAll(state: ListState, quota: number): ListState {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.state === 'removing' || entry.quota === quota ? entry : { ...entry, quota, state: 'pending' },
    ),
  }
}

/**
 * Removes an address. One that never reached the chain simply leaves the list; one on chain is
 * written with quota 0 first, so it stays listed as "removing" until that chunk lands.
 */
export function removeEntry(state: ListState, address: string): ListState {
  const entry = state.entries.find((candidate) => candidate.address === address)
  if (!entry) return state
  return {
    ...state,
    entries: !entry.everWritten
      ? state.entries.filter((candidate) => candidate.address !== address)
      : state.entries.map((candidate) =>
          candidate.address === address ? { ...candidate, state: 'removing' } : candidate,
        ),
  }
}

/** The quota sent for an entry: 0 for a removal. */
export const sentQuota = (entry: ListEntry) => (entry.state === 'removing' ? 0 : entry.quota)
