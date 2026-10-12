/**
 * The `Store` port on S3 (AWS in production, Supabase Storage locally). It reads layer images,
 * assets and placeholders from the art bucket and writes collages to the render bucket. There is no
 * way to write to the art bucket here, so the upload sweep can never see worker output.
 */
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import type { S3Client } from '@aws-sdk/client-s3'
import { MissingObject } from '../ports.ts'
import type { Store } from '../ports.ts'

export type S3Like = Pick<S3Client, 'send'>
export type Bucket = { client: S3Like; bucket: string }

/** `<collection id>/collage/<job id>.png`: never the shape of an upload key (`<id>/<folder>/<sha256>.<ext>`). */
export const COLLAGE_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/collage\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/

/** How many times one read is tried before its last error is thrown. */
export const LOAD_ATTEMPTS = 3
const RETRY_DELAY_MS = 200

/** True only when S3 answers that the key does not exist. Any other failure, 403 included, is not. */
function isNoSuchKey(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { name, $metadata } = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return name === 'NoSuchKey' || $metadata?.httpStatusCode === 404
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
          return await found.Body.transformToByteArray()
        } catch (error) {
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
