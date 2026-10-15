'use server'

import { cache } from 'react'
import { whitelistWriteError } from '@/lib/art/db-error'
import { txHash as txHashSchema } from '@/lib/art/lock-schemas'
import type { ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import { readCollectionState } from '@/lib/manage/phases-core'
import { phasesWrite } from '@/lib/manage/phases-write'
import {
  addEntriesCore,
  confirmWhitelistChunkCore,
  nextChunkCore,
  quotaUsageCore,
  removeEntryCore,
  setEntryQuotaCore,
  setQuotaForAllCore,
  whitelistViewCore,
} from '@/lib/manage/whitelist-core'
import {
  addEntriesShape,
  addressShape,
  groupIdShape,
  quotaShape,
  usageShape,
} from '@/lib/manage/whitelist-schemas'
import type { ChunkPlan, WhitelistView } from '@/lib/manage/whitelist-types'

/**
 * The Whitelist's server actions (docs/specs/2026-10-15-whitelist.md, section 6.5). Each checks its input first,
 * then runs through `phasesWrite`, which checks the session and the ownership (CLAUDE.md rule 4), with the
 * whitelist's sentences for a database refusal. The browser never writes what the chain holds: a confirm proves
 * the chunk from its receipt and calldata and answers the view the server read.
 */

/** One chain read per request, however many times a page asks (React's cache). */
const readOnce = cache(readCollectionState)

/** The whitelist groups and their lists, read on the server. */
export async function getWhitelist(collectionId: string): Promise<ActionResult<WhitelistView>> {
  return phasesWrite(collectionId, (ctx) => whitelistViewCore(ctx, readOnce), whitelistWriteError)
}

/** The next chunk of a group, built from what the database holds now; null when every address is written. */
export async function nextChunk(
  collectionId: string,
  onchainId: number,
): Promise<ActionResult<ChunkPlan | null>> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  return phasesWrite(collectionId, (ctx) => nextChunkCore(ctx, id.data), whitelistWriteError)
}

/** Confirms a chunk from its receipt and calldata, records what it wrote, then answers the fresh view. */
export async function confirmWhitelistChunk(
  collectionId: string,
  txHash: string,
  onchainId: number,
): Promise<ActionResult<WhitelistView>> {
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  return phasesWrite(
    collectionId,
    (ctx) => confirmWhitelistChunkCore(ctx, hash.data, id.data),
    whitelistWriteError,
  )
}

/** Adds addresses and changes listed quotas; the next chunks write them. */
export async function addEntries(
  collectionId: string,
  onchainId: number,
  rows: { address: string; quota: number }[],
): Promise<ActionResult<{ added: number; updated: number }>> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  const input = parse(addEntriesShape, rows)
  if (!input.ok) return input
  return phasesWrite(collectionId, (ctx) => addEntriesCore(ctx, id.data, input.data), whitelistWriteError)
}

/** One address's quota, or an address put back after a removal (Undo). */
export async function setEntryQuota(
  collectionId: string,
  onchainId: number,
  address: string,
  quota: number,
): Promise<ActionResult> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  const wallet = parse(addressShape, address)
  if (!wallet.ok) return wallet
  const value = parse(quotaShape, quota)
  if (!value.ok) return value
  return phasesWrite(
    collectionId,
    (ctx) => setEntryQuotaCore(ctx, id.data, wallet.data, value.data),
    whitelistWriteError,
  )
}

/** Set quota for all: every listed address above 0 gets the quota. */
export async function setQuotaForAll(
  collectionId: string,
  onchainId: number,
  quota: number,
): Promise<ActionResult<{ changed: number }>> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  const value = parse(quotaShape, quota)
  if (!value.ok) return value
  return phasesWrite(collectionId, (ctx) => setQuotaForAllCore(ctx, id.data, value.data), whitelistWriteError)
}

/** Removes an address: at once when the chain never held it, else staged as a zero for the next chunk. */
export async function removeEntry(
  collectionId: string,
  onchainId: number,
  address: string,
): Promise<ActionResult<{ staged: boolean }>> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  const wallet = parse(addressShape, address)
  if (!wallet.ok) return wallet
  return phasesWrite(collectionId, (ctx) => removeEntryCore(ctx, id.data, wallet.data), whitelistWriteError)
}

/** Quota used per address for a page of the table, from the chain; null where it did not answer. */
export async function quotaUsage(
  collectionId: string,
  onchainId: number,
  addresses: string[],
): Promise<ActionResult<(number | null)[]>> {
  const id = parse(groupIdShape, onchainId)
  if (!id.ok) return id
  const page = parse(usageShape, addresses)
  if (!page.ok) return page
  return phasesWrite(collectionId, (ctx) => quotaUsageCore(ctx, id.data, page.data), whitelistWriteError)
}
