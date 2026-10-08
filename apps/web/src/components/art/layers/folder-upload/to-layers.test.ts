import { describe, expect, it } from 'vitest'
import type { DetectedProject } from './folder-tree'
import { mergeUpload } from './to-layers'

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
