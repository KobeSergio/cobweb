import { describe, expect, it } from 'vitest'
import { extensionFor, mediaTypeFor, storageKey } from './keys'

const cid = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
const hash = 'a'.repeat(64)

describe('storageKey', () => {
  it('builds <collection>/<folder>/<hash>.<ext> for every kind', () => {
    expect(storageKey(cid, 'layer_image', hash, 'image/png')).toBe(`${cid}/layers/${hash}.png`)
    expect(storageKey(cid, 'asset', hash, 'image/jpeg')).toBe(`${cid}/assets/${hash}.jpg`)
    expect(storageKey(cid, 'placeholder', hash, 'video/mp4')).toBe(`${cid}/placeholders/${hash}.mp4`)
    expect(storageKey(cid, 'thumbnail', hash, 'image/webp')).toBe(`${cid}/thumbnails/${hash}.webp`)
  })
  it('refuses a hash that is not 64 lowercase hex', () => {
    expect(() => storageKey(cid, 'asset', 'ABC', 'image/png')).toThrow(/hash/)
  })
})

describe('mime mapping', () => {
  it('maps the five accepted types and nothing else', () => {
    expect(extensionFor('image/png')).toBe('png')
    expect(extensionFor('image/jpeg')).toBe('jpg')
    expect(extensionFor('image/webp')).toBe('webp')
    expect(extensionFor('image/gif')).toBe('gif')
    expect(extensionFor('video/mp4')).toBe('mp4')
    expect(() => extensionFor('text/plain')).toThrow(/type/)
    expect(mediaTypeFor('image/gif')).toBe('gif')
    expect(mediaTypeFor('video/mp4')).toBe('video')
    expect(mediaTypeFor('image/webp')).toBe('image')
  })
})
