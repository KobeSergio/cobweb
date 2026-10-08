import { describe, expect, it } from 'vitest'
import { uploadAll } from './upload-once'
import type { StartUpload, UploadProgress, UploadRecord } from './uploader'

const record = (id: string): UploadRecord => ({
  id,
  kind: 'layer_image',
  fileName: `${id}.png`,
  mime: 'image/png',
  mediaType: 'image',
  bytes: 10,
  width: 100,
  height: 100,
  url: `/api/uploads/${id}`,
  thumbnailUrl: `/api/uploads/${id}?variant=thumb`,
})

/** Emits "uploading", then the outcome named after the file, asynchronously like the real uploader. */
const fakeStart =
  (outcomes: Record<string, UploadProgress>): StartUpload =>
  (file) => ({
    progress$: {
      subscribe(listener) {
        listener({ state: 'uploading', sentBytes: 0, totalBytes: 10 })
        queueMicrotask(() => listener(outcomes[file.name]!))
        return () => {}
      },
    },
    pause() {},
    resume() {},
    retry() {},
    cancel() {},
  })

describe('uploadAll', () => {
  it('settles each file with its record or its sentence, in the order given', async () => {
    const start = fakeStart({
      'a.png': { state: 'done', sentBytes: 10, totalBytes: 10, record: record('a') },
      'b.png': {
        state: 'failed',
        sentBytes: 0,
        totalBytes: 10,
        error: 'The upload stopped. Retry to upload it again.',
      },
      'c.png': { state: 'done', sentBytes: 10, totalBytes: 10, record: record('c') },
    })
    const files = ['a.png', 'b.png', 'c.png'].map((name) => new File([new Uint8Array(10)], name))
    expect(await uploadAll(start, files, 2)).toEqual([
      { record: record('a') },
      { error: 'The upload stopped. Retry to upload it again.' },
      { record: record('c') },
    ])
  })

  it('settles a file whose start throws as stopped', async () => {
    const start: StartUpload = () => {
      throw new Error('boom')
    }
    const files = [new File([new Uint8Array(10)], 'a.png')]
    expect(await uploadAll(start, files)).toEqual([
      { error: 'The upload stopped. Retry to upload it again.' },
    ])
  })
})
