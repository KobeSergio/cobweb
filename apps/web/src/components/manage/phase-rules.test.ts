import { describe, expect, it } from 'vitest'
import {
  allocationCheck,
  allocationRoom,
  phaseNameError,
  priceError,
  publicCapError,
  supplySplit,
} from './phase-rules'

const groups = [
  { id: 0, maxSupply: 477, minted: 0 },
  { id: 1, maxSupply: 250, minted: 186 },
  { id: 2, maxSupply: 50, minted: 40 },
]

describe('priceError', () => {
  it('accepts free and decimal prices', () => {
    expect(priceError('0', 'ETH')).toBeNull()
    expect(priceError('0.0025', 'ETH')).toBeNull()
    expect(priceError('0.000000000000000001', 'ETH')).toBeNull()
    expect(priceError('1000000', 'ETH')).toBeNull()
  })

  it('refuses what cannot be sent', () => {
    expect(priceError('', 'ETH')).toMatch(/free mint/)
    expect(priceError('abc', 'ETH')).toMatch(/ETH such as/)
    expect(priceError('-1', 'ETH')).toMatch(/such as/)
    expect(priceError('1.', 'ETH')).toMatch(/such as/)
    expect(priceError('0.0000000000000000001', 'BERA')).toMatch(/18 decimal places; BERA/)
    expect(priceError('1000000.1', 'ETH')).toMatch(/1,000,000 ETH/)
  })
})

describe('phaseNameError', () => {
  it('needs a unique name of at most 40 characters', () => {
    expect(phaseNameError('Holders', ['Public'])).toBeNull()
    expect(phaseNameError('  ', [])).toMatch(/Name the phase/)
    expect(phaseNameError('x'.repeat(41), [])).toMatch(/40 characters/)
    expect(phaseNameError(' public ', ['Public'])).toMatch(/already has this name/)
  })
})

describe('allocationRoom and supplySplit', () => {
  it('counts the other phases against the supply', () => {
    expect(allocationRoom(groups, 777, 1)).toBe(250)
    expect(allocationRoom(groups, 777, null)).toBe(0)
    expect(supplySplit(groups, 777)).toEqual({ allocated: 777, unallocated: 0, over: 0 })
    expect(supplySplit(groups, 700)).toEqual({ allocated: 777, unallocated: 0, over: 77 })
    expect(supplySplit([{ id: 0, maxSupply: 100 }], 777)).toEqual({
      allocated: 100,
      unallocated: 677,
      over: 0,
    })
  })
})

describe('allocationCheck', () => {
  const base = { groups, maxSupply: 777, groupId: 1 }

  it('mirrors the contract: never below minted, never past the supply', () => {
    expect(allocationCheck({ ...base, value: '200' }).error).toBeNull()
    expect(allocationCheck({ ...base, value: '185' }).error).toMatch(/below 186/)
    expect(allocationCheck({ ...base, value: '251' }).error).toMatch(/Only 250 fit/)
    expect(allocationCheck({ ...base, value: '2.5' }).error).toMatch(/whole number/)
  })

  it('warns, without refusing, when airdrops leave less than the allocation', () => {
    const check = allocationCheck({ ...base, value: '250', airdropped: 12 })
    expect(check.error).toBeNull()
    expect(check.warning).toMatch(/at most 238/)
    expect(allocationCheck({ ...base, value: '238', airdropped: 12 }).warning).toBeNull()
  })

  it('applies a minimum for a new phase', () => {
    const fresh = { groups: [{ id: 0, maxSupply: 100 }], maxSupply: 777, groupId: null }
    expect(allocationCheck({ ...fresh, value: '0', min: 1 }).error).toMatch(/1 or more/)
    expect(allocationCheck({ ...fresh, value: '677', min: 1 })).toMatchObject({
      error: null,
      room: 677,
      next: 677,
    })
  })
})

describe('publicCapError', () => {
  it('is a whole number from 1 to the supply', () => {
    expect(publicCapError('3', 777)).toBeNull()
    expect(publicCapError('0', 777)).toMatch(/1 or more/)
    expect(publicCapError('778', 777)).toMatch(/at most 777/)
  })
})
