import { describe, expect, it } from 'vitest'
import { admissionInputProblem, servedUrl, toRecord } from './uploads-service'

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
