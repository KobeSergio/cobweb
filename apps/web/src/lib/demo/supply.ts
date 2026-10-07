import { DEMO_COLLECTION, DEMO_MINT_GROUPS, DEMO_TOTAL_MINTED } from './data'
import type { MintGroup } from './types'

/**
 * The sample mint groups and total minted, scaled to a real collection's supply. The sample mints
 * 238 of 777; a real row whose `max_supply` is 100 must never read "238 of 100" or hold phases
 * allocated above its supply. Each figure is floored, so the groups and the total never add up
 * past the supply. At the sample's own supply this is the sample itself.
 *
 * Seam: Phases 5 and 6 replace this with the groups and counts the freshness server reads from the
 * chain, and the scaling goes away.
 */
export function scaleSampleToSupply(maxSupply: number): { groups: MintGroup[]; totalMinted: number } {
  const ratio = maxSupply / DEMO_COLLECTION.maxSupply
  if (ratio === 1) return { groups: DEMO_MINT_GROUPS, totalMinted: DEMO_TOTAL_MINTED }
  const groups = DEMO_MINT_GROUPS.map((group) => {
    const scaledMax = Math.floor(group.maxSupply * ratio)
    return { ...group, maxSupply: scaledMax, minted: Math.min(Math.floor(group.minted * ratio), scaledMax) }
  })
  const sampleAirdropped = DEMO_TOTAL_MINTED - DEMO_MINT_GROUPS.reduce((sum, group) => sum + group.minted, 0)
  const minted = groups.reduce((sum, group) => sum + group.minted, 0) + Math.floor(sampleAirdropped * ratio)
  return { groups, totalMinted: Math.min(minted, maxSupply) }
}
