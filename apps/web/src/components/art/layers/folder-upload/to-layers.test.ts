import { describe, expect, it } from 'vitest'
import type { ArtProject } from '../../state/art-store'
import type { Layer } from '@/lib/demo'
import type { DetectedProject } from './folder-tree'
import { applyImport, importPayload, mergeUpload } from './to-layers'

const file = new File([new Uint8Array(4)], 'starry.png', { type: 'image/png' })
const detected: DetectedProject = {
  projectName: 'Owls',
  structureErrors: [],
  skipped: 0,
  collections: [
    {
      name: 'Owls',
      folder: 'Owls',
      layers: [
        {
          name: 'Eyes',
          folder: 'Owls/Eyes',
          traits: [
            { key: 'k-starry', name: 'Starry', file, path: '/Owls/Eyes/starry.png' },
            { key: 'k-sleepy', name: 'Sleepy', file, path: '/Owls/Eyes/sleepy.png' },
          ],
        },
      ],
    },
  ],
}

describe('mergeUpload', () => {
  it('gives each trait the stored URL and the upload id, and leaves out traits that did not upload', () => {
    const images = new Map([['k-starry', { url: '/api/uploads/u1', name: 'Starry', uploadId: 'u1' }]])
    const result = mergeUpload(
      { canvas: null, seed: 0, staleNote: null, showBlankTraits: false },
      detected,
      images,
    )
    const traits = (result.layers ?? []).flatMap((layer) => layer.traits)
    expect(traits).toHaveLength(1)
    expect(traits[0]).toMatchObject({
      name: 'Starry',
      imageUrl: '/api/uploads/u1',
      uploadId: 'u1',
      weight: 100,
    })
  })
})

describe('importing through the database (art wiring)', () => {
  const png = new File([new Uint8Array(4)], 'x.png', { type: 'image/png' })
  const longName = 'A'.repeat(60)
  const folder: DetectedProject = {
    projectName: null,
    structureErrors: [],
    skipped: 0,
    collections: [
      {
        name: longName,
        folder: longName,
        layers: [
          {
            name: 'Eyes',
            folder: `${longName}/Eyes`,
            traits: [
              { key: 'k1', name: 'Wide', file: png, path: '/x/Eyes/wide.png' },
              { key: 'k2', name: 'Broken', file: png, path: '/x/Eyes/broken.png' },
            ],
          },
          {
            name: 'Hats',
            folder: `${longName}/Hats`,
            traits: [{ key: 'k3', name: 'Cap', file: png, path: '/x/Hats/cap.png' }],
          },
        ],
      },
    ],
  }
  const empty: ArtProject = { canvas: null, seed: 1, staleNote: null, showBlankTraits: false }

  it('clips names to the column limits and leaves out traits without a stored image, and empty layers', () => {
    const stored = new Map([['k1', { url: '/api/uploads/u1', name: 'W'.repeat(70), uploadId: 'u1' }]])
    expect(importPayload(folder, stored)).toEqual({
      collections: [
        {
          name: 'A'.repeat(48),
          layers: [{ name: 'Eyes', traits: [{ name: 'W'.repeat(64), uploadId: 'u1' }] }],
        },
      ],
      activeCollectionId: null,
    })
  })

  it('shows the imported layers with the database ids, served images and even weights', () => {
    const payload = {
      collections: [
        {
          name: 'Owls',
          layers: [
            {
              name: 'Eyes',
              traits: [
                { name: 'Wide', uploadId: 'u1' },
                { name: 'Sleepy', uploadId: 'u2' },
              ],
            },
          ],
        },
      ],
      activeCollectionId: null,
    }
    const result = {
      collections: [{ id: 'art-1', layers: [{ id: 'layer-1', traits: [{ id: 't1' }, { id: 't2' }] }] }],
    }
    const project: ArtProject = {
      ...empty,
      collections: [{ id: 'old', name: 'Empty', size: 100 }],
      layers: [],
    }
    const merged = applyImport(project, payload, result)
    expect(merged.collections).toEqual([{ id: 'art-1', name: 'Owls', size: 0 }])
    expect(merged.activeCollectionId).toBe('art-1')
    expect(merged.layers).toEqual([
      {
        id: 'layer-1',
        collectionId: 'art-1',
        name: 'Eyes',
        position: 0,
        traits: [
          {
            id: 't1',
            layerId: 'layer-1',
            name: 'Wide',
            weight: 50,
            blank: false,
            imageUrl: '/api/uploads/u1',
            thumbnailUrl: '/api/uploads/u1?variant=thumb',
            uploadId: 'u1',
          },
          {
            id: 't2',
            layerId: 'layer-1',
            name: 'Sleepy',
            weight: 50,
            blank: false,
            imageUrl: '/api/uploads/u2',
            thumbnailUrl: '/api/uploads/u2?variant=thumb',
            uploadId: 'u2',
          },
        ],
      },
    ])
  })

  it('fills the active collection when one collection is imported into a project that has layers', () => {
    const body: Layer = { id: 'l0', collectionId: 'art-0', name: 'Body', position: 0, traits: [] }
    const project: ArtProject = {
      ...empty,
      collections: [
        { id: 'art-0', name: 'Owls', size: 10 },
        { id: 'art-9', name: 'Owlets', size: 5 },
      ],
      layers: [body],
    }
    const payload = {
      collections: [
        { name: 'Owlets', layers: [{ name: 'Eyes', traits: [{ name: 'Wide', uploadId: 'u1' }] }] },
      ],
      activeCollectionId: 'art-9',
    }
    const result = { collections: [{ id: 'art-9', layers: [{ id: 'layer-9', traits: [{ id: 't9' }] }] }] }
    const merged = applyImport(project, payload, result)
    expect(merged.collections).toEqual(project.collections)
    expect(merged.activeCollectionId).toBe('art-9')
    expect(merged.layers!.map((layer) => [layer.id, layer.collectionId])).toEqual([
      ['l0', 'art-0'],
      ['layer-9', 'art-9'],
    ])
  })
})
