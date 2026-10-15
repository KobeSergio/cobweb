import { getAddress, type Address, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_COLLECTION, DEMO_MINTER, sampleTxHash } from '@/lib/demo'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { GroupList, ListEntry, WhitelistView } from '@/lib/manage/whitelist-types'
import { chunkPlanOf, listOf } from '@/lib/manage/whitelist-view'
import {
  sampleApplyQuotas,
  sampleSentChunk,
  sampleWhitelistServer,
  sampleWhitelistView,
} from './whitelist-sim'

const view: WhitelistView = sampleWhitelistView({ max_supply: DEMO_COLLECTION.maxSupply })
const HASH: Hex = `0x${'cd'.repeat(32)}`
const NEW: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const UNLISTED: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

const listIn = (current: WhitelistView, onchainId: number): GroupList => {
  const list = current.lists.find((candidate) => candidate.onchainId === onchainId)
  if (!list) throw new Error(`no list ${onchainId}`)
  return list
}
/** The view with one list's entries replaced, counted again. */
const withEntries = (current: WhitelistView, onchainId: number, entries: ListEntry[]): WhitelistView => ({
  ...current,
  lists: current.lists.map((list) =>
    list.onchainId === onchainId ? listOf(onchainId, entries, list.quotaUsed, list.chunks) : list,
  ),
})
/** The call that writes a plan, as the dialog builds it. */
const callFor = (current: WhitelistView, onchainId: number): ManageCall => {
  const plan = chunkPlanOf(listIn(current, onchainId))
  if (!plan) throw new Error('nothing to write')
  return phaseCalls.quotas(
    onchainId,
    plan.entries.map((entry) => entry.address),
    plan.entries.map((entry) => entry.quota),
  )
}

describe('sampleWhitelistView', () => {
  it('shows the Owl List with 500 addresses written and 120 waiting and Team written, checksummed, in address order', () => {
    expect(view.groups.map((group) => group.name)).toEqual(['Owl List', 'Team'])
    const owl = listIn(view, 1)
    expect(owl).toMatchObject({ total: 620, written: 500, unwritten: 120, quotaUsed: 186 })
    expect(owl.chunks.map((chunk) => chunk.addresses)).toEqual([500])
    expect(listIn(view, 2)).toMatchObject({ total: 12, written: 12, unwritten: 0, quotaUsed: 40 })
    const lowercase = owl.entries.map((entry) => entry.address.toLowerCase())
    expect(lowercase).toEqual([...lowercase].sort())
    expect(owl.entries.every((entry) => entry.address === getAddress(entry.address))).toBe(true)
  })

  it('reads no quota used from the copy (?chain=unreachable)', () => {
    const copy = sampleWhitelistView({ max_supply: DEMO_COLLECTION.maxSupply }, false)
    expect(copy.chainReachable).toBe(false)
    expect(copy.lists.map((list) => list.quotaUsed)).toEqual([0, 0])
  })
})

describe('sampleApplyQuotas', () => {
  it('writes the copies of the pairs a chunk carried and counts the chunk', () => {
    const next = sampleApplyQuotas(callFor(view, 1), view, HASH)
    expect(listIn(next, 1)).toMatchObject({ written: 620, unwritten: 0 })
    expect(listIn(next, 1).chunks.map((chunk) => [chunk.txHash, chunk.addresses])).toEqual([
      [listIn(view, 1).chunks[0]?.txHash, 500],
      [HASH, 120],
    ])
    expect(chunkPlanOf(listIn(next, 1))).toBeNull()
  })

  it('creates an address it wrote above 0, deletes a written zero, and creates nothing for an unlisted zero', () => {
    const [first, second] = listIn(view, 2).entries
    if (!first || !second) throw new Error('the sample has two entries')
    const staged = withEntries(
      view,
      2,
      listIn(view, 2).entries.map((entry) =>
        entry.address === first.address ? { ...entry, quota: 0 } : entry,
      ),
    )
    const next = sampleApplyQuotas(
      phaseCalls.quotas(2, [first.address, NEW, UNLISTED], [0, 5, 0]),
      staged,
      HASH,
    )
    const entries = listIn(next, 2).entries
    expect(entries.some((entry) => entry.address === first.address)).toBe(false)
    expect(entries.some((entry) => entry.address === UNLISTED)).toBe(false)
    expect(entries.find((entry) => entry.address === NEW)).toEqual<ListEntry>({
      address: NEW,
      quota: 5,
      writtenQuota: 5,
      writtenTx: HASH,
    })
    expect(entries.find((entry) => entry.address === second.address)).toEqual(second)
  })

  it('leaves the view as it is for any other call', () => {
    expect(sampleApplyQuotas(phaseCalls.open(1), view, HASH)).toBe(view)
  })
})

describe('sampleSentChunk', () => {
  it('waits on the first list with an address not written, and on none when every address is written', () => {
    expect(sampleSentChunk(view)).toEqual({ hash: sampleTxHash(41), onchainId: 1 })
    expect(sampleSentChunk(sampleApplyQuotas(callFor(view, 1), view, HASH))).toBeNull()
  })
})

describe('sampleWhitelistServer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A server call, settled after the sample's 900 ms. */
  async function settle<T>(call: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(900)
    return call
  }

  it('confirms the call the simulated wallet sent with the hash, or the next chunk for a hash it never sent', async () => {
    const sent = new Map<Hex, ManageCall>()
    let current = view
    const server = sampleWhitelistServer(() => current, sent)
    const nextChunk = await settle(server.nextChunk(1))
    expect(nextChunk.ok && nextChunk.data).toMatchObject({ onchainId: 1, number: 2, of: 2 })
    sent.set(HASH, phaseCalls.quotas(1, [NEW], [3]))
    const confirmed = await settle(server.confirmChunk(HASH, 1))
    if (!confirmed.ok) throw new Error(confirmed.error)
    expect(listIn(confirmed.data, 1).entries.find((entry) => entry.address === NEW)?.writtenQuota).toBe(3)
    current = confirmed.data
    const unknown = await settle(server.confirmChunk(sampleTxHash(41), 1))
    expect(unknown.ok && listIn(unknown.data, 1).unwritten).toBe(0)
  })

  it('answers the counts the screen patches produce', async () => {
    const server = sampleWhitelistServer(() => view)
    const owl = listIn(view, 1)
    const [written] = owl.entries.filter((entry) => entry.writtenQuota !== null)
    const [waiting] = owl.entries.filter((entry) => entry.writtenQuota === null)
    if (!written || !waiting) throw new Error('the sample has written and waiting entries')
    expect(
      await settle(
        server.addEntries(1, [
          { address: NEW, quota: 1 },
          { address: written.address, quota: written.quota },
          { address: waiting.address, quota: waiting.quota + 1 },
        ]),
      ),
    ).toEqual({ ok: true, data: { added: 1, updated: 1 } })
    const changed = owl.entries.filter((entry) => entry.quota > 0 && entry.quota !== 2).length
    expect(await settle(server.setQuotaForAll(1, 2))).toEqual({ ok: true, data: { changed } })
    expect(await settle(server.removeEntry(1, written.address))).toEqual({ ok: true, data: { staged: true } })
    expect(await settle(server.removeEntry(1, waiting.address))).toEqual({
      ok: true,
      data: { staged: false },
    })
  })

  it("reads the sample's minted count, 0 for an address added in the visit, null while the chain cannot be read", async () => {
    const server = sampleWhitelistServer(() => view)
    expect(await settle(server.quotaUsage(1, [getAddress(DEMO_MINTER), NEW]))).toEqual({
      ok: true,
      data: [1, 0],
    })
    const copy = sampleWhitelistView({ max_supply: DEMO_COLLECTION.maxSupply }, false)
    const unread = sampleWhitelistServer(() => copy)
    expect(await settle(unread.quotaUsage(1, [NEW]))).toEqual({ ok: true, data: [null] })
  })
})
