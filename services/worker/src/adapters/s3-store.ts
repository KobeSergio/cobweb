/**
 * The `Store` port on S3 (AWS in production, Supabase Storage locally). It reads layer images,
 * assets and placeholders from the art bucket and writes collages to the render bucket. There is no
 * way to write to the art bucket here, so the upload sweep can never see worker output.
 */
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import type { S3Client } from '@aws-sdk/client-s3'
import { isObjectTooLarge, MissingObject, ObjectTooLarge } from '../ports.ts'
import type { Store } from '../ports.ts'

export type S3Like = Pick<S3Client, 'send'>
export type Bucket = { client: S3Like; bucket: string }

/**
 * `<collection id>/collage/<job id>.png`. This has the shape of an upload key (`<id>/<folder>/<name>.<ext>`);
 * what keeps the upload sweep away from collages is that they live in the render bucket, which the
 * sweep never lists.
 */
export const COLLAGE_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/collage\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/

/** The upload limit, 50 MiB (`uploads.bytes`): nothing larger is ever stored, so nothing larger is read. */
export const MAX_OBJECT_BYTES = 52_428_800

/** How many times one read is tried before its last error is thrown. */
export const LOAD_ATTEMPTS = 3
const RETRY_DELAY_MS = 200

/**
 * True only when S3 answers `NoSuchKey`. Any other failure is not, including a 404 with another name
 * (`NoSuchBucket`, a bare `NotFound`): a wrong bucket is a deployment fault, not a missing layer.
 */
function isNoSuchKey(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return (error as { name?: unknown }).name === 'NoSuchKey'
}

/** The body's bytes, read chunk by chunk when it streams, and abandoned once they pass the limit. */
async function readBounded(
  body: { transformToByteArray(): Promise<Uint8Array> } & Partial<AsyncIterable<Uint8Array>>,
  key: string,
): Promise<Uint8Array> {
  if (!(Symbol.asyncIterator in body)) {
    const all = await body.transformToByteArray()
    if (all.byteLength > MAX_OBJECT_BYTES) throw new ObjectTooLarge(key)
    return all
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength
    if (total > MAX_OBJECT_BYTES) throw new ObjectTooLarge(key)
    chunks.push(chunk)
  }
  const joined = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.byteLength
  }
  return joined
}

export function s3Store(
  art: Bucket,
  render: Bucket,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Store {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  return {
    async load(ref) {
      for (let attempt = 1; ; attempt++) {
        try {
          const found = await art.client.send(new GetObjectCommand({ Bucket: art.bucket, Key: ref.key }))
          if (!found.Body) throw new Error('The object has no body.')
          // Refused on the size S3 reports, before a byte is read, and again while a stream is read.
          if ((found.ContentLength ?? 0) > MAX_OBJECT_BYTES) throw new ObjectTooLarge(ref.key)
          return await readBounded(found.Body, ref.key)
        } catch (error) {
          // Certain and final, like a missing key: a retry reads the same object.
          if (isObjectTooLarge(error)) throw error
          // A missing key is certain and final. Everything else (a throttle, a reset, a timeout) is
          // tried again a few times and then thrown as it is, so the message is redelivered.
          if (isNoSuchKey(error)) throw new MissingObject(ref.key)
          if (attempt >= LOAD_ATTEMPTS) throw error
          await sleep(RETRY_DELAY_MS * attempt)
        }
      }
    },
    async putCollage(key, png) {
      if (!COLLAGE_KEY.test(key)) throw new Error('A collage key is <collection id>/collage/<job id>.png.')
      await render.client.send(
        new PutObjectCommand({ Bucket: render.bucket, Key: key, Body: png, ContentType: 'image/png' }),
      )
    },
  }
}
