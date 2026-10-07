import { describe, expect, it } from 'vitest'
import {
  clampToSupply,
  DEMO_AIRDROPS,
  DEMO_COLLECTION,
  DEMO_MINT_GROUPS,
  DEMO_TOTAL_MINTED,
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

describe('clampToSupply', () => {
  it('never lets a sample count exceed a real collection supply', () => {
    expect(clampToSupply(238, 100)).toBe(100)
    expect(clampToSupply(42, 100)).toBe(42)
    expect(clampToSupply(5, 0)).toBe(0)
  })
})
