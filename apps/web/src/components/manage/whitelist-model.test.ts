import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { GroupList, ListEntry, WrittenChunk } from '@/lib/manage/whitelist-types'
import { chunkPlanOf, listOf } from '@/lib/manage/whitelist-view'
import {
  capRoom,
  chunkRows,
  entryState,
  withAdded,
  withQuota,
  withQuotaForAll,
  withRemoved,
  withRestored,
  type ChunkRow,
} from './whitelist-model'

// In lowercase address order: 0x15d3, 0x3c44, 0x7099, 0x90f7.
const FIRST: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const SECOND: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const THIRD: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const FOURTH: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const TX: Hex = `0x${'a1'.repeat(32)}`
const LATER: Hex = `0x${'b2'.repeat(32)}`

const entry = (
  address: Address,
  quota: number,
  writtenQuota: number | null = null,
  writtenTx: Hex | null = null,
): ListEntry => ({
  address,
  quota,
  writtenQuota,
  writtenTx,
})
const chunks: WrittenChunk[] = [
  { txHash: TX, addresses: 2, writtenAt: 1 },
  { txHash: LATER, addresses: 1, writtenAt: 2 },
]
/** SECOND written at 2, THIRD written at 1 and listed at 3 now, FOURTH never written. */
const list: GroupList = listOf(
  1,
  [entry(SECOND, 2, 2, TX), entry(THIRD, 3, 1, LATER), entry(FOURTH, 1)],
  4,
  chunks,
)

describe('entryState', () => {
  it('reads written, waiting or a removal waiting for its zero', () => {
    expect(entryState(entry(FIRST, 2, 2, TX))).toBe('written')
    expect(entryState(entry(FIRST, 2, 1, TX))).toBe('pending')
    expect(entryState(entry(FIRST, 2))).toBe('pending')
    expect(entryState(entry(FIRST, 0, 2, TX))).toBe('removing')
  })
})

describe('the patches', () => {
  it('adds a new address in address order and changes a listed quota, keeping the copies, whatever the case', () => {
    const next = withAdded(list, [
      { address: FIRST, quota: 5 },
      { address: SECOND.toLowerCase() as Address, quota: 4 },
    ])
    expect(next.entries).toEqual<ListEntry[]>([
      entry(FIRST, 5),
      entry(SECOND, 4, 2, TX),
      entry(THIRD, 3, 1, LATER),
      entry(FOURTH, 1),
    ])
    expect(next).toMatchObject({ total: 4, written: 0, unwritten: 4, totalQuota: 13, quotaUsed: 4 })
  })

  it('re-adding a staged removal at its written quota reads it written again, with no chunk waiting (Review Focus 2)', () => {
    const staged = withRemoved(listOf(1, [entry(SECOND, 2, 2, TX)], 0, chunks), SECOND)
    expect(entryState(staged.entries[0]!)).toBe('removing')
    expect(chunkPlanOf(staged)?.entries).toEqual([{ address: SECOND, quota: 0 }])
    const back = withAdded(staged, [{ address: SECOND, quota: 2 }])
    expect(entryState(back.entries[0]!)).toBe('written')
    expect(back.unwritten).toBe(0)
    expect(chunkPlanOf(back)).toBeNull()
  })

  it('sets one quota, and reads it written again when it goes back to what the chain holds', () => {
    expect(withQuota(list, THIRD, 7).entries[1]).toEqual(entry(THIRD, 7, 1, LATER))
    const back = withQuota(list, THIRD, 1)
    expect(entryState(back.entries[1]!)).toBe('written')
    expect(back.written).toBe(2)
  })

  it('sets one quota for every entry above 0 and leaves a staged removal at 0', () => {
    const staged = withRemoved(list, SECOND)
    expect(withQuotaForAll(staged, 2).entries.map((candidate) => candidate.quota)).toEqual([0, 2, 2])
  })

  it('stages a written removal at 0 and drops a never-written one, recounting the chunks', () => {
    const staged = withRemoved(list, SECOND)
    expect(staged.entries[0]).toEqual(entry(SECOND, 0, 2, TX))
    expect(staged).toMatchObject({ total: 2, unwritten: 3 })
    const dropped = withRemoved(list, FOURTH)
    expect(dropped.entries.map((candidate) => candidate.address)).toEqual([SECOND, THIRD])
    const zeroWritten = listOf(1, [entry(SECOND, 2, 0, TX), entry(THIRD, 1, 1, TX)], 0, chunks)
    expect(withRemoved(zeroWritten, SECOND).chunks).toEqual<WrittenChunk[]>([
      { txHash: TX, addresses: 1, writtenAt: 1 },
    ])
  })

  it('puts an entry back in its place by address', () => {
    const dropped = withRemoved(list, FOURTH)
    expect(withRestored(dropped, entry(FOURTH, 1)).entries).toEqual(list.entries)
    const staged = withRemoved(list, SECOND)
    expect(withRestored(staged, entry(SECOND, 2, 2, TX)).entries).toEqual(list.entries)
  })
})

describe('capRoom', () => {
  it('counts a staged removal as a listed row against the cap (Review Focus 3)', () => {
    const existing = new Set([SECOND, THIRD].map((address) => address.toLowerCase()))
    expect(
      capRoom(existing, [{ address: FIRST }, { address: SECOND }, { address: FIRST.toLowerCase() }]),
    ).toEqual({
      fresh: 1,
      room: 9_998,
    })
    const staged = withRemoved(list, SECOND)
    expect(capRoom(new Set(staged.entries.map((candidate) => candidate.address.toLowerCase())), [])).toEqual({
      fresh: 0,
      room: 9_997,
    })
  })
})

describe('chunkRows', () => {
  it('lists the written chunks with their transactions, then the next and the waiting ones', () => {
    const waiting = listOf(
      1,
      Array.from({ length: 1_100 }, (_, index) =>
        entry(`0x${(index + 1).toString(16).padStart(40, '0')}`, 1),
      ),
      0,
      [],
    )
    expect(chunkRows(waiting, 500, null)).toEqual<ChunkRow[]>([
      { number: 1, addresses: 500, status: 'next' },
      { number: 2, addresses: 500, status: 'waiting' },
      { number: 3, addresses: 100, status: 'waiting' },
    ])
    expect(chunkRows(list, 500, null)).toEqual<ChunkRow[]>([
      { number: 1, addresses: 1, status: 'written', txHash: TX },
      { number: 2, addresses: 1, status: 'written', txHash: LATER },
      { number: 3, addresses: 2, status: 'next' },
    ])
  })

  it('marks the next chunk failed with its error after a failure in this visit', () => {
    expect(chunkRows(list, 500, 'Cancelled in your wallet')[2]).toEqual<ChunkRow>({
      number: 3,
      addresses: 2,
      status: 'failed',
      error: 'Cancelled in your wallet',
    })
    expect(chunkRows(listOf(1, [entry(SECOND, 2, 2, TX)], 0, chunks), 500, 'Failed')).toEqual<ChunkRow[]>([
      { number: 1, addresses: 1, status: 'written', txHash: TX },
    ])
  })
})
