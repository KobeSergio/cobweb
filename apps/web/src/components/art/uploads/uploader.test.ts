import { describe, expect, it } from 'vitest'
import type { AdmitInput, ConfirmInput, UploadRecord } from '@/lib/storage/uploads-service'
import { STOPPED, uploaderWith, type Put, type UploaderDeps, type UploadProgress } from './uploader'

const cid = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
const FILE_HASH = 'a'.repeat(64)
const THUMB_HASH = 'b'.repeat(64)
const key = `${cid}/layers/${FILE_HASH}.png`
const thumbKey = `${cid}/thumbnails/${FILE_HASH}.webp`
const record: UploadRecord = {
  id: 'b4f2c9b1-0b3f-4d2a-8f6e-5a1b2c3d4e5f',
  kind: 'layer_image',
  fileName: 'starry.png',
  mime: 'image/png',
  mediaType: 'image',
  bytes: 1000,
  width: 1000,
  height: 1000,
  url: '/api/uploads/b4f2c9b1-0b3f-4d2a-8f6e-5a1b2c3d4e5f',
  thumbnailUrl: '/api/uploads/b4f2c9b1-0b3f-4d2a-8f6e-5a1b2c3d4e5f?variant=thumb',
}

type FakePut = {
  url: string
  body: Blob
  signal: AbortSignal
  progress: (sent: number) => void
  resolve: () => void
  reject: (e: Error) => void
}

function harness(overrides: Partial<UploaderDeps> = {}) {
  const puts: FakePut[] = []
  const admitCalls: AdmitInput[] = []
  const confirmCalls: ConfirmInput[] = []
  const put: Put = (url, body, _mime, onProgress, signal) =>
    new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      puts.push({ url, body, signal, progress: onProgress, resolve, reject })
    })
  const deps: UploaderDeps = {
    hash: async (blob) => (blob.type === 'image/webp' ? THUMB_HASH : FILE_HASH),
    inspect: async () => ({
      width: 1000,
      height: 1000,
      thumbnail: { blob: new Blob(['thumb'], { type: 'image/webp' }), width: 256, height: 256 },
    }),
    admit: async (input) => {
      admitCalls.push(input)
      return {
        existing: false,
        key,
        putUrl: 'https://bucket/file',
        thumbnail: { key: thumbKey, putUrl: 'https://bucket/thumb' },
      }
    },
    confirm: async (input) => {
      confirmCalls.push(input)
      return { upload: record }
    },
    put,
    ...overrides,
  }
  const start = uploaderWith({ collectionId: cid, kind: 'layer_image' }, deps)
  const file = new File([new Uint8Array(1000)], 'starry.png', { type: 'image/png' })
  const seen: UploadProgress[] = []
  const handle = start(file)
  handle.progress$.subscribe((p) => seen.push(p))
  const latest = () => seen[seen.length - 1]!
  return { puts, admitCalls, confirmCalls, handle, seen, latest }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
async function until(condition: () => boolean) {
  for (let i = 0; i < 50 && !condition(); i++) await tick()
  if (!condition()) throw new Error('the condition never held')
}

describe('uploaderWith', () => {
  it('hashes, admits, PUTs the file then the thumbnail with progress, confirms with the keys', async () => {
    const h = harness()
    await until(() => h.puts.length === 1)
    expect(h.admitCalls[0]).toMatchObject({
      collectionId: cid,
      kind: 'layer_image',
      fileName: 'starry.png',
      mime: 'image/png',
      bytes: 1000,
      width: 1000,
      height: 1000,
      contentHash: FILE_HASH,
    })
    expect(h.admitCalls[0]!.thumbnail).toMatchObject({
      mime: 'image/webp',
      bytes: 5,
      width: 256,
      height: 256,
      contentHash: THUMB_HASH,
    })
    h.puts[0]!.progress(400)
    expect(h.latest()).toMatchObject({ state: 'uploading', sentBytes: 400, totalBytes: 1000 })
    h.puts[0]!.resolve()
    await until(() => h.puts.length === 2)
    expect(h.puts[1]!.url).toBe('https://bucket/thumb')
    h.puts[1]!.resolve()
    await until(() => h.latest().state === 'done')
    expect(h.confirmCalls[0]).toMatchObject({ key, thumbnailKey: thumbKey, contentHash: FILE_HASH })
    expect(h.latest()).toMatchObject({
      state: 'done',
      sentBytes: 1000,
      url: record.url,
      uploadId: record.id,
      record,
    })
  })

  it('is done at once when the project already has the file', async () => {
    const h = harness({ admit: async () => ({ existing: true, upload: record }) })
    await until(() => h.latest().state === 'done')
    expect(h.puts).toHaveLength(0)
    expect(h.latest()).toMatchObject({ sentBytes: 1000, uploadId: record.id })
  })

  it('fails with the stopped sentence when the PUT breaks, and retry starts over from zero', async () => {
    const h = harness()
    await until(() => h.puts.length === 1)
    h.puts[0]!.progress(700)
    h.puts[0]!.reject(new Error('network'))
    await until(() => h.latest().state === 'failed')
    expect(h.latest()).toMatchObject({ sentBytes: 0, error: STOPPED })
    h.handle.retry()
    await until(() => h.puts.length === 2)
    expect(h.puts[1]!.url).toBe('https://bucket/file')
    expect(h.latest()).toMatchObject({ state: 'uploading', sentBytes: 0 })
    expect(h.admitCalls).toHaveLength(2)
  })

  it('reads the file again on retry when hashing failed', async () => {
    let calls = 0
    const h = harness({
      hash: async (blob) => {
        if (++calls === 1) throw new Error('read failed')
        return blob.type === 'image/webp' ? THUMB_HASH : FILE_HASH
      },
    })
    await until(() => h.latest().state === 'failed')
    expect(h.latest().error).toBe(STOPPED)
    h.handle.retry()
    await until(() => h.admitCalls.length === 1)
    expect(h.latest().state).toBe('uploading')
  })

  it('pause aborts the PUT and resume starts it again from zero', async () => {
    const h = harness()
    await until(() => h.puts.length === 1)
    h.puts[0]!.progress(500)
    h.handle.pause()
    expect(h.puts[0]!.signal.aborted).toBe(true)
    await tick()
    expect(h.latest().state).toBe('paused')
    h.handle.resume()
    await until(() => h.puts.length === 2)
    expect(h.latest()).toMatchObject({ state: 'uploading', sentBytes: 0 })
  })

  it('fails with the server sentence when confirm refuses', async () => {
    const h = harness({ confirm: async () => ({ error: 'The upload did not arrive in full. Try again.' }) })
    await until(() => h.puts.length === 1)
    h.puts[0]!.resolve()
    await until(() => h.puts.length === 2)
    h.puts[1]!.resolve()
    await until(() => h.latest().state === 'failed')
    expect(h.latest().error).toBe('The upload did not arrive in full. Try again.')
  })

  it('refuses a file the rules refuse before asking the server', async () => {
    const h = harness({ inspect: async () => ({ width: 1000, height: 900, thumbnail: null }) })
    await until(() => h.latest().state === 'failed')
    expect(h.latest().error).toBe('Must be square: 1000 x 900.')
    expect(h.admitCalls).toHaveLength(0)
  })

  it('emits nothing after cancel', async () => {
    const h = harness()
    await until(() => h.puts.length === 1)
    const count = h.seen.length
    h.handle.cancel()
    h.puts[0]!.progress(900)
    h.puts[0]!.resolve()
    await tick()
    expect(h.seen).toHaveLength(count)
  })
})
