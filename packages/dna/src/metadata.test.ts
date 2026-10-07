import { describe, expect, it } from 'vitest'
import { deepFreeze, fixture } from './fixture'
import { buildTraitIndex, layersOf } from './index-of'
import { tokenAttributes } from './metadata'

const project = fixture()
const owls = layersOf(project.layers, 'owls')
const token = { dna: ['bg-ink', 'body-barn', 'eyes-wide', 'acc-none'] }

describe('tokenAttributes', () => {
  it('writes layer and trait names bottom first, leaving a blank out unless asked', () => {
    const index = buildTraitIndex(owls)
    expect(tokenAttributes(token, owls, index, { showBlankTraits: false })).toEqual([
      { trait_type: 'Background', value: 'Ink' },
      { trait_type: 'Body', value: 'Barn' },
      { trait_type: 'Eyes', value: 'Wide' },
    ])
    expect(tokenAttributes(token, owls, index, { showBlankTraits: true })[3]).toEqual({
      trait_type: 'Accessory',
      value: 'None',
    })
  })

  it('honours a layer display name and a trait with metadata off', () => {
    const layers = deepFreeze(
      owls.map((layer) =>
        layer.id === 'background'
          ? { ...layer, displayName: 'Scene' }
          : layer.id === 'eyes'
            ? {
                ...layer,
                traits: layer.traits.map((t) =>
                  t.id === 'eyes-wide' ? { ...t, metadata: false as const } : t,
                ),
              }
            : layer,
      ),
    )
    expect(tokenAttributes(token, layers, buildTraitIndex(layers), { showBlankTraits: false })).toEqual([
      { trait_type: 'Scene', value: 'Ink' },
      { trait_type: 'Body', value: 'Barn' },
    ])
  })
})
