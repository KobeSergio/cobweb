import { describe, expect, it, vi } from 'vitest'
import { flatPng, halfAlphaSquarePng, owlImages, owlSpec, readCarFiles } from './fixtures'
import { batchOf } from './generative'
import type { GenerativeSpec, GenerativeToken } from './types'

const png = (key: string) => ({ key, ext: 'png' as const })

/**
 * 300 tokens over 2 collections of 3 layers each: owls (ids 1 to 150; a blank hat and the hat layer
 * at opacity 0.5) and bats (ids 151 to 300), batch size 100.
 */
function miniProject(): { spec: GenerativeSpec; tokens: GenerativeToken[] } {
  const owls = owlSpec({ hatOpacity: 0.5 }).collections[0]!
  const bats = {
    id: 'bats',
    layers: [
      {
        id: 'sky',
        name: 'Sky',
        displayName: null,
        opacity: 1,
        traits: [
          { id: 'sky-night', name: 'Night', blank: false, inMetadata: true, image: png('sky-night.png') },
          { id: 'sky-moon', name: 'Moon', blank: false, inMetadata: true, image: png('sky-moon.png') },
        ],
      },
      {
        id: 'wings',
        name: 'Wings',
        displayName: null,
        opacity: 1,
        traits: [
          { id: 'wings-open', name: 'Open', blank: false, inMetadata: true, image: png('wings-open.png') },
          { id: 'wings-shut', name: 'Shut', blank: false, inMetadata: true, image: png('wings-shut.png') },
        ],
      },
      {
        id: 'mouth',
        name: 'Mouth',
        displayName: null,
        opacity: 1,
        traits: [
          { id: 'mouth-fang', name: 'Fang', blank: false, inMetadata: true, image: png('mouth-fang.png') },
          { id: 'mouth-grin', name: 'Grin', blank: false, inMetadata: true, image: png('mouth-grin.png') },
        ],
      },
    ],
  }
  const spec: GenerativeSpec = { ...owlSpec(), collections: [owls, bats] }
  const pick = (layer: { traits: { id: string }[] }, n: number) => layer.traits[n % layer.traits.length]!.id
  const tokens: GenerativeToken[] = Array.from({ length: 300 }, (_, i) => {
    const id = i + 1
    const collection = id <= 150 ? owls : bats
    return {
      id,
      collectionId: collection.id,
      dna: collection.layers.map((layer, depth) => pick(layer, Math.floor(id / (depth + 1)))),
      description: null,
    }
  })
  return { spec, tokens }
}

async function images(): Promise<Record<string, Uint8Array>> {
  return {
    ...(await owlImages()),
    'sky-night.png': await flatPng({ r: 5, g: 5, b: 30, alpha: 1 }),
    'sky-moon.png': await flatPng({ r: 60, g: 60, b: 90, alpha: 1 }),
    'wings-open.png': await halfAlphaSquarePng({ r: 90, g: 0, b: 90 }),
    'wings-shut.png': await halfAlphaSquarePng({ r: 40, g: 0, b: 40 }),
    'mouth-fang.png': await halfAlphaSquarePng({ r: 255, g: 255, b: 255 }),
    'mouth-grin.png': await halfAlphaSquarePng({ r: 200, g: 0, b: 0 }),
  }
}

/** Renders the project in a fresh module instance: three image batches, then the metadata set. */
async function renderAll() {
  vi.resetModules()
  const render = await import('./index')
  const { spec, tokens } = miniProject()
  const library = await images()
  const loadImage = async (ref: { key: string }) => {
    const bytes = library[ref.key]
    if (!bytes) throw new Error(`No object at ${ref.key}`)
    return bytes
  }
  const batches = []
  for (const batchNo of [0, 1, 2])
    batches.push(
      await render.renderBatch(
        spec,
        batchNo,
        tokens.filter((t) => batchOf(t.id, spec.batchSize) === batchNo),
        loadImage,
      ),
    )
  const metadata = await render.renderMetadataSet(
    spec,
    tokens,
    new Map(batches.map((b) => [b.batchNo, b.cid])),
  )
  return { batches, metadata }
}

describe('the render core, end to end', () => {
  it('renders 300 tokens twice with identical CIDs and bytes, and every image resolves', async () => {
    const first = await renderAll()
    const second = await renderAll()

    expect(second.batches.map((b) => b.cid)).toEqual(first.batches.map((b) => b.cid))
    expect(second.metadata.cid).toBe(first.metadata.cid)
    for (const [i, batch] of first.batches.entries()) expect(second.batches[i]!.car).toEqual(batch.car)
    expect(second.metadata.car).toEqual(first.metadata.car)

    expect(first.batches.map((b) => b.files.length)).toEqual([100, 100, 100])
    const batchByCid = new Map(first.batches.map((b) => [b.cid, new Set(b.files.map((f) => f.name))]))
    const { files } = await readCarFiles(first.metadata.car)
    expect(files.size).toBe(300)
    for (const [name, bytes] of files) {
      const match = /^ipfs:\/\/([a-z0-9]+)\/(\d+\.png)$/.exec(
        JSON.parse(new TextDecoder().decode(bytes)).image,
      )
      expect(match, name).not.toBeNull()
      expect(match![2]).toBe(`${name}.png`)
      expect(batchByCid.get(match![1]!)?.has(match![2]!), name).toBe(true)
    }
  }, 20_000)
})
