import { describe, expect, it } from 'vitest'
import { holdersToText, snapshotAddressError } from './snapshot'

const A = '0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291' as const
const B = '0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0' as const
const C = '0x9c8b7a6f5e4d3c2b1a09f8e7d6c5b4a392817065' as const

describe('holdersToText', () => {
  const holders = [
    { address: A, balance: 1 },
    { address: B, balance: 12 },
    { address: C, balance: 0 },
  ]

  it('lists holders by balance, most first, and drops empty wallets', () => {
    expect(holdersToText(holders, { kind: 'balance' }, 100)).toBe(`${B},12\n${A},1`)
  })

  it('caps a balance at the most one line may carry', () => {
    expect(holdersToText(holders, { kind: 'balance' }, 10)).toBe(`${B},10\n${A},1`)
  })

  it('gives everyone the same amount', () => {
    expect(holdersToText(holders, { kind: 'fixed', amount: 2 }, 100)).toBe(`${B},2\n${A},2`)
  })
})

describe('snapshotAddressError', () => {
  it('needs a full, checksummed address', () => {
    expect(snapshotAddressError(A)).toBeNull()
    expect(snapshotAddressError('')).toMatch(/Enter the address/)
    expect(snapshotAddressError('0x123')).toMatch(/42 characters/)
    expect(snapshotAddressError('0x5E1F0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291')).toMatch(/checksum/)
  })
})
