import { confirmationsFor, hasConfirmations, readEach } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { publicClientFor } from '@cobweb/shared/server'
import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { errorSummary } from '@/lib/art/lock-core'
import { readAll } from '@/lib/art/read-all'
import {
  CHAIN_NOT_READY,
  NAME_FIRST,
  NOT_DEPLOYED,
  PHASE_REVERTED,
  WHITELIST_FULL,
  WHITELIST_NOT_CONFIRMED,
  WRONG_GROUP,
} from '@/lib/art/result'
import { proveQuotaChunk } from '@/lib/chain/quota-chunk'
import type { Json } from '@/lib/database.types'
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import {
  phaseBase,
  phasesViewCore,
  readCollectionState,
  type PhaseBase,
  type PhasesContext,
} from './phases-core'
import type { StateReader } from './phases-types'
import type { ChunkEntry, ChunkPlan, GroupList, WhitelistView } from './whitelist-types'
import {
  byAddress,
  chunkPlanOf,
  entriesOf,
  listOf,
  whitelistGroups,
  WHITELIST_CHUNK,
  WHITELIST_MAX,
  writtenChunksOf,
  type EntryRow,
} from './whitelist-view'

/**
 * The Whitelist on the server (docs/specs/2026-10-15-whitelist.md, section 6): the view, the next chunk, the
 * confirm of a chunk from its receipt and calldata, the list edits and the usage read, on a Supabase client
 * acting as the signed-in creator. The actions (app/actions/whitelist.ts) call these after the session and
 * ownership check; verify:whitelist calls them with a signed-in script client. No `server-only` marker, so the
 * script can import it; the browser never does. The copies of what the chain holds are written only by
 * `whitelist_chunk_record`, from pairs a proven transaction carried, never from browser values.
 */
export type WhitelistContext = PhasesContext

/** The entry columns the view reads. */
const ENTRY_COLUMNS = 'wallet_address, quota, written_quota, written_tx, written_at'

/** Rows per `whitelist_entries_add` call, as many as PostgREST returns in one page. */
const ADD_PAGE = 1_000

/** The row id of each of the collection's groups, by on-chain id, under the creator's client. */
async function groupRowIds(ctx: WhitelistContext): Promise<Map<number, string>> {
  const { data, error } = await ctx.supabase
    .from('mint_groups')
    .select('id, onchain_id')
    .eq('collection_id', ctx.collection.id)
  if (error) throw new Error(`The phases could not be read: ${error.message}`)
  return new Map(data.map((row) => [row.onchain_id, row.id]))
}

/** Every entry of a group, a page of 1,000 at a time in address order. */
function entryRows(ctx: WhitelistContext, groupId: string): Promise<EntryRow[]> {
  return readAll((from, to) =>
    ctx.supabase
      .from('whitelist_entries')
      .select(ENTRY_COLUMNS)
      .eq('mint_group_id', groupId)
      .order('wallet_address')
      .range(from, to),
  )
}

/**
 * A list edit's starting point: the deployment (NOT_DEPLOYED before deploy, and for a stranger under the row
 * policies) and the group's row (NAME_FIRST for a group the chain lists without one). The public sale has no
 * whitelist.
 */
async function groupFor(
  ctx: WhitelistContext,
  onchainId: number,
): Promise<{ base: PhaseBase; id: string } | { refused: string }> {
  if (onchainId === 0) return { refused: WRONG_GROUP }
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  const id = (await groupRowIds(ctx)).get(onchainId)
  return id ? { base, id } : { refused: NAME_FIRST }
}

/**
 * What the Whitelist tab shows (section 6.2): the phases view (its refusal, its refresh of the copies, its copy
 * when the chain does not answer), its whitelist groups, and the entries of each group Cobweb has a row for.
 * Quota used is the group's minted count from the chain, 0 when the chain did not answer.
 */
export async function whitelistViewCore(
  ctx: WhitelistContext,
  read: StateReader = readCollectionState,
): Promise<DeployOutcome<WhitelistView>> {
  const phases = await phasesViewCore(ctx, read)
  if (!('data' in phases)) return phases
  const view = phases.data
  const groups = whitelistGroups(view)
  const ids = await groupRowIds(ctx)
  const lists: GroupList[] = []
  for (const group of groups) {
    const id = ids.get(group.id)
    if (!id) continue
    const rows = await entryRows(ctx, id)
    lists.push(
      listOf(group.id, entriesOf(rows), view.chainReachable ? group.minted : 0, writtenChunksOf(rows)),
    )
  }
  return {
    data: {
      chainId: view.chainId,
      contract: view.contract,
      groups,
      lists,
      chunkSize: WHITELIST_CHUNK,
      blockTimestamp: view.blockTimestamp,
      readAt: view.readAt,
      chainReachable: view.chainReachable,
    },
  }
}

/** The next chunk of a group, built from what the database holds now; null when every entry is written. */
export async function nextChunkCore(
  ctx: WhitelistContext,
  onchainId: number,
): Promise<DeployOutcome<ChunkPlan | null>> {
  const group = await groupFor(ctx, onchainId)
  if ('refused' in group) return group
  const rows = await entryRows(ctx, group.id)
  return { data: chunkPlanOf(listOf(onchainId, entriesOf(rows), 0, writtenChunksOf(rows))) }
}

/**
 * Confirms a chunk (section 6.2): the receipt (not found yet is WHITELIST_NOT_CONFIRMED, which the machine
 * polls; reverted is PHASE_REVERTED), the transaction's input (not found yet, the same), the proof from the
 * calldata, then the copies through `whitelist_chunk_record` and the view read at the receipt's block or later.
 * The copies are written only once the receipt is at the chain's confirmation depth (until then
 * WHITELIST_NOT_CONFIRMED, which the machine polls), because nothing reads them from the chain again.
 * The browser sends only the hash and the group. A second confirm of the same hash answers the view again.
 */
export async function confirmWhitelistChunkCore(
  ctx: WhitelistContext,
  txHash: Hex,
  onchainId: number,
  read: StateReader = readCollectionState,
): Promise<DeployOutcome<WhitelistView>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  const hash = txHash.toLowerCase() as Hex
  let client: PublicClient
  try {
    client = publicClientFor(base.chainId)
  } catch {
    return { refused: CHAIN_NOT_READY }
  }
  let receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>
  try {
    receipt = await client.getTransactionReceipt({ hash })
  } catch (error) {
    // Not mined yet, or not visible to this node yet: the machine asks again in 3 seconds.
    if (!(error instanceof TransactionReceiptNotFoundError))
      console.error(`The receipt could not be read: ${errorSummary(error)}`)
    return { refused: WHITELIST_NOT_CONFIRMED }
  }
  // sic: viem types the receipt as always present; a node can still answer with nothing.
  if (!receipt) return { refused: WHITELIST_NOT_CONFIRMED }
  if (receipt.status === 'reverted') return { refused: PHASE_REVERTED }
  // A receipt too shallow to survive a reorg is not recorded yet; the machine keeps asking. cacheTime 0:
  // viem reuses a block number for the poll interval, which can read older than the receipt just fetched.
  try {
    const latest = await client.getBlockNumber({ cacheTime: 0 })
    if (!hasConfirmations(receipt.blockNumber, latest, confirmationsFor(base.chainId)))
      return { refused: WHITELIST_NOT_CONFIRMED }
  } catch (error) {
    console.error(`The latest block could not be read: ${errorSummary(error)}`)
    return { refused: WHITELIST_NOT_CONFIRMED }
  }
  let input: Hex
  try {
    input = (await client.getTransaction({ hash })).input
  } catch (error) {
    if (!(error instanceof TransactionNotFoundError))
      console.error(`The transaction could not be read: ${errorSummary(error)}`)
    return { refused: WHITELIST_NOT_CONFIRMED }
  }
  const proof = proveQuotaChunk(receipt, input, { contract: base.contract, from: ctx.wallet, onchainId })
  if (!proof.ok) return { refused: proof.error }
  const recorded = await ctx.service().rpc('whitelist_chunk_record', {
    p_collection_id: ctx.collection.id,
    p_owner: ctx.owner,
    p_onchain_id: onchainId,
    p_tx: hash,
    p_rows: proof.pairs as unknown as Json,
  })
  if (recorded.error) return { error: recorded.error }
  const block = receipt.blockNumber
  return whitelistViewCore(ctx, (chainId, address) => read(chainId, address, block))
}

/**
 * Adds rows and changes listed quotas (section 6.3), under the creator's client: WHITELIST_FULL when the new
 * addresses would pass 10,000 (nothing written), then pages of 1,000 to `whitelist_entries_add` in turn, the
 * answers summed. A page refused after others landed answers its sentence; the screen reads the view again.
 * `rows` must already be unique by lowercase address (the action's `addEntriesShape` merges repeats, the last
 * quota winning; a direct caller must do the same, since `whitelist_entries_add` raises 21000 on a repeat).
 */
export async function addEntriesCore(
  ctx: WhitelistContext,
  onchainId: number,
  rows: ChunkEntry[],
): Promise<DeployOutcome<{ added: number; updated: number }>> {
  const group = await groupFor(ctx, onchainId)
  if ('refused' in group) return group
  const listed = await readAll<{ wallet_address: string }>((from, to) =>
    ctx.supabase
      .from('whitelist_entries')
      .select('wallet_address')
      .eq('mint_group_id', group.id)
      .order('wallet_address')
      .range(from, to),
  )
  const known = new Set(listed.map((row) => row.wallet_address))
  const fresh = rows.filter((row) => !known.has(row.address.toLowerCase())).length
  if (known.size + fresh > WHITELIST_MAX) return { refused: WHITELIST_FULL }
  let added = 0
  let updated = 0
  for (let from = 0; from < rows.length; from += ADD_PAGE) {
    // Address order, the order a chunk's record locks rows in, so an add and a confirm cannot deadlock.
    const page = rows
      .slice(from, from + ADD_PAGE)
      .map((row) => ({ address: row.address.toLowerCase(), quota: row.quota }))
      .sort(byAddress)
    const { data, error } = await ctx.supabase.rpc('whitelist_entries_add', {
      p_collection_id: ctx.collection.id,
      p_onchain_id: onchainId,
      p_rows: page as unknown as Json,
    })
    if (error) return { error }
    added += data[0]?.added ?? 0
    updated += data[0]?.updated ?? 0
  }
  return { data: { added, updated } }
}

/** One address's quota, through `whitelist_entries_add`, so it also puts back a row a removal deleted (Undo). */
export async function setEntryQuotaCore(
  ctx: WhitelistContext,
  onchainId: number,
  address: Address,
  quota: number,
): Promise<DeployOutcome<undefined>> {
  const group = await groupFor(ctx, onchainId)
  if ('refused' in group) return group
  const { error } = await ctx.supabase.rpc('whitelist_entries_add', {
    p_collection_id: ctx.collection.id,
    p_onchain_id: onchainId,
    p_rows: [{ address: address.toLowerCase(), quota }] as unknown as Json,
  })
  return error ? { error } : { data: undefined }
}

/** Set quota for all: every row above 0 whose quota differs, counted; staged removals stay at 0. */
export async function setQuotaForAllCore(
  ctx: WhitelistContext,
  onchainId: number,
  quota: number,
): Promise<DeployOutcome<{ changed: number }>> {
  const group = await groupFor(ctx, onchainId)
  if ('refused' in group) return group
  const { count, error } = await ctx.supabase
    .from('whitelist_entries')
    .update({ quota }, { count: 'exact' })
    .eq('mint_group_id', group.id)
    .gt('quota', 0)
    .neq('quota', quota)
  return error ? { error } : { data: { changed: count ?? 0 } }
}

/**
 * Remove: a row the chain was never proven to hold (or holds at 0) is deleted (`staged: false`); a written one
 * keeps its row at quota 0 until a chunk writes the zero (`staged: true`). The delete is filtered on the copy,
 * so a chunk confirmed in between turns it into a staged removal.
 */
export async function removeEntryCore(
  ctx: WhitelistContext,
  onchainId: number,
  address: Address,
): Promise<DeployOutcome<{ staged: boolean }>> {
  const group = await groupFor(ctx, onchainId)
  if ('refused' in group) return group
  const wallet = address.toLowerCase()
  const removed = await ctx.supabase
    .from('whitelist_entries')
    .delete({ count: 'exact' })
    .eq('mint_group_id', group.id)
    .eq('wallet_address', wallet)
    .or('written_quota.is.null,written_quota.eq.0')
  if (removed.error) return { error: removed.error }
  if (removed.count) return { data: { staged: false } }
  const staged = await ctx.supabase
    .from('whitelist_entries')
    .update({ quota: 0 }, { count: 'exact' })
    .eq('mint_group_id', group.id)
    .eq('wallet_address', wallet)
  if (staged.error) return { error: staged.error }
  return { data: { staged: (staged.count ?? 0) > 0 } }
}

/**
 * Quota used per address (section 6.3): `quotaClaimed(group, address)` for a page of the table through
 * `readEach`, all null when the chain does not answer.
 */
export async function quotaUsageCore(
  ctx: WhitelistContext,
  onchainId: number,
  addresses: Address[],
): Promise<DeployOutcome<(number | null)[]>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  try {
    const claimed = await readEach<bigint>(
      publicClientFor(base.chainId),
      addresses.map((address) => ({
        address: base.contract,
        abi: collectionAbi,
        functionName: 'quotaClaimed',
        args: [BigInt(onchainId), address],
      })),
    )
    return { data: claimed.map((value) => (value === null ? null : Number(value))) }
  } catch (error) {
    console.error(`The quota used could not be read on chain ${base.chainId}: ${errorSummary(error)}`)
    return { data: addresses.map(() => null) }
  }
}
