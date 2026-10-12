import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { isMissingObject, isObjectTooLarge } from '../ports.ts'
import { COLLECTION_ID, JOB_ID } from '../testing/fixtures.ts'
import { bytes, stubAws } from '../testing/stub-aws.ts'
import { COLLAGE_KEY, MAX_OBJECT_BYTES, s3Store } from './s3-store.ts'

const body = (text: string) => ({ Body: { transformToByteArray: async () => bytes(text) } })
const ref = { key: 'c/layers/a.png', ext: 'png' } as const

/** Store options for tests: the retry delay is recorded, not waited for. */
const quick = () => {
  const waits: number[] = []
  return { waits, options: { sleep: async (ms: number) => void waits.push(ms) } }
}

describe('s3Store: the upload limit', () => {
  const stores = (answer: () => unknown) => {
    const art = stubAws(answer)
    const { waits, options } = quick()
    return {
      art,
      waits,
      store: s3Store(
        { client: art.client, bucket: 'art' },
        { client: art.client, bucket: 'render' },
        options,
      ),
    }
  }

  it('is 50 MiB, the upload limit', () => {
    expect(MAX_OBJECT_BYTES).toBe(52_428_800)
  })

  it('refuses a ContentLength above the limit before reading the body, once, with no retry', async () => {
    let read = false
    const { art, waits, store } = stores(() => ({
      ContentLength: MAX_OBJECT_BYTES + 1,
      Body: {
        transformToByteArray: async () => {
          read = true
          return new Uint8Array()
        },
      },
    }))
    const error = await store.load(ref).catch((thrown: unknown) => thrown)
    expect(isObjectTooLarge(error)).toBe(true)
    expect(isMissingObject(error)).toBe(false)
    expect(read).toBe(false)
    expect(art.sent).toHaveLength(1)
    expect(waits).toEqual([])
  })

  it('reads a body at exactly the limit', async () => {
    const { store } = stores(() => ({ ContentLength: MAX_OBJECT_BYTES, ...body('png') }))
    expect(await store.load(ref)).toEqual(bytes('png'))
  })

  it('stops reading a streamed body that grows past the limit, whatever its ContentLength says', async () => {
    let chunks = 0
    const big = new Uint8Array(MAX_OBJECT_BYTES / 2)
    const { waits, store } = stores(() => ({
      ContentLength: 10,
      Body: {
        transformToByteArray: async () => new Uint8Array(),
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < 10; i++) {
            chunks += 1
            yield big
          }
        },
      },
    }))
    const error = await store.load(ref).catch((thrown: unknown) => thrown)
    expect(isObjectTooLarge(error)).toBe(true)
    expect(chunks).toBe(3)
    expect(waits).toEqual([])
  })

  it('joins the chunks of a streamed body within the limit', async () => {
    const { store } = stores(() => ({
      Body: {
        transformToByteArray: async () => new Uint8Array(),
        async *[Symbol.asyncIterator]() {
          yield bytes('pn')
          yield bytes('g')
        },
      },
    }))
    expect(await store.load(ref)).toEqual(bytes('png'))
  })
})

describe('s3Store', () => {
  it('loads an object from the art bucket by its key', async () => {
    const art = stubAws(() => body('png'))
    const render = stubAws()
    const store = s3Store({ client: art.client, bucket: 'art' }, { client: render.client, bucket: 'render' })
    expect(await store.load(ref)).toEqual(bytes('png'))
    expect(art.sent).toEqual([
      { name: GetObjectCommand.name, input: { Bucket: 'art', Key: 'c/layers/a.png' } },
    ])
    expect(render.sent).toEqual([])
  })

  it('throws MissingObject at once, with no retry, when S3 says the key does not exist', async () => {
    for (const fault of [
      Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' }),
      Object.assign(new Error('The specified key does not exist.'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      }),
    ]) {
      const missing = stubAws(() => {
        throw fault
      })
      const { waits, options } = quick()
      const store = s3Store(
        { client: missing.client, bucket: 'art' },
        { client: missing.client, bucket: 'render' },
        options,
      )
      const error = await store.load(ref).catch((thrown: unknown) => thrown)
      expect(isMissingObject(error)).toBe(true)
      expect(missing.sent).toHaveLength(1)
      expect(waits).toEqual([])
    }
  })

  it('retries a throttle and returns the bytes once the third try answers', async () => {
    let tries = 0
    const art = stubAws(() => {
      tries += 1
      if (tries < 3)
        throw Object.assign(new Error('Slow Down'), { name: 'SlowDown', $metadata: { httpStatusCode: 503 } })
      return body('png')
    })
    const { waits, options } = quick()
    const store = s3Store(
      { client: art.client, bucket: 'art' },
      { client: art.client, bucket: 'render' },
      options,
    )
    expect(await store.load(ref)).toEqual(bytes('png'))
    expect(art.sent).toHaveLength(3)
    expect(waits).toHaveLength(2)
  })

  it('throws the last error as it is after three failures, and it is not a MissingObject', async () => {
    const art = stubAws(() => {
      throw Object.assign(new Error('socket hang up'), { name: 'TimeoutError' })
    })
    const { waits, options } = quick()
    const store = s3Store(
      { client: art.client, bucket: 'art' },
      { client: art.client, bucket: 'render' },
      options,
    )
    const error = await store.load(ref).catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ name: 'TimeoutError', message: 'socket hang up' })
    expect(isMissingObject(error)).toBe(false)
    expect(art.sent).toHaveLength(3)
    expect(waits).toHaveLength(2)
  })

  it('treats a 404 that is not NoSuchKey (a missing bucket, a bare NotFound) as transient', async () => {
    for (const name of ['NoSuchBucket', 'NotFound', 'UnknownError']) {
      const art = stubAws(() => {
        throw Object.assign(new Error('Not Found'), { name, $metadata: { httpStatusCode: 404 } })
      })
      const { waits, options } = quick()
      const store = s3Store(
        { client: art.client, bucket: 'art' },
        { client: art.client, bucket: 'render' },
        options,
      )
      const error = await store.load(ref).catch((thrown: unknown) => thrown)
      expect(isMissingObject(error)).toBe(false)
      expect(error).toMatchObject({ name })
      expect(art.sent).toHaveLength(3)
      expect(waits).toHaveLength(2)
    }
  })

  it('treats an access error as transient too, never as a missing object', async () => {
    const art = stubAws(() => {
      throw Object.assign(new Error('Access Denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      })
    })
    const { options } = quick()
    const store = s3Store(
      { client: art.client, bucket: 'art' },
      { client: art.client, bucket: 'render' },
      options,
    )
    const error = await store.load(ref).catch((thrown: unknown) => thrown)
    expect(isMissingObject(error)).toBe(false)
    expect(art.sent).toHaveLength(3)
  })

  it('throws for an empty answer, after the same tries', async () => {
    const empty = stubAws(() => ({}))
    const { options } = quick()
    const store = s3Store(
      { client: empty.client, bucket: 'art' },
      { client: empty.client, bucket: 'render' },
      options,
    )
    const error = await store.load(ref).catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ message: 'The object has no body.' })
    expect(isMissingObject(error)).toBe(false)
    expect(empty.sent).toHaveLength(3)
  })

  it('writes a collage to the render bucket as a PNG, never to the art bucket', async () => {
    const art = stubAws()
    const render = stubAws()
    const store = s3Store({ client: art.client, bucket: 'art' }, { client: render.client, bucket: 'render' })
    const key = `${COLLECTION_ID}/collage/${JOB_ID}.png`
    await store.putCollage(key, bytes('png'))
    expect(render.sent).toEqual([
      {
        name: PutObjectCommand.name,
        input: { Bucket: 'render', Key: key, Body: bytes('png'), ContentType: 'image/png' },
      },
    ])
    expect(art.sent).toEqual([])
  })

  it('refuses a key shaped like an upload or anything else', async () => {
    const render = stubAws()
    const store = s3Store(
      { client: render.client, bucket: 'art' },
      { client: render.client, bucket: 'render' },
    )
    for (const key of [
      `${COLLECTION_ID}/layers/${'a'.repeat(64)}.png`,
      `${COLLECTION_ID}/collage/../layers/x.png`,
      `collage/${JOB_ID}.png`,
      `${COLLECTION_ID}/collage/${JOB_ID}.gif`,
    ])
      await expect(store.putCollage(key, bytes('png'))).rejects.toThrow('A collage key is')
    expect(render.sent).toEqual([])
    expect(COLLAGE_KEY.test(`${COLLECTION_ID}/collage/${JOB_ID}.png`)).toBe(true)
  })
})
