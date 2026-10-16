import 'server-only'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3, storageConfig } from './config.ts'

/** A PUT URL bound to the declared type and length, valid 15 minutes by default, on the art bucket unless another is named. */
export async function presignPut(
  key: string,
  mime: string,
  bytes: number,
  expiresSeconds = 900,
  options: { bucket?: string } = {},
): Promise<string> {
  const bucket = options.bucket ?? storageConfig().bucket
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime, ContentLength: bytes })
  // Signing content-type makes the type part of the URL, next to content-length and host.
  return getSignedUrl(s3(), command, {
    expiresIn: expiresSeconds,
    signableHeaders: new Set(['content-type']),
  })
}

/** A GET URL for one object, valid an hour by default, on the art bucket unless another is named. */
export async function presignGet(
  key: string,
  expiresSeconds = 3600,
  options: { bucket?: string } = {},
): Promise<string> {
  const bucket = options.bucket ?? storageConfig().bucket
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresSeconds })
}

/**
 * Size and type of a stored object, on the art bucket unless another is named. Null means "no object at
 * this key". A missing bucket also HEADs as 404, so a wrongly configured bucket looks like a missing object;
 * callers that treat null as "not uploaded yet" should know that.
 */
export async function headObject(
  key: string,
  options: { bucket?: string } = {},
): Promise<{ bytes: number; mime: string | null } | null> {
  const bucket = options.bucket ?? storageConfig().bucket
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { bytes: Number(head.ContentLength ?? 0), mime: head.ContentType ?? null }
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}

/** Deletes the objects, on the art bucket unless another is named. */
export async function deleteObjects(keys: string[], options: { bucket?: string } = {}): Promise<void> {
  if (keys.length === 0) return
  const bucket = options.bucket ?? storageConfig().bucket
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    const response = await s3().send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })) } }),
    )
    if (response.Errors?.length) {
      const failed = response.Errors.map((e) => `${e.Key ?? '?'} (${e.Code ?? 'unknown'})`).join(', ')
      throw new Error(`Storage refused to delete ${response.Errors.length} object(s): ${failed}.`)
    }
  }
}

/** The bucket's objects under a prefix with their last-modified time, a page of up to 1,000 at a time. */
export async function* listObjectPages(
  prefix: string,
): AsyncGenerator<{ key: string; lastModified: Date }[]> {
  const { bucket } = storageConfig()
  let token: string | undefined
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }),
    )
    yield (page.Contents ?? []).flatMap((entry) =>
      entry.Key && entry.LastModified ? [{ key: entry.Key, lastModified: entry.LastModified }] : [],
    )
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
}
