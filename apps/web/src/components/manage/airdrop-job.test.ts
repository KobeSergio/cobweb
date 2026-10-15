import { getAddress, pad, toHex, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { AirdropJob } from '@/lib/manage/airdrop-types'
import { BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { burnJob, frozenJob, unsentTokens, withConfirmed, withPending } from './airdrop-job'
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
