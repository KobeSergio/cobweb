import type { Layer, Trait } from './types'

/** Lookups over a project's layers: trait by id with its layer and that layer's index in the list. */
export type TraitEntry = { trait: Trait; layer: Layer; layerIndex: number }
export type TraitIndex = Map<string, TraitEntry>

export function buildTraitIndex(layers: Layer[]): TraitIndex {
  const index: TraitIndex = new Map()
  layers.forEach((layer, layerIndex) => {
    for (const trait of layer.traits) index.set(trait.id, { trait, layer, layerIndex })
  })
  return index
}

/** One collection's layers, bottom first. */
export function layersOf(layers: Layer[], collectionId: string): Layer[] {
  return layers.filter((layer) => layer.collectionId === collectionId).sort((a, b) => a.position - b.position)
}

export function traitName(index: TraitIndex, traitId: string): string {
  return index.get(traitId)?.trait.name ?? 'Removed trait'
}

/** Joins names as "A, B or C". */
export function joinOr(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/** Traits that can be picked by weight: not constant and with a share above zero. */
export function weightedTraits(layer: Layer): Trait[] {
  return layer.traits.filter((trait) => !trait.constant && trait.weight > 0)
}

/** A weight as stored: a percent from 0 to 100 with at most two decimals. */
export function roundWeight(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100
}

/** The highest total accepted as 100%: shares typed to two decimals (three at 33.34%) pass. */
export const WEIGHT_TOTAL_MAX = 100.05

/** The sum of the weights of the layer's non-constant traits, rounded to two places. */
export function weightTotal(layer: Layer): number {
  const sum = layer.traits.reduce((total, trait) => total + (trait.constant ? 0 : trait.weight), 0)
  return Math.round(sum * 100) / 100
}

/** Whether a layer's weights add up: from 100.00 to 100.05, or every trait has a maximum count. */
export function weightsValid(layer: Layer): boolean {
  const hasWeighted = layer.traits.some((trait) => !trait.constant)
  const total = weightTotal(layer)
  return !hasWeighted || (total >= 100 && total <= WEIGHT_TOTAL_MAX)
}

export function constantTotal(layer: Layer): number {
  return layer.traits.reduce((total, trait) => total + (trait.constant ?? 0), 0)
}

/** Tokens expected to carry a trait for a given supply. */
export function expectedCount(layer: Layer, trait: Trait, supply: number): number {
  if (trait.constant) return trait.constant
  const total = weightTotal(layer)
  if (total <= 0) return 0
  return ((supply - constantTotal(layer)) * trait.weight) / 100
}

/**
 * The key a trait is counted under for rarity: its layer name and its own name, as they appear in
 * the metadata (`trait_type`, `value`). The same pair in two collections is one attribute.
 */
export function attributeKey(layerName: string, traitName: string): string {
  return JSON.stringify([layerName, traitName])
}

/** `attributeKey` for the traits of these layers; an unknown id counts as an attribute of its own. */
export function attributeKeyOf(index: TraitIndex): (traitId: string) => string {
  return (traitId) => {
    const entry = index.get(traitId)
    return entry ? attributeKey(entry.layer.name, entry.trait.name) : traitId
  }
}

/** How many tokens carry each attribute (layer and trait name), every collection together. */
export function attributeCounts(tokens: { dna: string[] }[], index: TraitIndex): Map<string, number> {
  const keyOf = attributeKeyOf(index)
  const counts = new Map<string, number>()
  for (const token of tokens)
    for (const traitId of token.dna) counts.set(keyOf(traitId), (counts.get(keyOf(traitId)) ?? 0) + 1)
  return counts
}
