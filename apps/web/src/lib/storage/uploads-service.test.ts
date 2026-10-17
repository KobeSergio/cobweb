import { describe, expect, it } from 'vitest'
import { admissionInputProblem, servedKeyOf, servedUrl, toRecord } from './uploads-service'

const row = {
  id: 'b4f2c9b1-0b3f-4d2a-8f6e-5a1b2c3d4e5f',
  kind: 'layer_image' as const,
  file_name: 'starry.png',
  mime: 'image/png',
  media_type: 'image' as const,
  bytes: 1234,
  width: 1000,
  height: 1000,
  content_hash: 'c'.repeat(64),
}

describe('uploads service helpers', () => {
  it('turns a row into the record the screens use, with served URLs', () => {
    expect(toRecord(row, true)).toEqual({
      id: row.id,
      kind: 'layer_image',
      fileName: 'starry.png',
      mime: 'image/png',
      mediaType: 'image',
      bytes: 1234,
      width: 1000,
      height: 1000,
      url: `/api/uploads/${row.id}`,
      thumbnailUrl: `/api/uploads/${row.id}?variant=thumb`,
    })
    expect(
      toRecord({ ...row, mime: 'video/mp4', media_type: 'video', width: null, height: null }, false)
        .thumbnailUrl,
    ).toBeNull()
    expect(servedUrl(row.id)).toBe(`/api/uploads/${row.id}`)
  })
  it('refuses malformed admission input with a sentence', () => {
    const good = {
      collectionId: row.id,
      kind: 'asset' as const,
      fileName: 'a.png',
      mime: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
      contentHash: 'a'.repeat(64),
      thumbnail: null,
    }
    expect(admissionInputProblem(good)).toBeNull()
    expect(admissionInputProblem({ ...good, fileName: '' })).toBe('The file needs a name.')
    expect(admissionInputProblem({ ...good, fileName: 'x'.repeat(256) })).toBe(
      'The file name is too long (255 characters at most).',
    )
    expect(admissionInputProblem({ ...good, contentHash: 'nope' })).toBe(
      'The file could not be hashed. Try again.',
    )
    expect(admissionInputProblem({ ...good, kind: 'thumbnail' as never })).toBe(
      'Thumbnails are uploaded with their image, not on their own.',
    )
    expect(admissionInputProblem({ ...good, collectionId: 'zzz' })).toBe(
      'This collection could not be found.',
    )
  })
})

describe('servedKeyOf (docs/specs/2026-10-17-production-hardening.md, section 7.3)', () => {
  const original = {
    kind: 'layer_image' as const,
    key: 'c/layers/a.png',
    thumbnailKey: 'c/thumbnails/a.webp',
  }
  const served = (variant: 'original' | 'thumb', sourcesDeleted: boolean, thumbnailKey: string | null) =>
    servedKeyOf({ ...original, variant, thumbnailKey, sourcesDeleted })

  it('serves an original, and its thumbnail for ?variant=thumb, falling back to the original before the purge', () => {
    expect(served('original', false, original.thumbnailKey)).toBe('c/layers/a.png')
    expect(served('thumb', false, original.thumbnailKey)).toBe('c/thumbnails/a.webp')
    expect(served('thumb', false, null)).toBe('c/layers/a.png')
  })

  it('serves only the thumbnail once the originals are deleted, and nothing for an original-size view', () => {
    expect(served('thumb', true, original.thumbnailKey)).toBe('c/thumbnails/a.webp')
    expect(served('thumb', true, null)).toBeNull()
    expect(served('original', true, original.thumbnailKey)).toBeNull()
    expect(served('original', true, null)).toBeNull()
  })

  it('serves a thumbnail row as itself, marked or not', () => {
    for (const sourcesDeleted of [false, true])
      for (const variant of ['original', 'thumb'] as const)
        expect(
          servedKeyOf({
            kind: 'thumbnail',
            key: 'c/thumbnails/a.webp',
            thumbnailKey: null,
            variant,
            sourcesDeleted,
          }),
        ).toBe('c/thumbnails/a.webp')
  })
})
