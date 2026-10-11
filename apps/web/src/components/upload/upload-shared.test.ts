import { describe, expect, it } from 'vitest'
import type { RenderJob } from '@/lib/demo/types'
import { resultOf } from './upload-shared'

type Done = Extract<RenderJob, { state: 'done' }>

const CID_A = `b${'a'.repeat(58)}`
const CID_B = `b${'b'.repeat(58)}`
const CID_M = `b${'m'.repeat(58)}`
const placeholder = { cid: CID_A, mediaType: 'image', imageUrl: '/p.png' }

/** Only the fields `resultOf` reads; the rest of a done job is irrelevant here. */
const done = (fields: Partial<Done>): Done =>
  ({
    state: 'done',
    metadataCid: CID_M,
    baseUri: `ipfs://${CID_M}/`,
    batchCids: [CID_B],
    placeholderImageCid: null,
    placeholder: null,
    ...fields,
  }) as unknown as Done

describe('resultOf', () => {
  it('shows the first batch directory and the metadata CID for a real job', () => {
    expect(resultOf(done({}))).toEqual({ imagesCid: CID_B, metadataCid: CID_M, placeholder: null })
  })

  it("shows a finished placeholder job's base URI, not the image directory CID", () => {
    const uri = `ipfs://${CID_M}/metadata.json`
    const result = resultOf(
      done({ baseUri: uri, placeholderImageCid: CID_A, batchCids: [CID_A], placeholder } as Partial<Done>),
    )
    expect(result).toMatchObject({ imagesCid: null, metadataCid: null, placeholderUri: uri })
    expect(result.placeholderUri).not.toContain(CID_A)
  })
})
