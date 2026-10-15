import type { Address, Hex } from 'viem'
import {
  addEntries,
  confirmWhitelistChunk,
  getWhitelist,
  nextChunk,
  quotaUsage,
  removeEntry,
  setEntryQuota,
  setQuotaForAll,
} from '@/app/actions/whitelist'
import type { ActionResult } from '@/lib/art/result'
import type { ChunkEntry, ChunkPlan, WhitelistView } from '@/lib/manage/whitelist-types'

/**
 * The Whitelist's server, bound to one collection (docs/specs/2026-10-15-whitelist.md, section 7.2): the eight
 * actions in one object, which `sampleWhitelistServer` (whitelist-sim.ts) mirrors in sample mode.
 */
export type WhitelistServer = {
  read(): Promise<ActionResult<WhitelistView>>
  nextChunk(onchainId: number): Promise<ActionResult<ChunkPlan | null>>
  confirmChunk(hash: Hex, onchainId: number): Promise<ActionResult<WhitelistView>>
  addEntries(onchainId: number, rows: ChunkEntry[]): Promise<ActionResult<{ added: number; updated: number }>>
  setEntryQuota(onchainId: number, address: Address, quota: number): Promise<ActionResult>
  setQuotaForAll(onchainId: number, quota: number): Promise<ActionResult<{ changed: number }>>
  removeEntry(onchainId: number, address: Address): Promise<ActionResult<{ staged: boolean }>>
  quotaUsage(onchainId: number, addresses: Address[]): Promise<ActionResult<(number | null)[]>>
}

export function whitelistServer(collectionId: string): WhitelistServer {
  return {
    read: () => getWhitelist(collectionId),
    nextChunk: (onchainId) => nextChunk(collectionId, onchainId),
    confirmChunk: (hash, onchainId) => confirmWhitelistChunk(collectionId, hash, onchainId),
    addEntries: (onchainId, rows) => addEntries(collectionId, onchainId, rows),
    setEntryQuota: (onchainId, address, quota) => setEntryQuota(collectionId, onchainId, address, quota),
    setQuotaForAll: (onchainId, quota) => setQuotaForAll(collectionId, onchainId, quota),
    removeEntry: (onchainId, address) => removeEntry(collectionId, onchainId, address),
    quotaUsage: (onchainId, addresses) => quotaUsage(collectionId, onchainId, addresses),
  }
}
