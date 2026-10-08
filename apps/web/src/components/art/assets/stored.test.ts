import { describe, expect, it } from 'vitest'
import type { QueueItem } from '../uploads/upload-queue'
import type { AssetItem } from './types'
import { adoptRecords } from './stored'

const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })
const item = (key: string, uploadId: string | null = null): AssetItem => ({
  key,
  fileName: `${key}.png`,
  url: `blob:${key}`,
  mediaType: 'image',
  quantity: 1,
  attributes: [],
  bytes: 10,
  owned: true,
  uploadId,
})
const queued = (id: string, state: QueueItem['state'], uploadId?: string): QueueItem => ({
  id,
  file,
  label: `${id}.png`,
  state,
  sentBytes: 10,
  totalBytes: 10,
  ...(uploadId
    ? {
        uploadId,
        url: `/api/uploads/${uploadId}`,
        record: {
          id: uploadId,
          kind: 'asset',
          fileName: `${id}.png`,
          mime: 'image/png',
          mediaType: 'image',
          bytes: 12,
          width: 1,
          height: 1,
          url: `/api/uploads/${uploadId}`,
          thumbnailUrl: `/api/uploads/${uploadId}?variant=thumb`,
        },
      }
    : {}),
})

describe('adoptRecords', () => {
  it('switches a finished item to its served URL and upload id, and lists its object URL to revoke', () => {
    const result = adoptRecords(
      [item('a'), item('b')],
      [queued('a', 'done', 'u-a'), queued('b', 'uploading')],
    )
    expect(result).not.toBeNull()
    expect(result!.items[0]).toMatchObject({
      url: '/api/uploads/u-a',
      uploadId: 'u-a',
      bytes: 12,
      owned: false,
    })
    expect(result!.items[1]).toMatchObject({ url: 'blob:b', uploadId: null, owned: true })
    expect(result!.revoke).toEqual(['blob:a'])
  })
  it('returns null when nothing new finished, so the screen does not re-render', () => {
    expect(adoptRecords([item('a', 'u-a')], [queued('a', 'done', 'u-a')])).toBeNull()
    expect(adoptRecords([item('a')], [queued('a', 'failed')])).toBeNull()
  })
})
