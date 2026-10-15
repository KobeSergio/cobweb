import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { MintGroup } from '@/lib/demo/types'
import type { PhasesView } from './phases-types'
import type { ListEntry, WrittenChunk } from './whitelist-types'
import {
  chunkPlanOf,
  entriesOf,
  isWritten,
  listOf,
  whitelistGroups,
  writtenChunksOf,
  type EntryRow,
} from './whitelist-view'

// In lowercase address order: 0x15d3, 0x3c44, 0x7099, 0x90f7.
const FIRST: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const SECOND: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const THIRD: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const FOURTH: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const TX_A: Hex = `0x${'a1'.repeat(32)}`
const TX_B: Hex = `0x${'b2'.repeat(32)}`
const TX_GONE: Hex = `0x${'c3'.repeat(32)}`

const row = (
  wallet: Address,
  quota: number,
  written: number | null = null,
  tx: Hex | null = null,
  at: string | null = null,
): EntryRow => ({
  wallet_address: wallet.toLowerCase(),
  quota,
  written_quota: written,
  written_tx: tx,
  written_at: at,
})

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

describe('entriesOf and writtenChunksOf', () => {
  it('reads the rows as checksummed entries in lowercase address order', () => {
    const entries = entriesOf([
      row(THIRD, 2, 2, TX_A, '2026-10-15T08:00:00Z'),
      row(FIRST, 1),
      row(SECOND, 0, 3, TX_A, '2026-10-15T08:00:00Z'),
    ])
    expect(entries).toEqual<ListEntry[]>([
      entry(FIRST, 1),
      entry(SECOND, 0, 3, TX_A),
      entry(THIRD, 2, 2, TX_A),
    ])
  })

  it('counts each chunk by the rows that name it, in the order they were recorded, to the millisecond', () => {
    // TX_B was recorded first but sorts after TX_A by hash, so only the recording time puts it first.
    const chunks = writtenChunksOf([
      row(FIRST, 2, 2, TX_A, '2026-10-15T08:00:00.700Z'),
      row(SECOND, 1, 1, TX_B, '2026-10-15T08:00:00.200Z'),
      row(THIRD, 1, 1, TX_B, '2026-10-15T08:00:00.200Z'),
      row(FOURTH, 1),
    ])
    expect(chunks).toEqual<WrittenChunk[]>([
      { txHash: TX_B, addresses: 2, writtenAt: Date.parse('2026-10-15T08:00:00.200Z') },
      { txHash: TX_A, addresses: 1, writtenAt: Date.parse('2026-10-15T08:00:00.700Z') },
    ])
  })
})

describe('listOf', () => {
  const chunks: WrittenChunk[] = [
    { txHash: TX_A, addresses: 9, writtenAt: 1 },
    { txHash: TX_GONE, addresses: 4, writtenAt: 2 },
    { txHash: TX_B, addresses: 9, writtenAt: 3 },
  ]

  it('counts a staged removal as unwritten but not listed, and sums the quotas', () => {
    const list = listOf(
      1,
      [entry(FIRST, 2, 2, TX_A), entry(SECOND, 0, 3, TX_A), entry(THIRD, 5, 1, TX_B), entry(FOURTH, 1)],
      7,
      chunks,
    )
    expect(list).toMatchObject({
      onchainId: 1,
      total: 3,
      written: 1,
      unwritten: 3,
      totalQuota: 8,
      quotaUsed: 7,
    })
  })

  it('counts each chunk again from the entries and leaves out a chunk no entry names', () => {
    const list = listOf(
      1,
      [entry(FIRST, 2, 2, TX_A), entry(SECOND, 0, 3, TX_A), entry(THIRD, 5, 1, TX_B)],
      0,
      chunks,
    )
    expect(list.chunks).toEqual<WrittenChunk[]>([
      { txHash: TX_A, addresses: 2, writtenAt: 1 },
      { txHash: TX_B, addresses: 1, writtenAt: 3 },
    ])
  })

  it('reads an entry as written only when the chain holds its quota', () => {
    expect(isWritten({ quota: 2, writtenQuota: 2 })).toBe(true)
    expect(isWritten({ quota: 2, writtenQuota: 1 })).toBe(false)
    expect(isWritten({ quota: 1, writtenQuota: null })).toBe(false)
    expect(isWritten({ quota: 0, writtenQuota: 3 })).toBe(false)
  })
})

describe('chunkPlanOf', () => {
  it('takes the first entries not written in address order, a removal sending 0, numbered after the written chunks', () => {
    const list = listOf(
      2,
      [entry(FIRST, 2, 2, TX_A), entry(SECOND, 0, 3, TX_A), entry(THIRD, 5, 1, TX_B), entry(FOURTH, 1)],
      0,
      [
        { txHash: TX_A, addresses: 2, writtenAt: 1 },
        { txHash: TX_B, addresses: 1, writtenAt: 2 },
      ],
    )
    expect(chunkPlanOf(list)).toEqual({
      onchainId: 2,
      number: 3,
      of: 3,
      entries: [
        { address: SECOND, quota: 0 },
        { address: THIRD, quota: 5 },
        { address: FOURTH, quota: 1 },
      ],
    })
    expect(chunkPlanOf(list, 2)).toEqual({
      onchainId: 2,
      number: 3,
      of: 4,
      entries: [
        { address: SECOND, quota: 0 },
        { address: THIRD, quota: 5 },
      ],
    })
  })

  it('answers null when every entry is written', () => {
    expect(chunkPlanOf(listOf(1, [entry(FIRST, 2, 2, TX_A)], 0, []))).toBeNull()
    expect(chunkPlanOf(listOf(1, [], 0, []))).toBeNull()
  })
})

describe('whitelistGroups', () => {
  it("keeps the phases view's whitelist groups in its order", () => {
    const group = (id: number, name: string): MintGroup => ({
      id,
      name,
      kind: id === 0 ? 'public' : 'whitelist',
      priceWei: '0',
      maxSupply: 1,
      minted: 0,
      flag: false,
      scheduledStart: 0,
      active: false,
    })
    const view: PhasesView = {
      chainId: 31337,
      contract: THIRD,
      groups: [group(2, 'Team'), group(0, 'Public'), group(1, 'Holders')],
      publicMaxPerWallet: 1,
      totalMinted: 0,
      maxSupply: 3,
      blockTimestamp: 0,
      readAt: 0,
      chainReachable: true,
    }
    expect(whitelistGroups(view).map((candidate) => candidate.name)).toEqual(['Team', 'Holders'])
  })
})
