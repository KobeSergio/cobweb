import { describe, expect, it } from 'vitest'
import { JOB_COLUMNS, pendingJob, toRenderJob, ZERO_ADDRESS, type JobRow } from './render-job'

const JOB = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
const ONCHAIN = `0x0f4a0f3e2f5e4e3a9d1c1b2c3d4e5f60${'0'.repeat(32)}`
const FACTORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const PAYER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const TX = `0x${'ab'.repeat(32)}`
const at = (iso: string) => Date.parse(iso) / 1000

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
  quote_expires_at: '2026-10-10T10:00:00+00:00',
  payment_tx_hash: null,
  paid_at: null,
  paid_amount_wei: null,
  batch_size: 100,
  batches_total: 1,
  batches_done: 0,
  images_cid: null,
  metadata_cid: null,
  placeholder_upload_id: null,
  onchain_job_id: ONCHAIN,
  error: null,
  created_at: '2026-10-09T10:00:00+00:00',
  started_at: null,
  finished_at: null,
  ...overrides,
})

const extra = { factory: FACTORY, placeholder: null } as const

describe('toRenderJob', () => {
  it('maps a job waiting for payment, every wei kept exact (Review Focus 3)', () => {
    const job = toRenderJob(row(), extra)
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

  it('reads every numeric wei column as text', () => {
    for (const column of ['fee_per_token_wei::text', 'quote_total_wei::text', 'paid_amount_wei::text'])
      expect(JOB_COLUMNS).toContain(column)
  })

  it('maps paid with its payment, and waived or zero-quote paid without one', () => {
    const paid = toRenderJob(
      row({
        state: 'paid',
        payment_tx_hash: TX,
        paid_at: '2026-10-09T11:00:00+00:00',
        paid_amount_wei: '250000000000000001',
      }),
      extra,
    )
    expect(paid).toMatchObject({
      state: 'paid',
      payment: { txHash: TX, paidAt: at('2026-10-09T11:00:00Z'), amountWei: '250000000000000001' },
      batches: { total: 1, done: 0, size: 100 },
    })
    expect(toRenderJob(row({ state: 'waived' }), extra)).toMatchObject({ state: 'waived', payment: null })
    expect(toRenderJob(row({ state: 'paid', quote_total_wei: '0' }), extra)).toMatchObject({
      state: 'paid',
      payment: null,
    })
  })

  it('maps failed with its error, rendering with its start, done with its CIDs', () => {
    expect(toRenderJob(row({ state: 'failed', error: 'Batch 3 failed.' }), extra)).toMatchObject({
      state: 'failed',
      error: 'Batch 3 failed.',
    })
    expect(
      toRenderJob(row({ state: 'rendering', paid_at: '2026-10-09T11:00:00+00:00', batches_done: 1 }), extra),
    ).toMatchObject({ state: 'rendering', startedAt: at('2026-10-09T11:00:00Z'), batches: { done: 1 } })
    expect(
      toRenderJob(
        row({
          state: 'done',
          started_at: '2026-10-09T11:00:00+00:00',
          finished_at: '2026-10-09T11:30:00+00:00',
          images_cid: 'bafyimages',
          metadata_cid: 'bafymeta',
        }),
        extra,
      ),
    ).toMatchObject({
      state: 'done',
      finishedAt: at('2026-10-09T11:30:00Z'),
      imagesCid: 'bafyimages',
      metadataCid: 'bafymeta',
    })
  })

  it('serves the placeholder file through the app and keeps its upload id', () => {
    const job = toRenderJob(row({ kind: 'placeholder', state: 'paid' }), {
      factory: null,
      placeholder: { uploadId: 'u-1', mediaType: 'gif' },
    })
    expect(job.placeholder).toEqual({
      cid: '',
      mediaType: 'gif',
      imageUrl: '/api/uploads/u-1',
      uploadId: 'u-1',
    })
    expect(job.quote.factory).toBeNull()
  })
})

describe('pendingJob', () => {
  it('is a job with nothing locked yet, on the collection chain', () => {
    expect(pendingJob(8453, null)).toMatchObject({
      state: 'locked',
      tokenCount: 0,
      quote: { chainId: 8453, totalWei: '0', payer: ZERO_ADDRESS, factory: null },
      placeholder: null,
    })
    expect(pendingJob(null, null).quote.chainId).toBe(0)
  })
})
