import { describe, expect, it } from 'vitest'
import {
  DEMO_AIRDROPS,
  DEMO_COLLECTION,
  DEMO_MINT_GROUPS,
  DEMO_TOTAL_MINTED,
  scaleSampleToSupply,
} from '@/lib/demo'

describe('sample supply accounting', () => {
  it('never shows more minted than the supply', () => {
    const minted = DEMO_MINT_GROUPS.reduce((sum, g) => sum + g.minted, 0)
    const airdropped = DEMO_AIRDROPS.reduce((sum, a) => sum + a.tokens, 0)
    expect(minted + airdropped).toBe(DEMO_TOTAL_MINTED)
    expect(DEMO_TOTAL_MINTED).toBeLessThanOrEqual(DEMO_COLLECTION.maxSupply)
  })

  it('allocates no more than the supply across groups', () => {
    const allocated = DEMO_MINT_GROUPS.reduce((sum, g) => sum + g.maxSupply, 0)
    expect(allocated).toBeLessThanOrEqual(DEMO_COLLECTION.maxSupply)
  })
})

describe('scaleSampleToSupply', () => {
  it('is the sample itself at the sample supply', () => {
    const view = scaleSampleToSupply(DEMO_COLLECTION.maxSupply)
    expect(view.groups).toBe(DEMO_MINT_GROUPS)
    expect(view.totalMinted).toBe(DEMO_TOTAL_MINTED)
  })

  it('never shows a figure above a real supply of 100', () => {
    const view = scaleSampleToSupply(100)
    expect(view.totalMinted).toBeLessThanOrEqual(100)
    expect(view.groups.reduce((sum, g) => sum + g.maxSupply, 0)).toBeLessThanOrEqual(100)
    for (const group of view.groups) {
      expect(group.maxSupply).toBeLessThanOrEqual(100)
      expect(group.minted).toBeLessThanOrEqual(group.maxSupply)
    }
    expect(view.groups.reduce((sum, g) => sum + g.minted, 0)).toBeLessThanOrEqual(view.totalMinted)
  })

  it('keeps the phases in proportion and every phase present', () => {
    const view = scaleSampleToSupply(100)
    expect(view.groups.map((g) => g.id)).toEqual(DEMO_MINT_GROUPS.map((g) => g.id))
    expect(view.groups.map((g) => g.maxSupply)).toEqual([61, 32, 6])
  })

  it('gives a tiny supply to the public phase and no more', () => {
    const view = scaleSampleToSupply(1)
    expect(view.groups.reduce((sum, g) => sum + g.maxSupply, 0)).toBeLessThanOrEqual(1)
    expect(view.totalMinted).toBeLessThanOrEqual(1)
  })
})
