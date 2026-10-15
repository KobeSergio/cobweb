/**
 * Sample mode for the Whitelist tab (docs/specs/2026-10-15-whitelist.md, section 8). Nothing here talks to a
 * wallet, an RPC or the database: `sampleWhitelistServer` has the shape of `whitelistServer`
 * (whitelist-server.ts), and its confirm applies exactly the call the simulated wallet sent, as
 * `whitelist_chunk_record` would, so the screen runs the same code in both modes.
 */
import { getAddress, type Hex } from 'viem'
import type { ActionResult } from '@/lib/art/result'
import { DEMO_NOW, DEMO_WHITELISTS, sampleTxHash, type GroupWhitelist } from '@/lib/demo'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type {
  GroupList,
  ListEntry,
  SentChunk,
  WhitelistView,
  WrittenChunk,
} from '@/lib/manage/whitelist-types'
import { byAddress, chunkPlanOf, listOf, whitelistGroups, WHITELIST_CHUNK } from '@/lib/manage/whitelist-view'
import { samplePhasesView } from './manage-sim'
import type { WhitelistServer } from './whitelist-server'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A sample list as the server would read it: an entry in a written sample chunk carries its quota and that chunk's hash. */
function sampleList(sample: GroupWhitelist, quotaUsed: number): GroupList {
  const written = sample.chunks.filter((chunk) => chunk.status === 'written')
  const hashOf = (index: number) => written[index]?.txHash ?? sampleTxHash(sample.groupId * 100 + index)
  const entries = sample.entries
    .map((entry, position): ListEntry => {
      const index = written.findIndex((chunk) => position >= chunk.from && position < chunk.to)
      return {
        address: getAddress(entry.address),
        quota: entry.quota,
        writtenQuota: index < 0 ? null : entry.quota,
        writtenTx: index < 0 ? null : hashOf(index),
      }
    })
    .sort(byAddress)
  const chunks = written.map((chunk, index): WrittenChunk => ({
    txHash: hashOf(index),
    addresses: chunk.to - chunk.from,
    // An hour apart, ending an hour before the sample's clock.
    writtenAt: (DEMO_NOW - (written.length - index) * 3_600) * 1_000,
  }))
  return listOf(sample.groupId, entries, quotaUsed, chunks)
}

/**
 * The sample's whitelists on the whitelist groups of `samplePhasesView` (scaled as Phases scales them): the Owl
 * List with 500 addresses written and 120 waiting, Team written. With `chainReachable` false, the copy:
 * quota used is not read (`?chain=unreachable`).
 */
export function sampleWhitelistView(
  collection: { max_supply: number | null },
  chainReachable = true,
): WhitelistView {
  const phases = samplePhasesView(collection, chainReachable)
  const groups = whitelistGroups(phases)
  const lists = groups.flatMap((group) => {
    const sample = DEMO_WHITELISTS.find((list) => list.groupId === group.id)
    return sample ? [sampleList(sample, chainReachable ? group.minted : 0)] : []
  })
  return {
    chainId: phases.chainId,
    contract: phases.contract,
    groups,
    lists,
    chunkSize: WHITELIST_CHUNK,
    blockTimestamp: phases.blockTimestamp,
    readAt: phases.readAt,
    chainReachable: phases.chainReachable,
  }
}

/**
 * The view after a `setMintQuota` lands, as `whitelist_chunk_record` writes it: each pair's copies on its
 * entry (an address above 0 the list does not hold becomes an entry, written), a written zero's entry deleted
 * once its listed quota is 0 too, and the chunk counted by the entries that name it.
 */
export function sampleApplyQuotas(call: ManageCall, view: WhitelistView, hash: Hex): WhitelistView {
  if (call.functionName !== 'setMintQuota') return view
  const [addresses, group, quotas] = call.args
  const onchainId = Number(group)
  const list = view.lists.find((candidate) => candidate.onchainId === onchainId)
  if (!list) return view
  const tx = hash.toLowerCase() as Hex
  const pairs = new Map<string, number>()
  addresses.forEach((address, index) => pairs.set(address.toLowerCase(), Number(quotas[index] ?? 0n)))
  const listed = new Set(list.entries.map((entry) => entry.address.toLowerCase()))
  const entries = list.entries.flatMap((entry): ListEntry[] => {
    const written = pairs.get(entry.address.toLowerCase())
    if (written === undefined) return [entry]
    return written === 0 && entry.quota === 0 ? [] : [{ ...entry, writtenQuota: written, writtenTx: tx }]
  })
  for (const [address, quota] of pairs)
    if (quota > 0 && !listed.has(address))
      entries.push({ address: getAddress(address), quota, writtenQuota: quota, writtenTx: tx })
  entries.sort(byAddress)
  const chunks = list.chunks.some((chunk) => chunk.txHash === tx)
    ? list.chunks
    : [
        ...list.chunks,
        {
          txHash: tx,
          addresses: 0,
          writtenAt: Math.max(0, ...list.chunks.map((chunk) => chunk.writtenAt)) + 1_000,
        },
      ]
  const next = listOf(onchainId, entries, list.quotaUsed, chunks)
  return { ...view, lists: view.lists.map((candidate) => (candidate === list ? next : candidate)) }
}

/**
 * The sample server: every answer takes 900 ms. A confirm applies the call the simulated wallet sent with that
 * hash, or the group's next chunk for a hash it never sent (`?chunk=pending`); the edits answer the counts the
 * screen's patches produce; quota used is the sample's minted count (0 for an address added in the visit, null
 * while the chain cannot be read).
 */
export function sampleWhitelistServer(
  current: () => WhitelistView,
  sent: Map<Hex, ManageCall> = new Map(),
): WhitelistServer {
  const answer = async <T>(data: () => T): Promise<ActionResult<T>> => {
    await wait(900)
    return { ok: true, data: data() }
  }
  const listFor = (onchainId: number) => current().lists.find((list) => list.onchainId === onchainId)
  const entryOf = (onchainId: number, address: string) =>
    listFor(onchainId)?.entries.find((entry) => entry.address.toLowerCase() === address.toLowerCase())
  const minted = new Map(
    DEMO_WHITELISTS.flatMap((list) =>
      list.entries.map((entry) => [`${list.groupId}:${entry.address.toLowerCase()}`, entry.minted] as const),
    ),
  )
  return {
    read: () => answer(current),
    nextChunk: (onchainId) =>
      answer(() => {
        const list = listFor(onchainId)
        return list ? chunkPlanOf(list) : null
      }),
    confirmChunk: (hash, onchainId) =>
      answer(() => {
        const view = current()
        const list = view.lists.find((candidate) => candidate.onchainId === onchainId)
        const plan = list ? chunkPlanOf(list) : null
        const call =
          sent.get(hash) ??
          (plan
            ? phaseCalls.quotas(
                onchainId,
                plan.entries.map((entry) => entry.address),
                plan.entries.map((entry) => entry.quota),
              )
            : null)
        return call ? sampleApplyQuotas(call, view, hash) : view
      }),
    addEntries: (onchainId, rows) =>
      answer(() => {
        let added = 0
        let updated = 0
        for (const row of rows) {
          const entry = entryOf(onchainId, row.address)
          if (!entry) added++
          else if (entry.quota !== row.quota) updated++
        }
        return { added, updated }
      }),
    setEntryQuota: () => answer(() => undefined),
    setQuotaForAll: (onchainId, quota) =>
      answer(() => ({
        changed:
          listFor(onchainId)?.entries.filter((entry) => entry.quota > 0 && entry.quota !== quota).length ?? 0,
      })),
    removeEntry: (onchainId, address) =>
      answer(() => ({ staged: Boolean(entryOf(onchainId, address)?.writtenQuota) })),
    quotaUsage: (onchainId, addresses) =>
      answer(() =>
        addresses.map((address) =>
          current().chainReachable ? (minted.get(`${onchainId}:${address.toLowerCase()}`) ?? 0) : null,
        ),
      ),
  }
}

/** The chunk `?chunk=pending` shows waiting to be confirmed: on the first list with an address not written. */
export function sampleSentChunk(view: WhitelistView): SentChunk | null {
  const list = view.lists.find((candidate) => candidate.unwritten > 0)
  return list ? { hash: sampleTxHash(41), onchainId: list.onchainId } : null
}
