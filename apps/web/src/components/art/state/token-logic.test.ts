import { describe, expect, it } from 'vitest'
import { DEMO_LAYERS } from '@/lib/demo'
import type { Layer } from '@/lib/demo'
import { buildTraitIndex } from '../lib/trait-index'
import { layersOf } from './layer-edits'
import { changeTrait } from './token-logic'

describe('changeTrait with an empty layer in the stack', () => {
  const owls = layersOf(DEMO_LAYERS, 'owls')
  // An empty layer under the top one: it has no traits, so the trait index knows nothing about it.
  const empty: Layer = {
    id: 'empty',
    collectionId: 'owls',
    name: 'Empty',
    position: owls.length - 1,
    traits: [],
  }
  const layers = [...owls.slice(0, -1), empty, { ...owls[owls.length - 1]!, position: owls.length }]
  const top = layers[layers.length - 1]!
  const token = {
    id: 1,
    collectionId: 'owls',
    dna: layers.map((layer) => layer.traits[0]?.id ?? ''),
    name: 'Owl #1',
    rank: 1,
    previewUrl: null,
  }
  const other = top.traits.find((t) => t.id !== token.dna[layers.length - 1])!

  it('still accepts a change on the top layer when the context carries the real layers', () => {
    const ctx = { tokenName: 'Owl', index: buildTraitIndex(layers), layers }
    const result = changeTrait([token], 1, layers.length - 1, other.id, [], ctx)
    expect(result.ok).toBe(true)
  })

  it('cannot tell without them: the rebuilt list skips the empty layer', () => {
    const ctx = { tokenName: 'Owl', index: buildTraitIndex(layers) }
    expect(changeTrait([token], 1, layers.length - 1, other.id, [], ctx)).toEqual({
      ok: false,
      reason: 'That trait belongs to another layer.',
    })
  })
})
