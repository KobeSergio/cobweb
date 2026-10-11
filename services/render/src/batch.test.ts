import { describe, expect, it } from 'vitest'
import { renderBatch } from './batch'
import { packDirectory } from './car'
import { flatPng, memoryLoader, owlImages, owlSpec, pixel, readCarFiles, TEXT } from './fixtures'
import { RenderProblem } from './problems'
import type { AssetSpec, AssetToken, GenerativeToken } from './types'

const owl = (id: number, dna: string[]): GenerativeToken => ({
  id,
  collectionId: 'owls',
  dna,
  description: null,
})
const tokens = [
  owl(3, ['bg-ink', 'eyes-wide', 'hat-cap']),
  owl(1, ['bg-ink', 'eyes-wide', 'hat-none']),
  owl(2, ['bg-dusk', 'eyes-sleepy', 'hat-none']),
]

describe('renderBatch, generative', () => {
  it('names files by id, in id order, and packs exactly those files', async () => {
    const batch = await renderBatch(owlSpec(), 0, tokens, memoryLoader(await owlImages()))
    expect(batch.batchNo).toBe(0)
    expect(batch.files.map((f) => f.name)).toEqual(['1.png', '2.png', '3.png'])
    expect(batch.cid).toBe((await packDirectory(batch.files)).cid)
    const { files } = await readCarFiles(batch.car)
    expect(files.get('3.png')).toEqual(batch.files[2]!.bytes)
  })

  it('composites the layers: the cap covers the eyes, the ink background shows at the edge', async () => {
    const batch = await renderBatch(owlSpec(), 0, [tokens[0]!], memoryLoader(await owlImages()))
    const png = batch.files[0]!.bytes
    expect(await pixel(png, 1, 1)).toEqual([20, 20, 60, 255])
    expect((await pixel(png, 32, 32))[0]).toBeGreaterThan(150)
  })

  it('loads each distinct key once per batch', async () => {
    const loader = memoryLoader(await owlImages())
    await renderBatch(owlSpec(), 0, tokens, loader)
    expect(Object.fromEntries(loader.calls)).toEqual({
      'bg-ink.png': 1,
      'bg-dusk.png': 1,
      'eyes-wide.png': 1,
      'eyes-sleepy.png': 1,
      'hat-cap.png': 1,
    })
  })

  it('refuses a token from another batch, an empty batch and an id below 1', async () => {
    const loader = memoryLoader(await owlImages())
    await expect(
      renderBatch(owlSpec(), 0, [owl(101, ['bg-ink', 'eyes-wide', 'hat-none'])], loader),
    ).rejects.toMatchObject({
      code: 'batch-range',
      tokenId: 101,
    })
    await expect(renderBatch(owlSpec(), 1, [], loader)).rejects.toMatchObject({ code: 'batch-range' })
    await expect(
      renderBatch(owlSpec(), 0, [owl(0, ['bg-ink', 'eyes-wide', 'hat-none'])], loader),
    ).rejects.toMatchObject({
      code: 'batch-range',
      tokenId: 0,
    })
  })

  it('refuses a DNA naming an unknown trait, naming the token', async () => {
    await expect(
      renderBatch(
        owlSpec(),
        0,
        [owl(4, ['bg-ink', 'eyes-gone', 'hat-none'])],
        memoryLoader(await owlImages()),
      ),
    ).rejects.toMatchObject({ code: 'bad-dna', tokenId: 4 })
  })

  it('turns a thrown load into missing-image naming the key and the token', async () => {
    const images = await owlImages()
    delete images['eyes-sleepy.png']
    const error = await renderBatch(owlSpec(), 0, tokens, memoryLoader(images)).catch((e: unknown) => e)
    expect(error).toMatchObject({
      code: 'missing-image',
      tokenId: 2,
      detail: { key: 'eyes-sleepy.png', reason: 'No object at eyes-sleepy.png' },
    })
    expect((error as Error).message).toBe('Token 2: The image eyes-sleepy.png could not be loaded.')
  })

  it('rejects the whole batch when one token fails, naming it', async () => {
    const images = {
      ...(await owlImages()),
      'hat-cap.png': await flatPng({ r: 1, g: 2, b: 3, alpha: 1 }, 32),
    }
    const error = await renderBatch(owlSpec(), 0, tokens, memoryLoader(images)).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'layer-size', tokenId: 3 })
    expect((error as Error).message).toBe(
      'Token 3: Image 3 of 3 in the stack is 32 by 32 pixels; the canvas is 64 by 64.',
    )
    expect((error as RenderProblem).detail).toMatchObject({ position: 2, layer: 'Hat' })
  })

  it('wraps an unreadable layer as decode naming the token', async () => {
    const images = { ...(await owlImages()), 'bg-dusk.png': new Uint8Array([9, 9, 9]) }
    await expect(renderBatch(owlSpec(), 0, tokens, memoryLoader(images))).rejects.toMatchObject({
      code: 'decode',
      tokenId: 2,
      detail: { position: 0, layer: 'Background' },
    })
  })

  it('refuses two tokens with the same id', async () => {
    await expect(
      renderBatch(
        owlSpec(),
        0,
        [owl(1, ['bg-ink', 'eyes-wide', 'hat-none']), owl(1, ['bg-ink', 'eyes-wide', 'hat-none'])],
        memoryLoader(await owlImages()),
      ),
    ).rejects.toMatchObject({ code: 'duplicate-name', tokenId: 1 })
  })

  it('refuses a duplicate id even when the tokens differ', async () => {
    await expect(
      renderBatch(
        owlSpec(),
        0,
        [tokens[1]!, owl(1, ['bg-dusk', 'eyes-sleepy', 'hat-none'])],
        memoryLoader(await owlImages()),
      ),
    ).rejects.toMatchObject({ code: 'duplicate-name', tokenId: 1 })
  })

  it('refuses a generative token in an asset batch and an asset token in a generative batch', async () => {
    const assetSpec: AssetSpec = { kind: 'one_of_one', text: TEXT, batchSize: 100 }
    await expect(renderBatch(assetSpec, 0, [tokens[1]!], memoryLoader({}))).rejects.toMatchObject({
      code: 'missing-image',
      tokenId: 1,
    })
    const asset: AssetToken = { id: 1, image: { key: 'a.png', ext: 'png' }, attributes: [] }
    await expect(renderBatch(owlSpec(), 0, [asset], memoryLoader(await owlImages()))).rejects.toMatchObject({
      code: 'bad-dna',
      tokenId: 1,
    })
  })

  it('gives the same CID at concurrency 1 and 4', async () => {
    const images = await owlImages()
    const one = await renderBatch(owlSpec(), 0, tokens, memoryLoader(images), { concurrency: 1 })
    const four = await renderBatch(owlSpec(), 0, tokens, memoryLoader(images), { concurrency: 4 })
    expect(four.cid).toBe(one.cid)
  })

  it('refuses a reserved extra field before rendering anything', async () => {
    const spec = { ...owlSpec(), text: { ...TEXT, extraFields: { image: 'x' } } }
    const loader = memoryLoader(await owlImages())
    await expect(renderBatch(spec, 0, tokens, loader)).rejects.toMatchObject({ code: 'reserved-key' })
    expect(loader.calls.size).toBe(0)
  })
})

describe('renderBatch, 1/1 and single asset', () => {
  const gif = new TextEncoder().encode('GIF89a not decoded')
  const mp4 = new TextEncoder().encode('....ftypisom not decoded')
  const assets: AssetToken[] = [
    { id: 2, image: { key: 'two.mp4', ext: 'mp4' }, attributes: [] },
    { id: 1, image: { key: 'one.gif', ext: 'gif' }, attributes: [] },
  ]
  const spec: AssetSpec = { kind: 'one_of_one', text: TEXT, batchSize: 100 }

  it('passes the bytes through unchanged with their extension', async () => {
    const batch = await renderBatch(spec, 0, assets, memoryLoader({ 'one.gif': gif, 'two.mp4': mp4 }))
    expect(batch.files).toEqual([
      { name: '1.gif', bytes: gif },
      { name: '2.mp4', bytes: mp4 },
    ])
  })

  it('reads a single asset shared by every token once', async () => {
    const shared: AssetToken[] = [1, 2, 3].map((id) => ({
      id,
      image: { key: 'art.gif', ext: 'gif' },
      attributes: [],
    }))
    const loader = memoryLoader({ 'art.gif': gif })
    const batch = await renderBatch({ ...spec, kind: 'single_asset' }, 0, shared, loader)
    expect(batch.files.map((f) => f.name)).toEqual(['1.gif', '2.gif', '3.gif'])
    expect(loader.calls.get('art.gif')).toBe(1)
  })
})
