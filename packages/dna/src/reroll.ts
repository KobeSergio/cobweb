import { uniqueKey } from './curate'
import { MAX_ATTEMPTS, repairAtLeastOne, repairPairs } from './generate'
import { buildTraitIndex, layersOf, weightedTraits } from './index-of'
import { seededRandom } from './random'
import { activeProjectRules, constraintsOf, satisfiesRules } from './rules'
import type { ArtRule, AtLeastOne, Layer, Project, TokenCore, Trait } from './types'

/** A pick by relative weight over already-filtered traits (curation re-rolls). */
function pick(traits: Trait[], random: () => number): Trait | undefined {
  const total = traits.reduce((sum, trait) => sum + trait.weight, 0)
  let roll = random() * total
  for (const trait of traits) {
    roll -= trait.weight
    if (roll < 0) return trait
  }
  return traits[traits.length - 1]
}

/** A new DNA for one token: its capped traits stay where they are, the rest is rolled until valid and free. */
function reroll(
  current: string[] | null,
  layers: Layer[],
  rules: ArtRule[],
  atLeastOne: AtLeastOne[],
  isTaken: (key: string) => boolean,
  random: () => number,
): string[] | null {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const picks: string[] = []
    for (const [i, layer] of layers.entries()) {
      const kept = layer.traits.find((trait) => trait.id === current?.[i] && trait.constant)
      const trait = kept ?? pick(weightedTraits(layer), random)
      if (!trait) return null
      picks.push(trait.id)
    }
    let dna = repairPairs(picks, layers, rules, random)
    if (atLeastOne.length > 0) dna = repairAtLeastOne(dna, layers, atLeastOne, random)
    if (!isTaken(uniqueKey(dna, layers)) && satisfiesRules(new Set(dna), rules, atLeastOne)) return dna
  }
  return null
}

type Scoped = Pick<Project, 'layers' | 'rules' | 'atLeastOne'>

function scope(project: Scoped) {
  const index = buildTraitIndex(project.layers)
  const rules = activeProjectRules(project, index)
  const layersFor = new Map<string, Layer[]>()
  const of = (collectionId: string) => {
    let own = layersFor.get(collectionId)
    if (!own) layersFor.set(collectionId, (own = layersOf(project.layers, collectionId)))
    return own
  }
  const key = (token: TokenCore) => `${token.collectionId}:${uniqueKey(token.dna, of(token.collectionId))}`
  return {
    rules,
    of,
    key,
    constraints: (collectionId: string) => constraintsOf(project.atLeastOne, collectionId),
  }
}

/** Re-rolls the chosen tokens, keeping their ids and other fields. All or nothing: null if one cannot be made. */
export function regenerate<T extends TokenCore>(
  tokens: T[],
  ids: ReadonlySet<number>,
  project: Scoped,
  seed: number,
): T[] | null {
  const random = seededRandom(seed)
  const { rules, of, key, constraints } = scope(project)
  const taken = new Set(tokens.filter((t) => !ids.has(t.id)).map(key))
  const next: T[] = []
  for (const token of tokens) {
    if (!ids.has(token.id)) {
      next.push(token)
      continue
    }
    const own = of(token.collectionId)
    const dna = reroll(
      token.dna,
      own,
      rules,
      constraints(token.collectionId),
      (k) => taken.has(`${token.collectionId}:${k}`),
      random,
    )
    if (!dna) return null
    taken.add(`${token.collectionId}:${uniqueKey(dna, own)}`)
    next.push({ ...token, dna })
  }
  return next
}

/** Brings every collection up to its size; new tokens take ids after the last. Null if one cannot be made. */
export function fillTo<T extends TokenCore>(
  tokens: T[],
  project: Project,
  seed: number,
  make: (id: number, collectionId: string, dna: string[]) => T,
): T[] | null {
  const random = seededRandom(seed)
  const { rules, of, key, constraints } = scope(project)
  const taken = new Set(tokens.map(key))
  const next: T[] = [...tokens]
  let id = tokens.reduce((max, t) => Math.max(max, t.id), 0)
  for (const collection of project.collections) {
    const own = of(collection.id)
    const have = tokens.filter((t) => t.collectionId === collection.id).length
    for (let i = have; i < collection.size; i++) {
      const dna = reroll(
        null,
        own,
        rules,
        constraints(collection.id),
        (k) => taken.has(`${collection.id}:${k}`),
        random,
      )
      if (!dna) return null
      taken.add(`${collection.id}:${uniqueKey(dna, own)}`)
      next.push(make(++id, collection.id, dna))
    }
  }
  return next
}
