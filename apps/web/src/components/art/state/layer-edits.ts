import type { ArtRule, GeneratedToken, Layer, Trait } from '@/lib/demo'

/**
 * Pure edits on the layer stack. Every function returns new arrays and never touches the other
 * traits' weights: adding a trait starts it at 0%, deleting one leaves its share unassigned, and
 * only "Even out" redistributes (the legacy tool reset every weight on add or delete).
 *
 * Seam: in Phase 3 each of these becomes a server action on the layer and trait rows; the
 * screens keep calling them through `useArtProject().update`.
 */

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  )
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

function positioned(layers: Layer[]): Layer[] {
  return layers.map((layer, position) => (layer.position === position ? layer : { ...layer, position }))
}

function mapLayer(layers: Layer[], layerId: string, change: (layer: Layer) => Layer): Layer[] {
  return layers.map((layer) => (layer.id === layerId ? change(layer) : layer))
}

/** Moves a layer within the stack (index 0 is the bottom). */
export function moveLayer(layers: Layer[], from: number, to: number): Layer[] {
  const next = [...layers]
  const [moved] = next.splice(from, 1)
  if (!moved) return layers
  next.splice(to, 0, moved)
  return positioned(next)
}

/** Reorders each token's DNA to follow a new layer order, so a reorder keeps the generated set. */
export function remapDna(tokens: GeneratedToken[], before: Layer[], after: Layer[]): GeneratedToken[] {
  const oldIndex = new Map(before.map((layer, index) => [layer.id, index]))
  return tokens.map((token) => ({
    ...token,
    dna: after.map((layer) => token.dna[oldIndex.get(layer.id) ?? -1] ?? ''),
  }))
}

export function renameLayer(layers: Layer[], layerId: string, name: string): Layer[] {
  return mapLayer(layers, layerId, (layer) => ({ ...layer, name }))
}

export function addLayer(layers: Layer[], name: string): { layers: Layer[]; id: string } {
  const id = uniqueId(slug(name), new Set(layers.map((layer) => layer.id)))
  return { layers: positioned([...layers, { id, name, position: layers.length, traits: [] }]), id }
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
      return { ...trait, weight: 0, constant: Math.max(1, Math.round(count)) }
    }),
  }))
}

/** Adds traits to a layer at 0%, so the other weights stay as the creator set them. */
export function addTraits(
  layers: Layer[],
  layerId: string,
  items: { name: string; imageUrl: string }[],
): { layers: Layer[]; ids: string[] } {
  const taken = new Set(layers.flatMap((layer) => layer.traits.map((trait) => trait.id)))
  const ids: string[] = []
  const next = mapLayer(layers, layerId, (layer) => ({
    ...layer,
    traits: [
      ...layer.traits,
      ...items.map((item): Trait => {
        const id = uniqueId(`${layer.id}-${slug(item.name)}`, taken)
        taken.add(id)
        ids.push(id)
        return { id, layerId: layer.id, name: item.name, weight: 0, blank: false, imageUrl: item.imageUrl }
      }),
    ],
  }))
  return { layers: next, ids }
}

export function deleteTrait(layers: Layer[], traitId: string): Layer[] {
  return layers.map((layer) => ({ ...layer, traits: layer.traits.filter((trait) => trait.id !== traitId) }))
}

/** Splits 100% evenly across the layer's non-constant traits, in whole percents. */
export function evenOut(layers: Layer[], layerId: string): Layer[] {
  return mapLayer(layers, layerId, (layer) => {
    const weighted = layer.traits.filter((trait) => !trait.constant)
    if (weighted.length === 0) return layer
    const base = Math.floor(100 / weighted.length)
    let remainder = 100 - base * weighted.length
    return {
      ...layer,
      traits: layer.traits.map((trait) => {
        if (trait.constant) return trait
        const extra = remainder > 0 ? 1 : 0
        remainder -= extra
        return { ...trait, weight: base + extra }
      }),
    }
  })
}

/** Adds the blank trait (at 0%, so nothing changes until it gets a share) or removes it. */
export function setBlank(layers: Layer[], layerId: string, on: boolean): Layer[] {
  const taken = new Set(layers.flatMap((layer) => layer.traits.map((trait) => trait.id)))
  return mapLayer(layers, layerId, (layer) => {
    if (!on) return { ...layer, traits: layer.traits.filter((trait) => !trait.blank) }
    if (layer.traits.some((trait) => trait.blank)) return layer
    const blank: Trait = {
      id: uniqueId(`${layer.id}-none`, taken),
      layerId: layer.id,
      name: 'None',
      weight: 0,
      blank: true,
      imageUrl: null,
    }
    return { ...layer, traits: [blank, ...layer.traits] }
  })
}

/** Drops rule references to traits that no longer exist, and rules left with nothing to relate. */
export function pruneRules(rules: ArtRule[], traitIds: ReadonlySet<string>): ArtRule[] {
  const next: ArtRule[] = []
  let changed = false
  for (const rule of rules) {
    const related = rule.relatedTraitIds.filter((id) => traitIds.has(id))
    if (!traitIds.has(rule.traitId) || related.length === 0) {
      changed = true
      continue
    }
    if (related.length !== rule.relatedTraitIds.length) {
      changed = true
      next.push({ ...rule, relatedTraitIds: related })
    } else next.push(rule)
  }
  return changed ? next : rules
}

/** How many rules mention any of these traits. */
export function rulesTouching(rules: ArtRule[], traitIds: ReadonlySet<string>): number {
  return rules.filter(
    (rule) => traitIds.has(rule.traitId) || rule.relatedTraitIds.some((id) => traitIds.has(id)),
  ).length
}
