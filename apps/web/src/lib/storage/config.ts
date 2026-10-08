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

let client: S3Client | null = null

/** One S3 client for the server process. */
export function s3(): S3Client {
  if (client) return client
  const { region, endpoint, forcePathStyle, credentials } = storageConfig()
  client = new S3Client({ region, endpoint, forcePathStyle, credentials })
  return client
}
