import type { AtLeastOne, GeneratedToken, Layer, Trait } from '@/lib/demo'

/**
 * Pure edits on the layer stack. Every function returns new arrays and never touches the other
 * traits' weights: adding a trait starts it at 0%, deleting one leaves its share unassigned, and
 * only "Even out" redistributes (the legacy tool reset every weight on add or delete).
 *
 * The hooks apply them through `useArtSync()`, which saves each edit with its server action; ids
 * made here are for sample mode, saved rows take the database's ids.
 */

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  )
}

export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

/** Numbers each collection's layers 0 up, in array order. */
function positioned(layers: Layer[]): Layer[] {
  const next = new Map<string, number>()
  return layers.map((layer) => {
    const position = next.get(layer.collectionId) ?? 0
    next.set(layer.collectionId, position + 1)
    return layer.position === position ? layer : { ...layer, position }
  })
}

/** One collection's layers, bottom first. */
export function layersOf(layers: Layer[], collectionId: string): Layer[] {
  return layers.filter((layer) => layer.collectionId === collectionId)
}

function mapLayer(layers: Layer[], layerId: string, change: (layer: Layer) => Layer): Layer[] {
  return layers.map((layer) => (layer.id === layerId ? change(layer) : layer))
}

/** Moves a layer within one collection's stack (index 0 is the bottom). Other collections keep their order. */
export function moveLayer(layers: Layer[], collectionId: string, from: number, to: number): Layer[] {
  const own = layersOf(layers, collectionId)
  const [moved] = own.splice(from, 1)
  if (!moved) return layers
  own.splice(to, 0, moved)
  let i = 0
  return positioned(layers.map((layer) => (layer.collectionId === collectionId ? own[i++]! : layer)))
}

/**
 * Reorders each token's DNA to follow a new layer order, so a reorder keeps the generated set.
 * A token's DNA follows its own collection's layers.
 */
export function remapDna(tokens: GeneratedToken[], before: Layer[], after: Layer[]): GeneratedToken[] {
  const plans = new Map<string, { after: Layer[]; oldIndex: Map<string, number> }>()
  const plan = (collectionId: string) => {
    let entry = plans.get(collectionId)
    if (!entry) {
      const old = layersOf(before, collectionId)
      entry = {
        after: layersOf(after, collectionId),
        oldIndex: new Map(old.map((layer, index) => [layer.id, index])),
      }
      plans.set(collectionId, entry)
    }
    return entry
  }
  return tokens.map((token) => {
    const { after: own, oldIndex } = plan(token.collectionId)
    return { ...token, dna: own.map((layer) => token.dna[oldIndex.get(layer.id) ?? -1] ?? '') }
  })
}

export function renameLayer(layers: Layer[], layerId: string, name: string): Layer[] {
  return mapLayer(layers, layerId, (layer) => ({ ...layer, name }))
}

/** Adds a layer on top of one collection's stack. `id` is the database's; sample mode makes one from the name. */
export function addLayer(
  layers: Layer[],
  collectionId: string,
  name: string,
  id?: string,
): { layers: Layer[]; id: string } {
  const layerId = id ?? uniqueId(slug(name), new Set(layers.map((layer) => layer.id)))
  const layer: Layer = { id: layerId, collectionId, name, position: 0, traits: [] }
  // Keep the collection's layers together: insert after its last layer.
  let last = -1
  layers.forEach((other, i) => {
    if (other.collectionId === collectionId) last = i
  })
  const next = [...layers]
  next.splice(last === -1 ? layers.length : last + 1, 0, layer)
  return { layers: positioned(next), id: layerId }
}

export function deleteLayer(layers: Layer[], layerId: string): Layer[] {
  return positioned(layers.filter((layer) => layer.id !== layerId))
}

export function updateTrait(layers: Layer[], traitId: string, patch: Partial<Trait>): Layer[] {
  return layers.map((layer) =>
    layer.traits.some((trait) => trait.id === traitId)
      ? {
          ...layer,
          traits: layer.traits.map((trait) => (trait.id === traitId ? { ...trait, ...patch } : trait)),
        }
      : layer,
  )
}

/** Turns a trait into a constant of `count` tokens, or back into a weighted trait at 0%. */
export function setConstant(layers: Layer[], traitId: string, count: number | null): Layer[] {
  return layers.map((layer) => ({
    ...layer,
    traits: layer.traits.map((trait) => {
      if (trait.id !== traitId) return trait
      if (count === null) {
        const { constant: _dropped, ...rest } = trait
        void _dropped
        return { ...rest, weight: 0 }
      }
      // A whole number of tokens, at least 1 (legacy: "Constant must be greater than 0").
      return { ...trait, weight: 0, constant: Math.max(1, Math.round(count) || 1) }
    }),
  }))
}

export type TraitImage = { name: string; imageUrl: string; thumbnailUrl?: string; uploadId?: string }

/** Adds traits to a layer at 0%, so the other weights stay as the creator set them. `ids` are the database's. */
export function addTraits(
  layers: Layer[],
  layerId: string,
  items: TraitImage[],
  ids?: string[],
): { layers: Layer[]; ids: string[] } {
  const taken = new Set(layers.flatMap((layer) => layer.traits.map((trait) => trait.id)))
  const made: string[] = []
  const next = mapLayer(layers, layerId, (layer) => ({
    ...layer,
    traits: [
      ...layer.traits,
      ...items.map((item, i): Trait => {
        const id = ids?.[i] ?? uniqueId(`${layer.id}-${slug(item.name)}`, taken)
        taken.add(id)
        made.push(id)
        return {
          id,
          layerId: layer.id,
          name: item.name,
          weight: 0,
          blank: false,
          imageUrl: item.imageUrl,
          ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
          ...(item.uploadId ? { uploadId: item.uploadId } : {}),
        }
      }),
    ],
  }))
  return { layers: next, ids: made }
}

export function deleteTrait(layers: Layer[], traitId: string): Layer[] {
  return layers.map((layer) => ({ ...layer, traits: layer.traits.filter((trait) => trait.id !== traitId) }))
}

/**
 * Weights that split 100% evenly over `count` traits, to two decimals, adding up to exactly 100:
 * the leftover hundredths go one each to the first traits (3 traits: 33.34, 33.33, 33.33). The
 * legacy "Even rarity" rounded each share to two decimals, which left 3 traits at 99.99% and
 * failed its own check; whole percents would leave traits at 0% past 100 traits.
 */
export function evenWeights(count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(10_000 / count)
  let remainder = 10_000 - base * count
  return Array.from({ length: count }, () => (base + (remainder-- > 0 ? 1 : 0)) / 100)
}

/** Splits 100% evenly across the layer's non-constant traits (the blank included), to two decimals. */
export function evenOut(layers: Layer[], layerId: string): Layer[] {
  return mapLayer(layers, layerId, (layer) => {
    const weighted = layer.traits.filter((trait) => !trait.constant)
    if (weighted.length === 0) return layer
    const shares = evenWeights(weighted.length)
    let next = 0
    return {
      ...layer,
      traits: layer.traits.map((trait) => (trait.constant ? trait : { ...trait, weight: shares[next++]! })),
    }
  })
}

/** Adds the blank trait (at 0%, so nothing changes until it gets a share) or removes it. `id` is the database's. */
export function setBlank(layers: Layer[], layerId: string, on: boolean, id?: string): Layer[] {
  const taken = new Set(layers.flatMap((layer) => layer.traits.map((trait) => trait.id)))
  return mapLayer(layers, layerId, (layer) => {
    if (!on) return { ...layer, traits: layer.traits.filter((trait) => !trait.blank) }
    if (layer.traits.some((trait) => trait.blank)) return layer
    const blank: Trait = {
      id: id ?? uniqueId(`${layer.id}-none`, taken),
      layerId: layer.id,
      name: 'None',
      weight: 0,
      blank: true,
      imageUrl: null,
    }
    return { ...layer, traits: [blank, ...layer.traits] }
  })
}

/** The layer a trait belongs to. */
export function layerOfTrait(layers: Layer[], traitId: string): Layer | undefined {
  return layers.find((layer) => layer.traits.some((trait) => trait.id === traitId))
}

/** Puts a layer's weights and constants back as they were before a weight save that failed. */
export function restoreWeights(layers: Layer[], layerId: string, traits: Trait[]): Layer[] {
  const saved = new Map(traits.map((trait) => [trait.id, trait]))
  return mapLayer(layers, layerId, (layer) => ({
    ...layer,
    traits: layer.traits.map((trait) => {
      const was = saved.get(trait.id)
      if (!was) return trait
      const { constant: _dropped, ...rest } = trait
      void _dropped
      return was.constant === undefined
        ? { ...rest, weight: was.weight }
        : { ...rest, weight: was.weight, constant: was.constant }
    }),
  }))
}

/** Drops deleted traits from "at least one" groups, and groups left with fewer than two (as `art_prune` does). */
export function pruneGroups(groups: AtLeastOne[], traitIds: ReadonlySet<string>): AtLeastOne[] {
  return groups.flatMap((group) => {
    const kept = group.traitIds.filter((id) => traitIds.has(id))
    if (kept.length < 2) return []
    return [kept.length === group.traitIds.length ? group : { ...group, traitIds: kept }]
  })
}

export { pruneRules, rulesTouching } from '@cobweb/dna'
