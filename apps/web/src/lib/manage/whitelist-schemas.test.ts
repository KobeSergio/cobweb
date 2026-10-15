import { zeroAddress, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { QUOTA_RANGE, UNSAVED, WHITELIST_FULL, WRONG_GROUP, ZERO_ADDRESS } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import {
  addEntriesShape,
  addressShape,
  groupIdShape,
  quotaShape,
  snapshotShape,
  usageShape,
} from './whitelist-schemas'

const A: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

/** Distinct lowercase addresses, none of them zero. */
const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
    quota: 1,
  }))

describe('groupIdShape and quotaShape', () => {
  it('takes a whitelist group of 1 or more; the public sale has no whitelist', () => {
    expect(parse(groupIdShape, 1)).toEqual({ ok: true, data: 1 })
    expect(parse(groupIdShape, 0)).toEqual({ ok: false, error: WRONG_GROUP })
    expect(parse(groupIdShape, -1)).toEqual({ ok: false, error: UNSAVED })
    expect(parse(groupIdShape, 1.5)).toEqual({ ok: false, error: UNSAVED })
    expect(parse(groupIdShape, 2_147_483_648)).toEqual({ ok: false, error: UNSAVED })
  })

  it('takes a whole quota from 1 to 10,000', () => {
    expect(parse(quotaShape, 1)).toEqual({ ok: true, data: 1 })
    expect(parse(quotaShape, 10_000)).toEqual({ ok: true, data: 10_000 })
    for (const quota of [0, 10_001, 2.5, '2', null])
      expect(parse(quotaShape, quota)).toEqual({ ok: false, error: QUOTA_RANGE })
  })
})

describe('addressShape', () => {
  it('answers a valid address checksummed, whatever its case', () => {
    expect(parse(addressShape, A.toLowerCase())).toEqual({ ok: true, data: A })
    expect(parse(addressShape, A)).toEqual({ ok: true, data: A })
  })

  it('refuses the zero address with its sentence, and anything malformed as UNSAVED', () => {
    expect(parse(addressShape, zeroAddress)).toEqual({ ok: false, error: ZERO_ADDRESS })
    for (const value of ['0x70997970c51812dc3A010C7d01b50e0d17dc79C8', '0x123', 'not an address', 5, null])
      expect(parse(addressShape, value)).toEqual({ ok: false, error: UNSAVED })
  })
})

describe('addEntriesShape', () => {
  it('merges an address repeated in another case into one row, the last quota winning (Review Focus 1)', () => {
    expect(
      parse(addEntriesShape, [
        { address: A, quota: 2 },
        { address: B, quota: 1 },
        { address: A.toLowerCase(), quota: 1 },
      ]),
    ).toEqual({
      ok: true,
      data: [
        { address: A, quota: 1 },
        { address: B, quota: 1 },
      ],
    })
  })

  it('takes 1 to 10,000 rows; more is a full whitelist', () => {
    expect(parse(addEntriesShape, [])).toEqual({ ok: false, error: UNSAVED })
    const full = parse(addEntriesShape, rows(10_000))
    expect(full.ok && full.data.length).toBe(10_000)
    expect(parse(addEntriesShape, rows(10_001))).toEqual({ ok: false, error: WHITELIST_FULL })
  })

  it('refuses the zero address and a quota out of range with their sentences, anything else as UNSAVED', () => {
    expect(parse(addEntriesShape, [{ address: zeroAddress, quota: 1 }])).toEqual({
      ok: false,
      error: ZERO_ADDRESS,
    })
    expect(parse(addEntriesShape, [{ address: A, quota: 0 }])).toEqual({ ok: false, error: QUOTA_RANGE })
    expect(parse(addEntriesShape, [{ address: A }])).toEqual({ ok: false, error: QUOTA_RANGE })
    expect(parse(addEntriesShape, 'rows')).toEqual({ ok: false, error: UNSAVED })
  })
})

describe('usageShape and snapshotShape', () => {
  it('takes 1 to 25 addresses for a usage read', () => {
    expect(parse(usageShape, [A.toLowerCase()])).toEqual({ ok: true, data: [A] })
    expect(parse(usageShape, [])).toEqual({ ok: false, error: UNSAVED })
    expect(parse(usageShape, Array(26).fill(A))).toEqual({ ok: false, error: UNSAVED })
  })

  it('takes a chain id and a contract address for a snapshot', () => {
    expect(parse(snapshotShape, { chainId: 8453, contract: A.toLowerCase() })).toEqual({
      ok: true,
      data: { chainId: 8453, contract: A },
    })
    expect(parse(snapshotShape, { chainId: 0, contract: A })).toEqual({ ok: false, error: UNSAVED })
    expect(parse(snapshotShape, { chainId: 8453, contract: 'nope' })).toEqual({ ok: false, error: UNSAVED })
  })
})
