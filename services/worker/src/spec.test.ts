import { describe, expect, it } from 'vitest'
import { imageRef, renderSpec, tokenSlice } from './spec.ts'
import {
  assetData,
  assetKey,
  assetRows,
  generativeData,
  generativeRows,
  layerKey,
  PLACEHOLDER_KEY,
  placeholderData,
} from './testing/fixtures.ts'

const problem = (run: () => unknown): { code?: string; message?: string; name?: string } => {
  try {
    run()
  } catch (error) {
    return error as { code?: string; message?: string; name?: string }
  }
  return {}
}

describe('imageRef', () => {
  it('takes the extension from the key', () => {
    expect(imageRef('c/layers/abc.png')).toEqual({ key: 'c/layers/abc.png', ext: 'png' })
    expect(imageRef('c/assets/abc.mp4')).toEqual({ key: 'c/assets/abc.mp4', ext: 'mp4' })
    expect(imageRef('c/assets/abc.jpg')?.ext).toBe('jpg')
  })

  it('is null for a key with no known extension', () => {
    expect(imageRef('c/assets/abc')).toBeNull()
    expect(imageRef('c/assets/abc.svg')).toBeNull()
    expect(imageRef('c/assets/png')).toBeNull()
  })
})

describe('renderSpec: generative', () => {
  it('maps the canvas, the text and the batch size', () => {
    const spec = renderSpec(generativeData())
    expect(spec).toMatchObject({
      kind: 'generative',
      canvas: 64,
      batchSize: 2,
      text: { tokenName: 'Owl', tokenDescription: 'A night owl.', showBlankTraits: false, extraFields: {} },
    })
  })

  it('orders layers bottom first and traits by position, at full opacity', () => {
    const spec = renderSpec(generativeData())
    if (spec.kind !== 'generative') throw new Error('not generative')
    const [collection] = spec.collections
    expect(collection?.layers.map((layer) => layer.name)).toEqual(['Background', 'Eyes', 'Hat'])
    expect(collection?.layers.map((layer) => layer.opacity)).toEqual([1, 1, 1])
    expect(collection?.layers[0]?.displayName).toBe('Scene')
    expect(collection?.layers[0]?.traits.map((trait) => trait.name)).toEqual(['Ink', 'Dusk'])
  })

  it('gives a trait its upload as an image reference and a blank none', () => {
    const spec = renderSpec(generativeData())
    if (spec.kind !== 'generative') throw new Error('not generative')
    const hat = spec.collections[0]?.layers[2]
    expect(hat?.traits).toEqual([
      { id: 't-none', name: 'None', blank: true, inMetadata: true, image: null },
      {
        id: 't-cap',
        name: 'Cap',
        blank: false,
        inMetadata: true,
        image: { key: layerKey('cap'), ext: 'png' },
      },
    ])
  })

  it('orders art collections by position', () => {
    const data = generativeData()
    data.artCollections = [
      { id: 'second', position: 1 },
      { id: 'first', position: 0 },
    ]
    const spec = renderSpec(data)
    if (spec.kind !== 'generative') throw new Error('not generative')
    expect(spec.collections.map((collection) => collection.id)).toEqual(['first', 'second'])
  })

  it('uses the collection name when there is no token name', () => {
    const data = generativeData()
    data.collection.tokenName = null
    expect(renderSpec(data)).toMatchObject({ text: { tokenName: 'Night Owls' } })
  })

  it('refuses a trait that is not blank and has no upload', () => {
    const data = generativeData()
    data.traits = data.traits.map((trait) => (trait.id === 't-cap' ? { ...trait, uploadId: null } : trait))
    expect(problem(() => renderSpec(data))).toMatchObject({
      name: 'RenderProblem',
      code: 'missing-image',
      message: 'Trait Cap in layer Hat has no image.',
    })
  })

  it('refuses a trait whose upload is not in the project', () => {
    const data = generativeData()
    data.uploads = data.uploads.filter((upload) => upload.id !== 'u-wide')
    expect(problem(() => renderSpec(data))).toMatchObject({ name: 'RenderProblem', code: 'missing-image' })
  })

  it('gives each art collection only its own layers', () => {
    const data = generativeData()
    const layer = data.layers[0]!
    data.artCollections = [
      { id: 'art-a', position: 0 },
      { id: 'art-b', position: 1 },
    ]
    data.layers = [
      { ...layer, id: 'l-a', artCollectionId: 'art-a', position: 0 },
      { ...layer, id: 'l-b', artCollectionId: 'art-b', position: 0 },
    ]
    data.traits = []
    const spec = renderSpec(data)
    if (spec.kind !== 'generative') throw new Error('not generative')
    expect(spec.collections.map((c) => [c.id, c.layers.map((l) => l.id)])).toEqual([
      ['art-a', ['l-a']],
      ['art-b', ['l-b']],
    ])
  })

  it('maps inMetadata false and showBlankTraits true through', () => {
    const data = generativeData()
    data.traits = data.traits.map((trait) => (trait.id === 't-cap' ? { ...trait, inMetadata: false } : trait))
    data.collection.showBlankTraits = true
    const spec = renderSpec(data)
    if (spec.kind !== 'generative') throw new Error('not generative')
    expect(spec.collections[0]?.layers[2]?.traits[1]?.inMetadata).toBe(false)
    expect(spec.text.showBlankTraits).toBe(true)
  })

  it('refuses a trait whose file is of an unsupported type with its own sentence', () => {
    const data = generativeData()
    data.uploads = data.uploads.map((upload) =>
      upload.id === 'u-wide' ? { ...upload, storageKey: upload.storageKey.replace('.png', '.jpeg') } : upload,
    )
    const error = problem(() => renderSpec(data))
    expect(error).toMatchObject({ code: 'missing-image' })
    expect(error.message).toMatch(/^The file for trait .+ is not a supported type\.$/)
  })

  it('refuses a project with no canvas', () => {
    const data = generativeData()
    data.collection.canvasWidth = null
    expect(problem(() => renderSpec(data))).toMatchObject({ name: 'RenderProblem', code: 'missing-image' })
  })
})

describe('renderSpec: 1/1, single asset and placeholder', () => {
  it('maps a 1/1 project to an asset spec', () => {
    expect(renderSpec(assetData())).toEqual({
      kind: 'one_of_one',
      batchSize: 2,
      text: { tokenName: 'Owl', tokenDescription: 'A night owl.', showBlankTraits: false, extraFields: {} },
    })
  })

  it('maps a single asset project by its type', () => {
    const data = assetData()
    data.collection.projectType = 'single_asset'
    expect(renderSpec(data).kind).toBe('single_asset')
  })

  it('maps a placeholder job to the placeholder file with the collection name and description', () => {
    expect(renderSpec(placeholderData())).toEqual({
      kind: 'placeholder',
      image: { key: PLACEHOLDER_KEY, ext: 'gif' },
      name: 'Night Owls',
      description: 'Owls that stay up.',
    })
  })

  it('refuses a placeholder job whose file is not in the project', () => {
    const data = placeholderData()
    data.uploads = []
    expect(problem(() => renderSpec(data))).toMatchObject({ name: 'RenderProblem', code: 'missing-image' })
  })
})

describe('tokenSlice', () => {
  it('maps token rows to generative tokens', () => {
    expect(tokenSlice(generativeData(), generativeRows(3, 4))).toEqual([
      {
        id: 3,
        collectionId: 'aaaaaaaa-0000-4000-8000-000000000001',
        dna: ['t-ink', 't-wide', 't-none'],
        description: 'The third owl.',
      },
      {
        id: 4,
        collectionId: 'aaaaaaaa-0000-4000-8000-000000000001',
        dna: ['t-dusk', 't-wide', 't-cap'],
        description: null,
      },
    ])
  })

  it('resolves each list entry to its file and keeps its attributes', () => {
    expect(tokenSlice(assetData(), assetRows(2, 3))).toEqual([
      {
        id: 2,
        image: { key: assetKey('two'), ext: 'png' },
        attributes: [{ trait_type: 'Edition', value: '2' }],
      },
      {
        id: 3,
        image: { key: assetKey('three', 'gif'), ext: 'gif' },
        attributes: [{ trait_type: 'Edition', value: '3' }],
      },
    ])
  })

  it('leaves out attribute entries that are not a trait type and a value', () => {
    const rows = assetRows(1, 1)
    if (rows.kind !== 'assets') throw new Error('not assets')
    rows.rows[0]!.attributes = [
      { traitType: 'Mood', value: 'Calm' },
      { traitType: 7, value: 'x' },
      { value: 'no key' },
      'loose',
      null,
      { trait_type: 'Deep', value: { a: 1 } },
    ]
    expect(tokenSlice(assetData(), rows)[0]).toMatchObject({
      attributes: [{ trait_type: 'Mood', value: 'Calm' }],
    })
    rows.rows[0]!.attributes = 'not a list'
    expect(tokenSlice(assetData(), rows)[0]).toMatchObject({ attributes: [] })
  })

  it('maps the stored traitType key, and accepts trait_type too', () => {
    const rows = assetRows(1, 1)
    if (rows.kind !== 'assets') throw new Error('not assets')
    rows.rows[0]!.attributes = [
      { traitType: 'Artist', value: 'Ada' },
      { trait_type: 'Mood', value: 'Calm' },
    ]
    expect(tokenSlice(assetData(), rows)[0]).toMatchObject({
      attributes: [
        { trait_type: 'Artist', value: 'Ada' },
        { trait_type: 'Mood', value: 'Calm' },
      ],
    })
  })

  it('refuses an entry whose upload id is unknown, naming the token', () => {
    const error = problem(() => tokenSlice(assetData(), assetRows(4, 4)))
    expect(error).toMatchObject({
      name: 'RenderProblem',
      code: 'missing-image',
      message: 'Token 4 names a file the project does not have.',
    })
    expect((error as { tokenId?: number }).tokenId).toBe(4)
  })

  it('refuses a file of an unsupported type with its own sentence', () => {
    const data = assetData()
    data.uploads = data.uploads.map((upload) =>
      upload.id === 'u-two' ? { ...upload, storageKey: assetKey('two', 'jpeg') } : upload,
    )
    expect(problem(() => tokenSlice(data, assetRows(2, 2)))).toMatchObject({
      code: 'missing-image',
      message: 'The file for token 2 is not a supported type.',
    })
  })

  it('sees an uploads array that was replaced', () => {
    const data = assetData()
    tokenSlice(data, assetRows(1, 1))
    data.uploads = []
    expect(problem(() => tokenSlice(data, assetRows(1, 1)))).toMatchObject({ code: 'missing-image' })
  })

  it('refuses rows of the wrong kind for the project', () => {
    expect(problem(() => tokenSlice(generativeData(), assetRows(1, 1)))).toMatchObject({ code: 'bad-dna' })
    expect(problem(() => tokenSlice(assetData(), generativeRows(1, 1)))).toMatchObject({
      code: 'missing-image',
    })
  })
})
