import 'server-only'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3, storageConfig } from './config.ts'

/** A PUT URL bound to the declared type and length, valid 15 minutes by default. */
export async function presignPut(
  key: string,
  mime: string,
  bytes: number,
  expiresSeconds = 900,
): Promise<string> {
  const { bucket } = storageConfig()
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime, ContentLength: bytes })
  return getSignedUrl(s3(), command, { expiresIn: expiresSeconds })
}

/** A GET URL for one object, valid an hour by default. */
export async function presignGet(key: string, expiresSeconds = 3600): Promise<string> {
  const { bucket } = storageConfig()
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresSeconds })
}

/**
 * Size and type of a stored object. Null means "no object at this key". A missing bucket also
 * HEADs as 404, so a wrongly configured bucket looks like a missing object; callers that treat
 * null as "not uploaded yet" should know that.
 */
export async function headObject(key: string): Promise<{ bytes: number; mime: string | null } | null> {
  const { bucket } = storageConfig()
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { bytes: Number(head.ContentLength ?? 0), mime: head.ContentType ?? null }
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const { bucket } = storageConfig()
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
