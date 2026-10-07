import type { TraitIndex } from './index-of'
import type { Layer, TokenCore } from './types'

/**
 * A token's metadata attributes, bottom layer first, as the render pipeline writes them. A blank is
 * left out unless `showBlankTraits` (then written with the blank's name); a trait with `metadata`
 * off is left out; the layer's `displayName` stands in for its name when set.
 */
export function tokenAttributes(
  token: Pick<TokenCore, 'dna'>,
  layers: Layer[],
  index: TraitIndex,
  options: { showBlankTraits: boolean },
): { trait_type: string; value: string }[] {
  return layers.flatMap((layer, i) => {
    const trait = index.get(token.dna[i] ?? '')?.trait
    if (!trait || trait.metadata === false || (trait.blank && !options.showBlankTraits)) return []
    return [{ trait_type: layer.displayName ?? layer.name, value: trait.name }]
  })
}
