import { getAddress, pad, toHex, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { AirdropJob, BatchEntry } from '@/lib/manage/airdrop-types'
import { BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { burnJob, frozenJob, unsentTokens, waitsOn, withConfirmed, withPending } from './airdrop-job'
import type { Recipient } from './recipients'

const HASH: Hex = `0x${'ab'.repeat(32)}`
const wallet = (index: number): Address => getAddress(pad(toHex(index + 1), { size: 20 }))
const rows = (count: number, amount: number): Recipient[] =>
  Array.from({ length: count }, (_, index) => ({ address: wallet(index), amount, line: index + 1 }))

describe('frozenJob', () => {
  it("freezes the list into its batches in the list's order, none sent, without the parser's line numbers", () => {
    const job = frozenJob(rows(1_200, 1))
    expect(job.batches.map((batch) => batch.length)).toEqual([500, 500, 200])
    expect(job).toMatchObject({ kind: 'airdrop', sent: 0, pending: null })
    expect(job.batches[0]?.[0]).toEqual({ address: wallet(0), amount: 1 })
  })
})

describe('burnJob and withPending', () => {
  it('keeps a burn as one entry to the dead address while its hash is pending, and no job without it', () => {
    const burn = burnJob(2, HASH)
    expect(burn).toEqual<AirdropJob>({
      kind: 'burn',
      batches: [[{ address: BURN_ADDRESS, amount: 2 }]],
      sent: 0,
      pending: HASH,
    })
    expect(withPending(burn, null)).toBeNull()
  })

  it("sets and forgets a batch's hash", () => {
    const job = frozenJob(rows(3, 1))
    expect(withPending(job, HASH)).toEqual({ ...job, pending: HASH })
    expect(withPending({ ...job, pending: HASH }, null)).toEqual(job)
  })
})

describe('withConfirmed and unsentTokens', () => {
  it('moves on to the next batch without a hash, and ends after the last', () => {
    const job: AirdropJob = { ...frozenJob(rows(600, 2)), pending: HASH }
    expect(unsentTokens(job)).toBe(1_200)
    const next = withConfirmed(job)
    expect(next).toMatchObject({ sent: 1, pending: null })
    expect(next && unsentTokens(next)).toBe(200)
    expect(next && withConfirmed(next)).toBeNull()
    expect(withConfirmed(burnJob(2, HASH))).toBeNull()
  })
})

describe('waitsOn', () => {
  const job: AirdropJob = { ...frozenJob(rows(600, 2)), sent: 1, pending: HASH }

  it("matches the batch a job waits on by its index and its entries' values, in another tab's copy too", () => {
    const copy: AirdropJob = JSON.parse(JSON.stringify(job))
    expect(waitsOn(job, 1, job.batches[1])).toBe(true)
    expect(waitsOn(copy, 1, job.batches[1])).toBe(true)
    expect(waitsOn(job, 1, copy.batches[1])).toBe(true)
  })

  it('refuses another index, another wallet or an amount changed by 1, an entry more, a job moved on, and no job or no batch', () => {
    const waiting: BatchEntry[] = job.batches[1] ?? []
    const changed: BatchEntry[] = waiting.map((entry, index) =>
      index === 0 ? { ...entry, amount: entry.amount + 1 } : entry,
    )
    const elsewhere: BatchEntry[] = waiting.map((entry, index) =>
      index === 0 ? { ...entry, address: wallet(999) } : entry,
    )
    const longer: BatchEntry[] = [...waiting, { address: wallet(999), amount: 1 }]
    expect(waitsOn(job, 0, job.batches[0])).toBe(false)
    expect(waitsOn(job, 0, waiting)).toBe(false)
    expect(waitsOn(job, 1, changed)).toBe(false)
    expect(waitsOn(job, 1, elsewhere)).toBe(false)
    expect(waitsOn(job, 1, longer)).toBe(false)
    expect(waitsOn({ ...job, sent: 0 }, 1, waiting)).toBe(false)
    expect(waitsOn(null, 1, waiting)).toBe(false)
    expect(waitsOn(job, 1, undefined)).toBe(false)
  })
})
