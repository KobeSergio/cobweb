import { cappedShortfalls, countTraits, uniqueKey } from './curate'
import { buildTraitIndex, constantTotal, layersOf, weightsValid } from './index-of'
import { collectionSeed, seededRandom } from './random'
import { activeProjectRules, constraintsOf, satisfiesRules } from './rules'
import type { ArtRule, AtLeastOne, Layer, Made, Project, Shortfall, TokenCore, Trait } from './types'

export { fillTo, regenerate } from './reroll'

/** Rolls one token gets before the generator gives up on it (legacy: 10,000 failed attempts in a row). */
export const MAX_ATTEMPTS = 10_000
/** Legacy limit on one collection's size. */
export const MAX_COLLECTION_SIZE = 10_000

/** Problems that stop a full generation, worded for the creator. */
export function generationProblems(project: Project): string[] {
  const { layers, collections } = project
  const problems: string[] = []
  const several = collections.length > 1
  if (collections.length === 0) problems.push('Add a collection on the Layers step.')
  else if (collections.every((collection) => collection.size < 1))
    problems.push(
      several ? 'Set a size for at least one collection.' : `Set a size for ${collections[0]!.name}.`,
    )
  for (const collection of collections) {
    const own = layersOf(layers, collection.id)
    const where = several ? ` in ${collection.name}` : ''
    if (collection.size < 1) continue
    if (collection.size > MAX_COLLECTION_SIZE)
      problems.push(
        `${collection.name} can have at most ${MAX_COLLECTION_SIZE.toLocaleString('en-US')} tokens.`,
      )
    if (own.length === 0) {
      problems.push(`Add at least one layer${where} on the Layers step.`)
      continue
    }
    const before = problems.length
    for (const layer of own) {
      if (layer.traits.length === 0) problems.push(`${layer.name}${where} has no traits yet.`)
      else if (!weightsValid(layer))
        problems.push(`The weights in ${layer.name}${where} do not add up to 100%.`)
      if (constantTotal(layer) > collection.size)
        problems.push(`The fixed quantities in ${layer.name}${where} add up to more than its size.`)
    }
    if (problems.length > before) continue
    const combinations = own.reduce(
      (product, layer) => product * layer.traits.filter((t) => t.constant || t.weight > 0).length,
      1,
    )
    if (combinations < collection.size)
      problems.push(
        `The layers${where} make at most ${combinations.toLocaleString('en-US')} different tokens, fewer than the size of ${collection.size.toLocaleString('en-US')}. Add traits or lower the size.`,
      )
  }
  return problems
}

/** A weighted pick with `random() * 100` over the layer's weighted traits, as the legacy generator rolled. */
function pickWeighted(traits: Trait[], random: () => number): Trait | undefined {
  const weighted = traits.filter((trait) => !trait.constant && trait.weight > 0)
  let roll = random() * 100
  for (const trait of weighted) {
    roll -= trait.weight
    if (roll < 0) return trait
  }
  return weighted[weighted.length - 1]
}

function layerIndexOf(layers: Layer[], traitId: string): number {
  return layers.findIndex((layer) => layer.traits.some((t) => t.id === traitId))
}

function isCapped(layers: Layer[], traitId: string): boolean {
  return layers.some((layer) => layer.traits.some((t) => t.id === traitId && t.constant))
}

/**
 * Pairing rules would reject most rolls if left to chance, so a trait that needs a partner gets one:
 * the partner's layer is switched to one of the related traits (and, for "always pairs with", a
 * related trait that appears alone pulls in its source trait). A capped trait is never pulled in.
 */
export function repairPairs(
  dna: string[],
  layers: Layer[],
  rules: ArtRule[],
  random: () => number,
): string[] {
  const next = [...dna]
  const place = (traitId: string) => {
    const index = layerIndexOf(layers, traitId)
    if (index !== -1 && !isCapped(layers, traitId)) next[index] = traitId
  }
  for (const rule of rules) {
    if (rule.kind === "doesn't mix with") continue
    const hasTrait = next.includes(rule.traitId)
    const hasRelated = rule.relatedTraitIds.some((id) => next.includes(id))
    if (hasTrait && !hasRelated)
      place(rule.relatedTraitIds[Math.floor(random() * rule.relatedTraitIds.length)]!)
    else if (rule.kind === 'always pairs with' && hasRelated && !hasTrait) place(rule.traitId)
  }
  return next
}

/** Pulls one of a constraint's traits into a token that has none of them (never a capped trait). */
export function repairAtLeastOne(
  dna: string[],
  layers: Layer[],
  constraints: AtLeastOne[],
  random: () => number,
): string[] {
  const next = [...dna]
  for (const constraint of constraints) {
    if (constraint.traitIds.some((id) => next.includes(id))) continue
    const options = constraint.traitIds.filter(
      (id) => layerIndexOf(layers, id) !== -1 && !isCapped(layers, id),
    )
    if (options.length === 0) continue
    const chosen = options[Math.floor(random() * options.length)]!
    next[layerIndexOf(layers, chosen)] = chosen
  }
  return next
}

/**
 * Generates `count` tokens of one collection, unique under `uniqueKey` and within `rules` (pass the
 * active rules) and `atLeastOne`, deterministically from `seed`. Capped traits are handed out up
 * front as caps: when a slot cannot carry its capped traits, it is rolled without them. Stops at the
 * first slot that fails `MAX_ATTEMPTS` rolls and returns what it made.
 */
export function generateCollection(
  layers: Layer[],
  rules: ArtRule[],
  atLeastOne: AtLeastOne[],
  count: number,
  seed: number,
  firstId = 1,
): TokenCore[] {
  if (layers.length === 0 || count < 1) return []
  const random = seededRandom(seed)
  const collectionId = layers[0]!.collectionId

  const forced = new Map<number, Trait[]>()
  for (const layer of layers) {
    for (const trait of layer.traits) {
      if (!trait.constant) continue
      let placed = 0
      let tries = 0
      while (placed < trait.constant && tries < count * 50) {
        tries++
        const index = Math.floor(random() * count)
        const existing = forced.get(index) ?? []
        if (existing.some((other) => other.layerId === trait.layerId)) continue
        forced.set(index, [...existing, trait])
        placed++
      }
    }
  }

  const seen = new Set<string>()
  const roll = (fixed: Trait[]): string[] | null => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const picks: string[] = []
      for (const layer of layers) {
        const trait = fixed.find((t) => t.layerId === layer.id) ?? pickWeighted(layer.traits, random)
        if (!trait) return null
        picks.push(trait.id)
      }
      let dna = repairPairs(picks, layers, rules, random)
      if (atLeastOne.length > 0) dna = repairAtLeastOne(dna, layers, atLeastOne, random)
      if (!seen.has(uniqueKey(dna, layers)) && satisfiesRules(new Set(dna), rules, atLeastOne)) return dna
    }
    return null
  }

  const tokens: TokenCore[] = []
  for (let index = 0; index < count; index++) {
    const fixed = forced.get(index) ?? []
    const dna = roll(fixed) ?? (fixed.length ? roll([]) : null)
    if (!dna) break
    seen.add(uniqueKey(dna, layers))
    tokens.push({ id: firstId + index, collectionId, dna })
  }
  return tokens
}

/**
 * Generates every collection with a size, in order, ids running on across them. Rules named in a
 * conflict are skipped, as the Rules screen shows. `made` says how far each collection got;
 * `shortfalls` lists capped traits below their cap.
 */
export function generateProject(
  project: Project,
  seed: number,
): { tokens: TokenCore[]; made: Made[]; shortfalls: Shortfall[] } {
  const index = buildTraitIndex(project.layers)
  const rules = activeProjectRules(project, index)
  const tokens: TokenCore[] = []
  const made: Made[] = []
  project.collections
    .filter((collection) => collection.size > 0)
    .forEach((collection, position) => {
      const got = generateCollection(
        layersOf(project.layers, collection.id),
        rules,
        constraintsOf(project.atLeastOne, collection.id),
        collection.size,
        collectionSeed(seed, position),
        tokens.length + 1,
      )
      tokens.push(...got)
      made.push({ collectionId: collection.id, wanted: collection.size, made: got.length })
    })
  return { tokens, made, shortfalls: cappedShortfalls(project.layers, countTraits(tokens)) }
}
