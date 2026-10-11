import { describe, expect, it } from 'vitest'
import { memoryLoader, readCarFiles } from './fixtures'
import { renderPlaceholder } from './placeholder'
import type { PlaceholderSpec } from './types'

const gif = new TextEncoder().encode('GIF89a placeholder bytes')
const mp4 = new TextEncoder().encode('....ftypisom placeholder bytes')
const spec = (ext: 'gif' | 'mp4'): PlaceholderSpec => ({
  kind: 'placeholder',
  image: { key: `soon.${ext}`, ext },
  name: 'Owls',
  description: 'Revealed soon.',
})

describe('renderPlaceholder', () => {
  for (const [ext, bytes] of [
    ['gif', gif],
    ['mp4', mp4],
  ] as const)
    it(`passes ${ext.toUpperCase()} bytes through with their extension`, async () => {
      const { image } = await renderPlaceholder(spec(ext), memoryLoader({ [`soon.${ext}`]: bytes }))
      const { files } = await readCarFiles(image.car)
      expect([...files.keys()]).toEqual([`placeholder.${ext}`])
      expect(files.get(`placeholder.${ext}`)).toEqual(bytes)
    })

  it('writes one metadata.json pointing at the image, with a slash-less base URI', async () => {
    const { image, metadata } = await renderPlaceholder(spec('gif'), memoryLoader({ 'soon.gif': gif }))
    const { files } = await readCarFiles(metadata.car)
    expect(JSON.parse(new TextDecoder().decode(files.get('metadata.json')))).toEqual({
      name: 'Owls',
      description: 'Revealed soon.',
      image: `ipfs://${image.cid}/placeholder.gif`,
    })
    expect(metadata.baseUri).toBe(`ipfs://${metadata.cid}/metadata.json`)
  })

  it('turns a failed load into missing-image naming the key', async () => {
    await expect(renderPlaceholder(spec('gif'), memoryLoader({}))).rejects.toMatchObject({
      code: 'missing-image',
      detail: { key: 'soon.gif', reason: 'No object at soon.gif' },
    })
  })
})
