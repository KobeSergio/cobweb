/**
 * Fixture rows for the worker's tests: a small generative project (one art collection, three layers
 * with a blank), its images drawn with sharp, and the 1/1, single asset and placeholder variants.
 * Not exported from the package.
 */
import { flatPng } from '../doubles/draw.ts'
import type { BatchRecord, JobRecord, RenderData, TokenRows } from '../ports.ts'

export const JOB_ID = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'
export const COLLECTION_ID = '9a1b2c3d-0000-4000-8000-000000000001'
const ART_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

export const layerKey = (name: string) => `${COLLECTION_ID}/layers/${name}.png`
export const assetKey = (name: string, ext = 'png') => `${COLLECTION_ID}/assets/${name}.${ext}`
export const PLACEHOLDER_KEY = `${COLLECTION_ID}/placeholders/hidden.gif`

export function jobRecord(over: Partial<JobRecord> = {}): JobRecord {
  return {
    id: JOB_ID,
    collectionId: COLLECTION_ID,
    kind: 'real',
    state: 'paid',
    tokenCount: 5,
    batchSize: 2,
    batchesTotal: 3,
    batchesDone: 0,
    quoteTotalWei: 125n,
    quoteChainId: 31337,
    quotePayer: '0x00000000000000000000000000000000000000aa',
    quoteFactory: '0x00000000000000000000000000000000000000fa',
    onchainJobId: `0x3f0c2f5e8a514c0e9d7b0d0f5a3b9c11${'0'.repeat(32)}`,
    placeholderUploadId: null,
    retries: 0,
    errorCode: null,
    waived: false,
    paymentTxHash: `0x${'ab'.repeat(32)}`,
    ...over,
  }
}

/** Three layers bottom first: Background shown as "Scene", Eyes, and Hat with a blank "None". */
export function generativeData(over: Partial<JobRecord> = {}): RenderData {
  const layer = (id: string, name: string, position: number, displayName: string | null = null) => ({
    id,
    artCollectionId: ART_ID,
    name,
    displayName,
    position,
  })
  const trait = (id: string, layerId: string, name: string, position: number, uploadId: string | null) => ({
    id,
    layerId,
    name,
    blank: uploadId === null,
    inMetadata: true,
    uploadId,
    position,
  })
  return {
    job: jobRecord(over),
    collection: {
      id: COLLECTION_ID,
      name: 'Night Owls',
      description: 'Owls that stay up.',
      projectType: 'generative',
      canvasWidth: 64,
      tokenName: 'Owl',
      tokenDescription: 'A night owl.',
      showBlankTraits: false,
    },
    artCollections: [{ id: ART_ID, position: 0 }],
    // Listed out of order on purpose: the mapper sorts by position.
    layers: [layer('l-hat', 'Hat', 2), layer('l-bg', 'Background', 0, 'Scene'), layer('l-eyes', 'Eyes', 1)],
    traits: [
      trait('t-dusk', 'l-bg', 'Dusk', 1, 'u-dusk'),
      trait('t-ink', 'l-bg', 'Ink', 0, 'u-ink'),
      trait('t-wide', 'l-eyes', 'Wide', 0, 'u-wide'),
      trait('t-none', 'l-hat', 'None', 0, null),
      trait('t-cap', 'l-hat', 'Cap', 1, 'u-cap'),
    ],
    uploads: [
      { id: 'u-ink', storageKey: layerKey('ink') },
      { id: 'u-dusk', storageKey: layerKey('dusk') },
      { id: 'u-wide', storageKey: layerKey('wide') },
      { id: 'u-cap', storageKey: layerKey('cap') },
    ],
  }
}

/** Images for every key `generativeData` names, 64 by 64. */
export async function generativeImages(): Promise<Record<string, Uint8Array>> {
  return {
    [layerKey('ink')]: await flatPng({ r: 20, g: 20, b: 60, alpha: 1 }),
    [layerKey('dusk')]: await flatPng({ r: 200, g: 120, b: 60, alpha: 1 }),
    [layerKey('wide')]: await flatPng({ r: 255, g: 255, b: 0, alpha: 0.5 }),
    [layerKey('cap')]: await flatPng({ r: 255, g: 0, b: 0, alpha: 0.5 }),
  }
}

/** Five tokens: ids 1 to 5, alternating backgrounds, the cap on even ids. */
export function generativeRows(first: number, last: number): TokenRows {
  const rows = []
  for (let id = first; id <= last; id++)
    rows.push({
      tokenId: id,
      artCollectionId: ART_ID,
      dna: [id % 2 ? 't-ink' : 't-dusk', 't-wide', id % 2 ? 't-none' : 't-cap'],
      description: id === 3 ? 'The third owl.' : null,
    })
  return { kind: 'generative', rows }
}

/** A 1/1 project of three files (two PNGs and a GIF), one token each. */
export function assetData(over: Partial<JobRecord> = {}): RenderData {
  const base = generativeData({ tokenCount: 3, batchSize: 2, batchesTotal: 2, ...over })
  return {
    ...base,
    collection: { ...base.collection, projectType: 'one_of_one', canvasWidth: null },
    artCollections: [],
    layers: [],
    traits: [],
    uploads: [
      { id: 'u-one', storageKey: assetKey('one') },
      { id: 'u-two', storageKey: assetKey('two') },
      { id: 'u-three', storageKey: assetKey('three', 'gif') },
    ],
  }
}

export function assetRows(first: number, last: number): TokenRows {
  const uploads = ['u-one', 'u-two', 'u-three']
  const rows = []
  for (let id = first; id <= last; id++)
    rows.push({
      id,
      uploadId: uploads[id - 1] ?? 'u-missing',
      attributes: [{ traitType: 'Edition', value: String(id) }],
    })
  return { kind: 'assets', rows }
}

/** A minimal GIF header padded to the 12 bytes the library's sniffer needs. */
export const GIF_BYTES = new Uint8Array([...new TextEncoder().encode('GIF89a'), 1, 0, 1, 0, 0, 0, 0, 59])

/** A minimal MP4: a 12 byte box header, which is all the library's sniffer reads. */
export const MP4_BYTES = new Uint8Array([0, 0, 0, 12, ...new TextEncoder().encode('ftypisom')])

export async function assetImages(): Promise<Record<string, Uint8Array>> {
  return {
    [assetKey('one')]: await flatPng({ r: 10, g: 200, b: 10, alpha: 1 }),
    [assetKey('two')]: await flatPng({ r: 10, g: 10, b: 200, alpha: 1 }),
    [assetKey('three', 'gif')]: GIF_BYTES,
  }
}

/** A placeholder job on a deferred collection: one token, one batch, nothing to pay. */
export function placeholderData(over: Partial<JobRecord> = {}): RenderData {
  const base = generativeData({
    kind: 'placeholder',
    tokenCount: 1,
    batchSize: 1,
    batchesTotal: 1,
    quoteTotalWei: 0n,
    placeholderUploadId: 'u-hidden',
    ...over,
  })
  return {
    ...base,
    collection: { ...base.collection, canvasWidth: null },
    artCollections: [],
    layers: [],
    traits: [],
    uploads: [{ id: 'u-hidden', storageKey: PLACEHOLDER_KEY }],
  }
}

/** The batch rows `art_claim_render` seeds for a job. */
export function seedBatches(job: JobRecord): BatchRecord[] {
  return Array.from({ length: job.batchesTotal }, (_, index) => ({
    index,
    state: 'queued' as const,
    attempts: 0,
    firstTokenId: index * job.batchSize + 1,
    lastTokenId: Math.min((index + 1) * job.batchSize, job.tokenCount),
    imagesCid: null,
  }))
}
