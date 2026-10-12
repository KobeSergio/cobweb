/**
 * The `Pinner` port on Filebase's S3-compatible API. The three values below (the endpoint, the
 * `import=car` object metadata that makes Filebase import a CAR, and `x-amz-meta-cid` as where the
 * CID comes back) come from Filebase's public documentation
 * (filebase.com/docs/ipfs/pinning/pinning-files). They are not verified against a live account: no
 * Filebase key exists on the development machine, so infra/README.md lists confirming them as the
 * first thing to do on a first deploy.
 */
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { CID } from 'multiformats/cid'
import type { Pinner } from '../ports.ts'
import type { S3Like } from './s3-store.ts'

/** Filebase's S3 endpoint (public documentation, not verified live); its region is `us-east-1`. */
export const FILEBASE_ENDPOINT = 'https://s3.filebase.com'
/** Object metadata (sent as `x-amz-meta-import: car`) that makes Filebase import the body as a CAR (public documentation, not verified live). */
export const FILEBASE_IMPORT_METADATA = { import: 'car' } as const
/** The object metadata key Filebase answers with (`x-amz-meta-cid`): the CAR's root CID (public documentation, not verified live). */
export const FILEBASE_CID_METADATA_KEY = 'cid'

/** How many times the CID is asked for after an upload, and the pause between asks. */
const HEAD_TRIES = 3
const HEAD_PAUSE_MS = 1000

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The CID as base32 CIDv1 text, the form the render library writes; a CIDv0 is converted first. */
function normalise(value: string): string {
  let cid: CID
  try {
    cid = CID.parse(value)
  } catch {
    throw new Error('The pinning service reported a value that is not a CID.')
  }
  return (cid.version === 0 ? cid.toV1() : cid).toString()
}

export function filebasePinner(
  client: S3Like,
  bucket: string,
  sleep: (ms: number) => Promise<void> = wait,
): Pinner {
  return {
    async pin(car, expectedCid) {
      const key = `${expectedCid}.car`
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: car,
          ContentType: 'application/vnd.ipld.car',
          Metadata: { ...FILEBASE_IMPORT_METADATA },
        }),
      )
      // The SDK does not expose PutObject's custom response headers, so the CID is read back. Filebase
      // may need a moment to import the CAR, so the read is repeated before the message is given back.
      for (let attempt = 1; attempt <= HEAD_TRIES; attempt += 1) {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        const cid = head.Metadata?.[FILEBASE_CID_METADATA_KEY]
        if (cid) return normalise(cid)
        if (attempt < HEAD_TRIES) await sleep(HEAD_PAUSE_MS)
      }
      throw new Error('The pinning service did not report a CID.')
    },
  }
}
