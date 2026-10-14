import { describe, expect, it, vi } from 'vitest'
import type { LockClient } from './lock-collection'
import {
  BATCH_COLUMNS,
  JOB_COLUMNS,
  MAX_RENDER_RETRIES,
  loadBatchRows,
  pendingJob,
  readsBatchRows,
  toRenderJob,
  ZERO_ADDRESS,
  type BatchRow,
  type JobRow,
} from './render-job'

const JOB = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
const ONCHAIN = `0x0f4a0f3e2f5e4e3a9d1c1b2c3d4e5f60${'0'.repeat(32)}`
const FACTORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const PAYER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const TX = `0x${'ab'.repeat(32)}`
const at = (iso: string) => Date.parse(iso) / 1000
const CID = (letter: string) => `bafybei${letter.repeat(52)}`

const row = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: JOB,
  collection_id: '1f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f61',
  kind: 'real',
  state: 'payment_due',
  token_count: 3,
  token_list_hash: `0x${'cd'.repeat(32)}`,
  allow_duplicates: true,
  fee_per_token_wei: '83333333333333334',
  quote_total_wei: '250000000000000001',
  quote_chain_id: 31337,
  quote_payer: PAYER,
  quote_factory: null,
  quote_expires_at: '2026-10-10T10:00:00+00:00',
  payment_tx_hash: null,
  paid_at: null,
  paid_amount_wei: null,
  batch_size: 100,
  batches_total: 1,
  batches_done: 0,
  metadata_cid: null,
  base_uri: null,
  placeholder_image_cid: null,
  collage_key: null,
  credit_job_id: null,
  placeholder_upload_id: null,
  onchain_job_id: ONCHAIN,
  error: null,
  error_code: null,
  retries: 0,
  created_at: '2026-10-09T10:00:00+00:00',
  started_at: null,
  finished_at: null,
  ...overrides,
})

const batch = (index: number, overrides: Partial<BatchRow> = {}): BatchRow => ({
  index,
  state: 'queued',
  attempts: 0,
  images_cid: null,
  images_size: null,
  error: null,
  error_code: null,
  ...overrides,
})

const done = (index: number, letter: string) => batch(index, { state: 'done', images_cid: CID(letter) })

const extra = { factory: FACTORY, placeholder: null } as const

describe('toRenderJob', () => {
  it('maps a job waiting for payment, every wei kept exact (Review Focus 3)', () => {
    const job = toRenderJob(row(), [], extra)
    expect(job).toMatchObject({
      id: JOB,
      state: 'payment_due',
      jobId: ONCHAIN,
      tokenCount: 3,
      lockedAt: at('2026-10-09T10:00:00Z'),
      lockOptions: { allowDuplicates: true },
      placeholder: null,
      quote: {
        chainId: 31337,
        perTokenWei: '83333333333333334',
        tokenCount: 3,
        totalWei: '250000000000000001',
        payer: PAYER,
        expiresAt: at('2026-10-10T10:00:00Z'),
        factory: FACTORY,
      },
    })
  })

  it('exposes the factory stored on the job, checksummed, and falls back to the configured one', () => {
    const stored = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512'
    expect(toRenderJob(row({ quote_factory: stored }), [], extra).quote.factory).toBe(
      '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    )
    expect(toRenderJob(row({ quote_factory: null }), [], extra).quote.factory).toBe(FACTORY)
    expect(
      toRenderJob(row({ quote_factory: null }), [], { ...extra, factory: null }).quote.factory,
    ).toBeNull()
  })

  it('reads every numeric wei column as text', () => {
    for (const column of ['fee_per_token_wei::text', 'quote_total_wei::text', 'paid_amount_wei::text'])
      expect(JOB_COLUMNS).toContain(column)
    expect(JOB_COLUMNS).toContain('quote_factory')
  })

  it('reads the new job columns and the batch columns, and no longer reads images_cid', () => {
    for (const column of [
      'base_uri',
      'placeholder_image_cid',
      'collage_key',
      'error_code',
      'retries',
      'credit_job_id',
    ])
      expect(JOB_COLUMNS).toContain(column)
    expect(JOB_COLUMNS).not.toContain('images_cid')
    expect(BATCH_COLUMNS).toBe('index, state, attempts, images_cid, images_size, error, error_code')
  })

  it('marks a job locked on a credit as credited, and every other job as not', () => {
    const credit = '7a1c0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f62'
    expect(toRenderJob(row({ state: 'waived', credit_job_id: credit }), [], extra)).toMatchObject({
      state: 'waived',
      credited: true,
      payment: null,
    })
    expect(toRenderJob(row(), [], extra).credited).toBe(false)
    expect(toRenderJob(row({ state: 'waived' }), [], extra).credited).toBe(false)
  })

  it('maps paid with its payment, and waived or zero-quote paid without one', () => {
    const paid = toRenderJob(
      row({
        state: 'paid',
        payment_tx_hash: TX,
        paid_at: '2026-10-09T11:00:00+00:00',
        paid_amount_wei: '250000000000000001',
      }),
      [],
      extra,
    )
    expect(paid).toMatchObject({
      state: 'paid',
      payment: { txHash: TX, paidAt: at('2026-10-09T11:00:00Z'), amountWei: '250000000000000001' },
      batches: { total: 1, done: 0, size: 100 },
    })
    expect(toRenderJob(row({ state: 'waived' }), [], extra)).toMatchObject({ state: 'waived', payment: null })
    expect(toRenderJob(row({ state: 'paid', quote_total_wei: '0' }), [], extra)).toMatchObject({
      state: 'paid',
      payment: null,
    })
  })

  it('maps rendering with its start and the lowest failed batch, 1-based, or null', () => {
    const rendering = row({
      state: 'rendering',
      paid_at: '2026-10-09T11:00:00+00:00',
      batch_size: 1,
      batches_total: 3,
      batches_done: 1,
    })
    expect(toRenderJob(rendering, [done(0, 'a'), batch(1), batch(2)], extra)).toMatchObject({
      state: 'rendering',
      startedAt: at('2026-10-09T11:00:00Z'),
      batches: { total: 3, done: 1, size: 1 },
      failedBatch: null,
    })
    const failing = [done(0, 'a'), batch(2, { state: 'failed' }), batch(1, { state: 'failed' })]
    expect(toRenderJob(rendering, failing, extra)).toMatchObject({ state: 'rendering', failedBatch: 2 })
  })

  it('maps finalizing with its batches and start', () => {
    expect(
      toRenderJob(
        row({ state: 'finalizing', started_at: '2026-10-09T11:00:00+00:00', batches_done: 1 }),
        [done(0, 'a')],
        extra,
      ),
    ).toMatchObject({
      state: 'finalizing',
      startedAt: at('2026-10-09T11:00:00Z'),
      batches: { total: 1, done: 1, size: 100 },
    })
  })

  it('maps a failed render as retryable, with its code and its failed batch', () => {
    const job = toRenderJob(
      row({ state: 'failed', error: 'A layer image is missing.', error_code: 'layer-missing' }),
      [batch(0, { state: 'failed', error: 'A layer image is missing.', error_code: 'layer-missing' })],
      extra,
    )
    expect(job).toMatchObject({
      state: 'failed',
      error: 'A layer image is missing.',
      errorCode: 'layer-missing',
      failedBatch: 1,
      retryable: true,
    })
  })

  it('allows a retry below the cap and refuses it at the cap, exposing the count', () => {
    expect(MAX_RENDER_RETRIES).toBe(5)
    const failed = (retries: number) => toRenderJob(row({ state: 'failed', error: 'x', retries }), [], extra)
    expect(failed(4)).toMatchObject({ retries: 4, retryable: true })
    expect(failed(5)).toMatchObject({ retries: 5, retryable: false })
  })

  it('does not allow a retry of a job failed with payment-mismatch', () => {
    const job = toRenderJob(row({ state: 'failed', error: 'x', error_code: 'payment-mismatch' }), [], extra)
    expect(job).toMatchObject({ errorCode: 'payment-mismatch', retryable: false })
    const other = toRenderJob(row({ state: 'failed', error: 'x', error_code: 'cid-mismatch' }), [], extra)
    expect(other).toMatchObject({ retryable: true })
  })

  it('maps a job cancelled by an unlock as failed and not retryable', () => {
    expect(toRenderJob(row({ state: 'failed', error: 'unlocked' }), [], extra)).toMatchObject({
      state: 'failed',
      error: 'unlocked',
      errorCode: null,
      failedBatch: null,
      retryable: false,
    })
  })

  it('does not allow a retry of a job whose error code marks an unlock, whatever its sentence says', () => {
    const marked = toRenderJob(
      row({ state: 'failed', error: 'The art was unlocked.', error_code: 'unlocked' }),
      [],
      extra,
    )
    expect(marked).toMatchObject({ errorCode: 'unlocked', retryable: false })
    const worker = toRenderJob(row({ state: 'failed', error: 'x', error_code: 'dead-letter' }), [], extra)
    expect(worker).toMatchObject({ retryable: true })
  })

  it('maps done with its base URI, its collage and the batch CIDs in batch order', () => {
    const job = toRenderJob(
      row({
        state: 'done',
        batch_size: 1,
        batches_total: 3,
        batches_done: 3,
        started_at: '2026-10-09T11:00:00+00:00',
        finished_at: '2026-10-09T11:30:00+00:00',
        metadata_cid: CID('m'),
        base_uri: `ipfs://${CID('m')}/`,
        collage_key: 'collages/x.webp',
      }),
      [done(2, 'c'), done(0, 'a'), done(1, 'b')],
      extra,
    )
    expect(job).toMatchObject({
      state: 'done',
      startedAt: at('2026-10-09T11:00:00Z'),
      finishedAt: at('2026-10-09T11:30:00Z'),
      metadataCid: CID('m'),
      baseUri: `ipfs://${CID('m')}/`,
      batchCids: [CID('a'), CID('b'), CID('c')],
      placeholderImageCid: null,
      collageKey: 'collages/x.webp',
    })
    expect(job).not.toHaveProperty('imagesCid')
  })

  it('refuses a done row without its metadata and base URI', () => {
    expect(() => toRenderJob(row({ state: 'done', metadata_cid: CID('m') }), [], extra)).toThrow(
      `Render job ${JOB} is done without its metadata.`,
    )
  })

  it('serves the placeholder file through the app, with its pinned CID once the placeholder job is done', () => {
    const placeholder = { uploadId: 'u-1', mediaType: 'gif' } as const
    const paid = toRenderJob(row({ kind: 'placeholder', state: 'paid' }), [], { factory: null, placeholder })
    expect(paid.placeholder).toEqual({
      cid: '',
      mediaType: 'gif',
      imageUrl: '/api/uploads/u-1',
      uploadId: 'u-1',
    })
    expect(paid.quote.factory).toBeNull()
    const finished = toRenderJob(
      row({
        kind: 'placeholder',
        state: 'done',
        metadata_cid: CID('q'),
        base_uri: `ipfs://${CID('q')}/metadata.json`,
        placeholder_image_cid: CID('p'),
        finished_at: '2026-10-09T11:30:00+00:00',
      }),
      [done(0, 'p')],
      { factory: null, placeholder },
    )
    expect(finished.placeholder?.cid).toBe(CID('p'))
    expect(finished).toMatchObject({
      state: 'done',
      placeholderImageCid: CID('p'),
      baseUri: `ipfs://${CID('q')}/metadata.json`,
    })
  })
})

describe('pendingJob', () => {
  it('is a job with nothing locked yet, on the collection chain', () => {
    expect(pendingJob(8453, null)).toMatchObject({
      state: 'locked',
      tokenCount: 0,
      quote: { chainId: 8453, totalWei: '0', payer: ZERO_ADDRESS, factory: null },
      placeholder: null,
      credited: false,
    })
    expect(pendingJob(null, null).quote.chainId).toBe(0)
  })
})

describe('the batch read', () => {
  it('reads batch rows only once a job has been claimed', () => {
    for (const state of ['rendering', 'finalizing', 'failed', 'done'] as const)
      expect(readsBatchRows(state)).toBe(true)
    for (const state of ['locked', 'payment_due', 'paid', 'waived'] as const)
      expect(readsBatchRows(state)).toBe(false)
  })

  it('is one select ordered by index and bounded to 1,000 rows, or no query at all', async () => {
    const range = vi.fn().mockResolvedValue({ data: [batch(0), batch(1)], error: null })
    const order = vi.fn(() => ({ range }))
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    const client = { from } as unknown as LockClient
    expect(await loadBatchRows(client, JOB, 'rendering')).toEqual([batch(0), batch(1)])
    expect(from).toHaveBeenCalledWith('render_batches')
    expect(select).toHaveBeenCalledWith(BATCH_COLUMNS)
    expect(eq).toHaveBeenCalledWith('job_id', JOB)
    expect(order).toHaveBeenCalledWith('index')
    expect(range).toHaveBeenCalledTimes(1)
    expect(range).toHaveBeenCalledWith(0, 999)
    from.mockClear()
    expect(await loadBatchRows(client, JOB, 'paid')).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('throws the database message when the read fails', async () => {
    const range = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range }) }) }) }),
    } as unknown as LockClient
    await expect(loadBatchRows(client, JOB, 'done')).rejects.toThrow('boom')
  })
})
