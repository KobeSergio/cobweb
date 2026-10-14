import { describe, expect, it } from 'vitest'
import type { RenderJob } from '@/lib/demo/types'
import { resultOf } from './upload-shared'

type Done = Extract<RenderJob, { state: 'done' }>

const CID_A = `b${'a'.repeat(58)}`
const CID_B = `b${'b'.repeat(58)}`
const CID_C = `b${'c'.repeat(58)}`
const CID_M = `b${'m'.repeat(58)}`
const placeholder = { cid: CID_A, mediaType: 'image', imageUrl: '/p.png' }

/** Only the fields `resultOf` reads; the rest of a done job is irrelevant here. */
const done = (fields: Partial<Done>): Done =>
  ({
    state: 'done',
    metadataCid: CID_M,
    baseUri: `ipfs://${CID_M}/`,
    batchCids: [CID_B, CID_C],
    placeholderImageCid: null,
    placeholder: null,
    collageKey: 'c/collage/j.png',
    ...fields,
  }) as unknown as Done

describe('resultOf', () => {
  it('lists every batch CID with the metadata CID, the base URI and the collage URL for a real job', () => {
    expect(resultOf(done({}), { collageUrl: '/api/collections/c/collage' })).toEqual({
      batchCids: [CID_B, CID_C],
      metadataCid: CID_M,
      baseUri: `ipfs://${CID_M}/`,
      collageUrl: '/api/collections/c/collage',
      placeholder: null,
    })
  })

  it('carries no collage when none is given', () => {
    expect(resultOf(done({ collageKey: null }), { collageUrl: null }).collageUrl).toBeNull()
  })

  it("shows a finished placeholder job's base URI, not the image directory CID, and no collage", () => {
    const uri = `ipfs://${CID_M}/metadata.json`
    const result = resultOf(
      done({ baseUri: uri, placeholderImageCid: CID_A, batchCids: [CID_A], placeholder } as Partial<Done>),
      { collageUrl: '/demo/collage.svg' },
    )
    expect(result).toEqual({
      batchCids: [],
      metadataCid: null,
      baseUri: null,
      collageUrl: null,
      placeholder,
      placeholderUri: uri,
    })
  })
})
