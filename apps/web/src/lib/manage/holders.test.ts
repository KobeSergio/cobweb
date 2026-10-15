import { getAddress, zeroAddress, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { holdersOf, snapshotIds, type Holder } from './holders'

const A: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
const B: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const C: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const DEAD: Address = '0x000000000000000000000000000000000000dEaD'

describe('holdersOf', () => {
  it('sums a balance per owner whatever the case, most tokens first, then by lowercase address', () => {
    expect(
      holdersOf([C, A.toLowerCase(), B, A, C.toLowerCase(), B.toUpperCase().replace('0X', '0x')]),
    ).toEqual<Holder[]>([
      { address: A, balance: 2 },
      { address: B, balance: 2 },
      { address: C, balance: 2 },
    ])
    expect(holdersOf([A, C, C])).toEqual<Holder[]>([
      { address: C, balance: 2 },
      { address: A, balance: 1 },
    ])
  })

  it('leaves out failed reads, the zero address and the dead address', () => {
    expect(holdersOf([null, zeroAddress, DEAD, DEAD.toLowerCase(), A, null])).toEqual<Holder[]>([
      { address: getAddress(A), balance: 1 },
    ])
    expect(holdersOf([null, zeroAddress])).toEqual([])
  })
})

describe('snapshotIds', () => {
  it('reads ids 0 to the supply inclusive, so a collection starting at 1 keeps its last token (Review Focus 5)', () => {
    expect(snapshotIds(2n)).toEqual([0n, 1n, 2n])
    expect(snapshotIds(0n)).toEqual([0n])
    expect(snapshotIds(20_000n)).toHaveLength(20_001)
  })
})
