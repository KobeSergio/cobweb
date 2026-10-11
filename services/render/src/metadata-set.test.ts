import { describe, expect, it } from 'vitest'
import { owlSpec, readCarFiles, TEXT } from './fixtures'
import { renderMetadataSet } from './metadata-set'
import type { AssetSpec, AssetToken, GenerativeToken } from './types'

const owls: GenerativeToken[] = Array.from({ length: 300 }, (_, i) => ({
  id: i + 1,
  collectionId: 'owls',
  dna: [i % 2 ? 'bg-dusk' : 'bg-ink', 'eyes-wide', i % 3 ? 'hat-none' : 'hat-cap'],
  description: i === 99 ? 'The hundredth owl.' : null,
}))
const imageCids = new Map([
  [0, 'bafyzero'],
  [1, 'bafyone'],
  [2, 'bafytwo'],
])
const parse = (bytes: Uint8Array | undefined) => JSON.parse(new TextDecoder().decode(bytes))

describe('renderMetadataSet, empty list', () => {
  it('refuses an empty token list as batch-range instead of packing an empty directory', async () => {
    const error = await renderMetadataSet(owlSpec(), [], imageCids).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'batch-range', message: 'The token list is empty.' })
  })
})

describe('renderMetadataSet, generative', () => {
  it('points each image into its own batch, for ids 1, 100, 101 and 300', async () => {
    const set = await renderMetadataSet(owlSpec(), owls, imageCids)
    const { files } = await readCarFiles(set.car)
    expect(parse(files.get('1')).image).toBe('ipfs://bafyzero/1.png')
    expect(parse(files.get('100')).image).toBe('ipfs://bafyzero/100.png')
    expect(parse(files.get('101')).image).toBe('ipfs://bafyone/101.png')
    expect(parse(files.get('300')).image).toBe('ipfs://bafytwo/300.png')
    expect(parse(files.get('100')).description).toBe('The hundredth owl.')
  })

  it('names files by bare id and ends the base URI with a slash', async () => {
    const set = await renderMetadataSet(owlSpec(), owls, imageCids)
    const { files, root } = await readCarFiles(set.car)
    expect(files.size).toBe(300)
    expect([...files.keys()].every((name) => /^[1-9][0-9]*$/.test(name))).toBe(true)
    expect(root).toBe(set.cid)
    expect(set.baseUri).toBe(`ipfs://${set.cid}/`)
  })

  it('refuses a token whose batch has no image CID', async () => {
    await expect(renderMetadataSet(owlSpec(), owls, new Map([[0, 'bafyzero']]))).rejects.toMatchObject({
      code: 'missing-batch',
      tokenId: 101,
      detail: { batchNo: 1 },
    })
  })

  it('refuses a DNA naming an unknown trait instead of writing short attributes', async () => {
    const bad = [{ ...owls[0]!, dna: ['bg-ink', 'eyes-gone', 'hat-none'] }]
    await expect(renderMetadataSet(owlSpec(), bad, imageCids)).rejects.toMatchObject({
      code: 'bad-dna',
      tokenId: 1,
    })
  })
})

describe('renderMetadataSet, refusals before and across tokens', () => {
  it('refuses a reserved extra field before looking at any token', async () => {
    const spec = owlSpec()
    const reserved = { ...spec, text: { ...spec.text, extraFields: { image: 'x' } } }
    await expect(renderMetadataSet(reserved, owls, new Map())).rejects.toMatchObject({
      code: 'reserved-key',
    })
  })

  it('refuses an asset token in a generative set as bad-dna', async () => {
    const asset: AssetToken = { id: 1, image: { key: 'a', ext: 'png' }, attributes: [] }
    await expect(renderMetadataSet(owlSpec(), [asset], imageCids)).rejects.toMatchObject({
      code: 'bad-dna',
      tokenId: 1,
    })
  })

  it('refuses a generative token in a 1/1 set as missing-image', async () => {
    const spec: AssetSpec = { kind: 'one_of_one', text: TEXT, batchSize: 100 }
    await expect(renderMetadataSet(spec, [owls[0]!], imageCids)).rejects.toMatchObject({
      code: 'missing-image',
      tokenId: 1,
    })
  })
})

describe('renderMetadataSet, 1/1', () => {
  it("uses each asset's own extension and stored attributes", async () => {
    const spec: AssetSpec = { kind: 'one_of_one', text: TEXT, batchSize: 100 }
    const tokens: AssetToken[] = [
      { id: 1, image: { key: 'a', ext: 'gif' }, attributes: [{ trait_type: 'Mood', value: 'Calm' }] },
      { id: 2, image: { key: 'b', ext: 'mp4' }, attributes: [] },
    ]
    const set = await renderMetadataSet(spec, tokens, imageCids)
    const { files } = await readCarFiles(set.car)
    expect(parse(files.get('1'))).toEqual({
      name: 'Owl #1',
      description: 'A night owl.',
      image: 'ipfs://bafyzero/1.gif',
      attributes: [{ trait_type: 'Mood', value: 'Calm' }],
    })
    expect(parse(files.get('2')).image).toBe('ipfs://bafyzero/2.mp4')
    expect(set.baseUri).toBe(`ipfs://${set.cid}/`)
  })
})

describe('renderMetadataSet, single asset', () => {
  const spec: AssetSpec = { kind: 'single_asset', text: TEXT, batchSize: 100 }
  const tokens: AssetToken[] = Array.from({ length: 150 }, (_, i) => ({
    id: i + 1,
    image: { key: 'art', ext: 'gif' },
    attributes: [],
  }))

  it('writes one metadata.json for token 1 and a base URI with no trailing slash', async () => {
    const set = await renderMetadataSet(spec, tokens, imageCids)
    const { files } = await readCarFiles(set.car)
    expect([...files.keys()]).toEqual(['metadata.json'])
    expect(parse(files.get('metadata.json')).image).toBe('ipfs://bafyzero/1.gif')
    expect(parse(files.get('metadata.json')).name).toBe('Owl #1')
    expect(set.baseUri).toBe(`ipfs://${set.cid}/metadata.json`)
  })

  it('refuses a list without token 1 as batch-range', async () => {
    await expect(renderMetadataSet(spec, tokens.slice(1), imageCids)).rejects.toMatchObject({
      code: 'batch-range',
    })
  })

  it('still requires every batch to have a CID', async () => {
    await expect(renderMetadataSet(spec, tokens, new Map([[0, 'bafyzero']]))).rejects.toMatchObject({
      code: 'missing-batch',
      tokenId: 101,
    })
  })
})
