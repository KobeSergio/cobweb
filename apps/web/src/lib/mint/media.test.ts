import { describe, expect, it } from 'vitest'
import type { FileFacts } from '@/lib/storage/admission'
import { keyBelongs, mimeOfKey, mintPageKey, mintPageMediaProblem } from './media'

const MB = 1024 * 1024
const COLLECTION = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const OTHER = '7d2c9e10-5b44-4a6f-9c3e-2f1b8a7d6e5c'
const HASH = 'ab'.repeat(32)
const image = (mime: string, bytes: number, side = 1000): FileFacts => ({
  mime,
  bytes,
  width: side,
  height: side,
})

describe('mintPageMediaProblem (docs/specs/2026-10-16-mint-page-live-data.md, section 4.4)', () => {
  it('takes PNG, JPG, WebP and GIF in the image slots, and refuses an SVG and a video there', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
      for (const slot of ['banner', 'about', 'avatar', 'team'] as const)
        expect(mintPageMediaProblem(slot, image(mime, MB))).toBeNull()
    expect(mintPageMediaProblem('banner', image('image/svg+xml', 1000))).toBe(
      'Use a PNG, JPG, WebP or GIF image.',
    )
    expect(mintPageMediaProblem('team', image('video/mp4', MB))).toBe('Use a PNG, JPG, WebP or GIF image.')
  })

  it('caps banners at 5 MB and the avatar and team photos at 2 MB', () => {
    expect(mintPageMediaProblem('banner', image('image/png', 5 * MB))).toBeNull()
    expect(mintPageMediaProblem('banner', image('image/png', 6 * MB))).toBe('6 MB is over the 5 MB limit.')
    expect(mintPageMediaProblem('about', image('image/jpeg', 5 * MB + 1))).toBe(
      '6 MB is over the 5 MB limit.',
    )
    expect(mintPageMediaProblem('avatar', image('image/png', 3 * MB))).toBe('3 MB is over the 2 MB limit.')
    expect(mintPageMediaProblem('team', image('image/gif', 2 * MB + 1))).toBe('3 MB is over the 2 MB limit.')
  })

  it('takes images up to 5 MB and an MP4 up to 20 MB as a carousel slide', () => {
    expect(mintPageMediaProblem('slide', image('image/webp', 5 * MB))).toBeNull()
    expect(mintPageMediaProblem('slide', image('image/webp', 6 * MB))).toBe('6 MB is over the 5 MB limit.')
    const video: FileFacts = { mime: 'video/mp4', bytes: 20 * MB, width: null, height: null }
    expect(mintPageMediaProblem('slide', video)).toBeNull()
    expect(mintPageMediaProblem('slide', { ...video, bytes: 21 * MB })).toBe('21 MB is over the 20 MB limit.')
    expect(mintPageMediaProblem('slide', image('image/svg+xml', 10))).toBe(
      'Use a PNG, JPG, WebP or GIF image, or an MP4 video.',
    )
  })

  it('takes one MP3 up to 20 MB as the music, and nothing else', () => {
    const track: FileFacts = { mime: 'audio/mpeg', bytes: 20 * MB, width: null, height: null }
    expect(mintPageMediaProblem('music', track)).toBeNull()
    expect(mintPageMediaProblem('music', { ...track, bytes: 20 * MB + 1 })).toBe(
      '21 MB is over the 20 MB limit.',
    )
    expect(mintPageMediaProblem('music', { ...track, mime: 'audio/wav' })).toBe('Use an MP3 file.')
  })

  it('needs an avatar of at least 400 by 400, read from the file', () => {
    expect(mintPageMediaProblem('avatar', image('image/png', MB, 400))).toBeNull()
    expect(mintPageMediaProblem('avatar', { mime: 'image/png', bytes: MB, width: 800, height: 399 })).toBe(
      'The avatar must be at least 400 by 400.',
    )
    expect(mintPageMediaProblem('avatar', { mime: 'image/png', bytes: MB, width: null, height: null })).toBe(
      'The avatar must be at least 400 by 400.',
    )
    expect(mintPageMediaProblem('banner', image('image/png', MB, 100))).toBeNull()
  })
})

describe('mintPageKey and keyBelongs', () => {
  it('names a file by the collection and its hash, with the extension of its type', () => {
    expect(mintPageKey(COLLECTION, HASH, 'image/jpeg')).toBe(`${COLLECTION}/${HASH}.jpg`)
    expect(mintPageKey(COLLECTION, HASH, 'audio/mpeg')).toBe(`${COLLECTION}/${HASH}.mp3`)
    expect(() => mintPageKey(COLLECTION, 'AB'.repeat(32), 'image/png')).toThrow()
    expect(() => mintPageKey(COLLECTION, HASH, 'image/svg+xml')).toThrow()
  })

  it("keeps each slot to its types, and refuses another collection's key or another shape", () => {
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.png`, 'banner')).toBe(true)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.mp4`, 'banner')).toBe(false)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.mp4`, 'slide')).toBe(true)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.mp3`, 'music')).toBe(true)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.png`, 'music')).toBe(false)
    expect(keyBelongs(COLLECTION, `${OTHER}/${HASH}.png`, 'avatar')).toBe(false)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/${HASH}.svg`, 'team')).toBe(false)
    expect(keyBelongs(COLLECTION, `${COLLECTION}/layers/${HASH}.png`, 'about')).toBe(false)
  })

  it('reads the type back from a key', () => {
    expect(mimeOfKey(`${COLLECTION}/${HASH}.webp`)).toBe('image/webp')
    expect(mimeOfKey(`${COLLECTION}/${HASH}.mp4`)).toBe('video/mp4')
    expect(mimeOfKey(`${COLLECTION}/${HASH}.svg`)).toBeNull()
  })
})
