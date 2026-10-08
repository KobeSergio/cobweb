import { describe, expect, it } from 'vitest'
import type { Layer } from '@/lib/demo'
import { ruleKindFromDb, ruleKindToDb, toProject, weightRows, type ArtRows } from './rows'

const collection: ArtRows['collection'] = {
  name: 'Night Owls',
  token_name: null,
  token_description: '',
  show_blank_traits: false,
  generation_seed: null,
  canvas_width: null,
  canvas_height: null,
}

const empty: ArtRows = {
  collection,
  artCollections: [],
  layers: [],
  traits: [],
  rules: [],
  atLeastOne: [],
  tokens: [],
}

const rows: ArtRows = {
  collection: {
    ...collection,
    token_name: 'Owl',
    token_description: 'A night owl.',
    show_blank_traits: true,
    generation_seed: 42,
    canvas_width: 1000,
    canvas_height: 1000,
  },
  artCollections: [
    { id: 'art-2', name: 'Owlets', size: 1, position: 1 },
    { id: 'art-1', name: 'Owls', size: 2, position: 0 },
  ],
  layers: [
    {
      id: 'eyes',
      art_collection_id: 'art-1',
      name: 'Eyes',
      display_name: 'Gaze',
      position: 1,
      bypass_dna: false,
    },
    {
      id: 'bg',
      art_collection_id: 'art-1',
      name: 'Background',
      display_name: null,
      position: 0,
      bypass_dna: true,
    },
  ],
  traits: [
    {
      id: 'wide',
      layer_id: 'eyes',
      name: 'Wide',
      weight: 60,
      constant: null,
      blank: false,
      in_metadata: true,
      upload_id: 'up-wide',
      position: 0,
    },
    {
      id: 'none',
      layer_id: 'eyes',
      name: 'None',
      weight: 40,
      constant: null,
      blank: true,
      in_metadata: false,
      upload_id: null,
      position: 1,
    },
    {
      id: 'ink',
      layer_id: 'bg',
      name: 'Ink',
      weight: 0,
      constant: 3,
      blank: false,
      in_metadata: true,
      upload_id: 'up-ink',
      position: 0,
    },
  ],
  rules: [
    {
      id: 'rule-1',
      kind: 'doesnt_mix_with',
      trait_id: 'ink',
      related_trait_ids: ['wide'],
      bidirectional: true,
    },
  ],
  atLeastOne: [{ id: 'group-1', art_collection_id: 'art-1', trait_ids: ['wide', 'ink'] }],
  tokens: [
    { token_id: 2, art_collection_id: 'art-1', dna: ['ink', 'none'], description: null },
    { token_id: 1, art_collection_id: 'art-1', dna: ['ink', 'wide'], description: 'First.' },
  ],
}

describe('toProject', () => {
  it('orders art collections and layers by position and makes the first collection active', () => {
    const project = toProject(rows)
    expect(project.collections).toEqual([
      { id: 'art-1', name: 'Owls', size: 2 },
      { id: 'art-2', name: 'Owlets', size: 1 },
    ])
    expect(project.activeCollectionId).toBe('art-1')
    expect(project.layers!.map((layer) => [layer.id, layer.position])).toEqual([
      ['bg', 0],
      ['eyes', 1],
    ])
    expect(project.layers![0]!.bypassDna).toBe(true)
    expect(project.layers![1]!.displayName).toBe('Gaze')
  })

  it('serves images through the app, keeps the blank first and maps in_metadata and constants', () => {
    const eyes = toProject(rows).layers![1]!
    expect(eyes.traits.map((trait) => trait.id)).toEqual(['none', 'wide'])
    expect(eyes.traits[0]).toEqual({
      id: 'none',
      layerId: 'eyes',
      name: 'None',
      weight: 40,
      blank: true,
      imageUrl: null,
      metadata: false,
    })
    expect(eyes.traits[1]).toEqual({
      id: 'wide',
      layerId: 'eyes',
      name: 'Wide',
      weight: 60,
      blank: false,
      imageUrl: '/api/uploads/up-wide',
      thumbnailUrl: '/api/uploads/up-wide?variant=thumb',
      uploadId: 'up-wide',
    })
    expect(toProject(rows).layers![0]!.traits[0]!.constant).toBe(3)
  })

  it('maps rule kinds to the sentences the screens use, and groups to their collection', () => {
    const project = toProject(rows)
    expect(project.rules).toEqual([
      {
        id: 'rule-1',
        kind: "doesn't mix with",
        traitId: 'ink',
        relatedTraitIds: ['wide'],
        bidirectional: true,
      },
    ])
    expect(project.atLeastOne).toEqual([{ id: 'group-1', collectionId: 'art-1', traitIds: ['wide', 'ink'] }])
  })

  it('names tokens "<token name> #<id>", ranks them, and falls back to the project description', () => {
    const tokens = toProject(rows).tokens!
    expect(tokens.map((token) => token.id)).toEqual([1, 2])
    expect(tokens.map((token) => token.name)).toEqual(['Owl #1', 'Owl #2'])
    expect(tokens.map((token) => token.description)).toEqual(['First.', 'A night owl.'])
    expect(tokens.map((token) => token.rank).sort()).toEqual([1, 2])
    expect(tokens.every((token) => token.previewUrl === null)).toBe(true)
  })

  it('carries the settings: seed, canvas, token name and description, blank traits', () => {
    const project = toProject(rows)
    expect(project.seed).toBe(42)
    expect(project.canvas).toEqual({ width: 1000, height: 1000 })
    expect(project.tokenName).toBe('Owl')
    expect(project.tokenDescription).toBe('A night owl.')
    expect(project.showBlankTraits).toBe(true)
    expect(project.staleNote).toBeNull()
  })

  it('loads an empty project as empty: no tokens, no canvas, no token name yet', () => {
    const project = toProject(empty)
    expect(project.collections).toEqual([])
    expect(project.layers).toEqual([])
    expect(project.rules).toEqual([])
    expect(project.atLeastOne).toEqual([])
    expect(project.tokens).toBeNull()
    expect(project.canvas).toBeNull()
    expect(project.activeCollectionId).toBeUndefined()
    expect(project.tokenName).toBeUndefined()
    expect(project.tokenDescription).toBeUndefined()
    expect(project.seed).toBe(0x0a7115)
  })
})

describe('the inverse pieces', () => {
  it('round-trips every rule kind', () => {
    for (const kind of ['doesnt_mix_with', 'always_pairs_with', 'must_pair_with'] as const)
      expect(ruleKindToDb(ruleKindFromDb(kind))).toBe(kind)
  })

  it('sends the whole weight table, the blank included, with a constant forcing 0', () => {
    const layer: Layer = {
      id: 'eyes',
      collectionId: 'art-1',
      name: 'Eyes',
      position: 0,
      traits: [
        { id: 'none', layerId: 'eyes', name: 'None', weight: 10, blank: true, imageUrl: null },
        { id: 'wide', layerId: 'eyes', name: 'Wide', weight: 90, blank: false, imageUrl: '/w.png' },
        {
          id: 'rare',
          layerId: 'eyes',
          name: 'Rare',
          weight: 5,
          constant: 3,
          blank: false,
          imageUrl: '/r.png',
        },
      ],
    }
    expect(weightRows(layer)).toEqual([
      { traitId: 'none', weight: 10, constant: null },
      { traitId: 'wide', weight: 90, constant: null },
      { traitId: 'rare', weight: 0, constant: 3 },
    ])
  })
})
