import 'server-only'
import { S3Client } from '@aws-sdk/client-s3'

/** The `ART_S3_*` variables, read once. Throws a plain sentence when one is missing. */
export function storageConfig() {
  const bucket = process.env.ART_S3_BUCKET
  const region = process.env.ART_S3_REGION
  const accessKeyId = process.env.ART_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.ART_S3_SECRET_ACCESS_KEY
  if (!bucket || !region || !accessKeyId || !secretAccessKey)
    throw new Error('Object storage is not configured: set the ART_S3_* variables.')
  return {
    bucket,
    region,
    endpoint: process.env.ART_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.ART_S3_FORCE_PATH_STYLE === '1',
    credentials: { accessKeyId, secretAccessKey },
  }
}

/**
 * A bucket named beside the art bucket, refused when it is the art bucket itself: the upload sweep deletes every
 * object there that no upload row records, so collages or mint page media kept in it would be emptied.
 */
function apartFromArt(bucket: string, variable: string): string {
  if (bucket === process.env.ART_S3_BUCKET)
    throw new Error(
      `Object storage is misconfigured: ${variable} names the art bucket, which the upload sweep empties. Give it a bucket of its own.`,
    )
  return bucket
}

/**
 * The bucket the render worker writes preview collages to (`RENDER_S3_BUCKET`), behind the same endpoint
 * and credentials as the art bucket (services/worker/src/env.ts). Never the art bucket itself: the upload
 * sweep deletes what no upload row records there.
 */
export function renderBucket(): string {
  const bucket = process.env.RENDER_S3_BUCKET
  if (!bucket) throw new Error('Object storage is not configured: set RENDER_S3_BUCKET.')
  return apartFromArt(bucket, 'RENDER_S3_BUCKET')
}

/**
 * The public bucket of the mint page's media (`MINT_PAGE_S3_BUCKET`, default `mint-page`), behind the same
 * endpoint and credentials as the art bucket (docs/specs/2026-10-16-mint-page-live-data.md, section 4.4). Never
 * the art bucket itself, for the same reason.
 */
export function mintPageBucket(): string {
  return apartFromArt(process.env.MINT_PAGE_S3_BUCKET || 'mint-page', 'MINT_PAGE_S3_BUCKET')
}

let client: S3Client | null = null

/** One S3 client for the server process. */
export function s3(): S3Client {
  if (client) return client
  const { region, endpoint, forcePathStyle, credentials } = storageConfig()
  client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials,
    // The SDK's default checksums would sign the CRC of an empty body into every presigned PUT URL, which AWS S3 rejects.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  return client
}
