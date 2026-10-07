import type { TraitIndex } from '@cobweb/dna'

export {
  attributeCounts,
  attributeKeyOf,
  buildTraitIndex,
  constantTotal,
  expectedCount,
  joinOr,
  roundWeight,
  traitName,
  WEIGHT_TOTAL_MAX,
  weightedTraits,
  weightsValid,
  weightTotal,
  type TraitEntry,
  type TraitIndex,
} from '@cobweb/dna'

/** The images to stack for a DNA, bottom first. Blanks, hidden layers and unknown ids are left out. */
export function compositeUrls(
  dna: string[],
  index: TraitIndex,
  hiddenLayers?: ReadonlySet<string>,
): string[] {
  return dna.flatMap((traitId) => {
    const entry = index.get(traitId)
    if (!entry || !entry.trait.imageUrl) return []
    if (hiddenLayers?.has(entry.layer.id)) return []
    return [entry.trait.imageUrl]
  })
}

/** "12.5%" style, at most two decimals. */
export function formatPercent(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}
