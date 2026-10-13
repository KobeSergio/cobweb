import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import { describe, expect, it } from 'vitest'
import { bytes, stubS3 } from '../testing/stub-s3.ts'
import { FILEBASE_CID_METADATA_KEY, filebasePinner } from './filebase.ts'

const DAG_PB = 0x70
const digest = await sha256.digest(bytes('some content'))
const V1 = CID.createV1(DAG_PB, digest).toString()
const V0 = CID.createV0(digest).toString()

/** A client whose head answers come from `heads`, one a call; the last one repeats. */
function withHeads(heads: (string | undefined)[]) {
  let head = 0
  return stubS3((name) => {
    if (name !== HeadObjectCommand.name) return {}
    const cid = heads[Math.min(head, heads.length - 1)]
    head += 1
    return { Metadata: cid === undefined ? {} : { [FILEBASE_CID_METADATA_KEY]: cid } }
  })
}

describe('filebasePinner', () => {
  const sleeps: number[] = []
  const sleep = async (ms: number) => void sleeps.push(ms)

  it('trims whitespace around the CID before reading it', async () => {
    const { client } = withHeads([`  ${V1}\n`])
    expect(await filebasePinner(client, 'cobweb-pins', sleep).pin(bytes('car'), 'bafyexpected')).toBe(V1)
  })

  it('treats a value of only whitespace as no CID yet', async () => {
    sleeps.length = 0
    const { client } = withHeads(['  ', V1])
    expect(await filebasePinner(client, 'cobweb-pins', sleep).pin(bytes('car'), 'bafyexpected')).toBe(V1)
    expect(sleeps).toEqual([1000])
  })

  it('uploads the CAR with the import metadata and returns the CID Filebase reports', async () => {
    sleeps.length = 0
    const { client, sent } = withHeads([V1])
    expect(await filebasePinner(client, 'cobweb-pins', sleep).pin(bytes('car'), 'bafyexpected')).toBe(V1)
    expect(sent).toEqual([
      {
        name: PutObjectCommand.name,
        input: {
          Bucket: 'cobweb-pins',
          Key: 'bafyexpected.car',
          Body: bytes('car'),
          ContentType: 'application/vnd.ipld.car',
          Metadata: { import: 'car' },
        },
      },
      { name: HeadObjectCommand.name, input: { Bucket: 'cobweb-pins', Key: 'bafyexpected.car' } },
    ])
    expect(sleeps).toEqual([])
  })

  it('asks again, one second apart, when the CID is absent the first two times', async () => {
    sleeps.length = 0
    const { client, sent } = withHeads([undefined, undefined, V1])
    expect(await filebasePinner(client, 'b', sleep).pin(bytes('car'), 'bafy')).toBe(V1)
    expect(sent.filter((call) => call.name === HeadObjectCommand.name)).toHaveLength(3)
    expect(sleeps).toEqual([1000, 1000])
  })

  it('throws after three heads when the CID never appears, so the message is redelivered', async () => {
    sleeps.length = 0
    const { client, sent } = withHeads([undefined])
    await expect(filebasePinner(client, 'b', sleep).pin(bytes('car'), 'bafy')).rejects.toThrow(
      'The pinning service did not report a CID.',
    )
    expect(sent.filter((call) => call.name === HeadObjectCommand.name)).toHaveLength(3)
    expect(sleeps).toEqual([1000, 1000])
  })

  it('writes a CIDv0 as the CIDv1 of the same multihash, so it equals the render library CID', async () => {
    const { client } = withHeads([V0])
    expect(V0.startsWith('Qm')).toBe(true)
    expect(await filebasePinner(client, 'b', sleep).pin(bytes('car'), 'bafy')).toBe(V1)
  })

  it('throws a value that is not a CID, so the message is redelivered', async () => {
    const { client } = withHeads(['not a cid'])
    await expect(filebasePinner(client, 'b', sleep).pin(bytes('car'), 'bafy')).rejects.toThrow(
      'The pinning service reported a value that is not a CID.',
    )
  })

  it('throws when the upload fails and does not ask for the CID', async () => {
    const { client, sent } = stubS3((name) => {
      if (name === PutObjectCommand.name) throw new Error('503')
      return {}
    })
    await expect(filebasePinner(client, 'b', sleep).pin(bytes('car'), 'bafy')).rejects.toThrow('503')
    expect(sent).toHaveLength(1)
  })
})
