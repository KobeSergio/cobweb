import { getAddress, type Address, type Hex } from 'viem'
import type { Enums } from '@/lib/database.types'
import type { MediaType, RenderJob, RenderJobBase, RenderPlaceholder } from '@/lib/demo/types'
import { servedUrl } from '@/lib/storage/uploads-service'

/** A render_jobs row as the lock core reads it (`JOB_COLUMNS`): the wei columns arrive as text. */
export type JobRow = {
  id: string
  collection_id: string
  kind: Enums<'render_kind'>
  state: Enums<'render_state'>
  token_count: number
  token_list_hash: string | null
  allow_duplicates: boolean
  fee_per_token_wei: string
  quote_total_wei: string
  quote_chain_id: number | null
  quote_payer: string | null
  quote_factory: string | null
  quote_expires_at: string | null
  payment_tx_hash: string | null
  paid_at: string | null
  paid_amount_wei: string | null
  batch_size: number
  batches_total: number
  batches_done: number
  metadata_cid: string | null
  /** What the contract gets: `ipfs://<cid>/`, or `ipfs://<cid>/metadata.json` for a single asset and the placeholder. */
  base_uri: string | null
  /** The placeholder's image directory; set on a placeholder job only. */
  placeholder_image_cid: string | null
  collage_key: string | null
  placeholder_upload_id: string | null
  onchain_job_id: string | null
  error: string | null
  error_code: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

/**
 * The select for a `JobRow`. PostgREST returns numeric as a JSON number, which rounds anything past
 * 2^53 wei; the casts keep every wei (Review Focus 3).
 */
export const JOB_COLUMNS =
  'id, collection_id, kind, state, token_count, token_list_hash, allow_duplicates, fee_per_token_wei::text, quote_total_wei::text, quote_chain_id, quote_payer, quote_factory, quote_expires_at, payment_tx_hash, paid_at, paid_amount_wei::text, batch_size, batches_total, batches_done, metadata_cid, base_uri, placeholder_image_cid, collage_key, placeholder_upload_id, onchain_job_id, error, error_code, created_at, started_at, finished_at'

/** A render_batches row as the lock core reads it (`BATCH_COLUMNS`). */
export type BatchRow = {
  index: number
  state: Enums<'batch_state'>
  attempts: number
  /** The batch directory's CID, once the batch is done. */
  images_cid: string | null
  /** The CAR size the worker uploaded, in bytes. */
  images_size: number | null
  error: string | null
  error_code: string | null
}

export const BATCH_COLUMNS = 'index, state, attempts, images_cid, images_size, error, error_code'

/** The placeholder file a job shows: its own for a placeholder job, the collection's latest for a real one. */
export type JobPlaceholder = { uploadId: string; mediaType: MediaType } | null

export const ZERO_HASH: Hex = `0x${'0'.repeat(64)}`
export const ZERO_ADDRESS: Address = `0x${'0'.repeat(40)}`

const seconds = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0)

function placeholderOf(placeholder: JobPlaceholder): RenderPlaceholder | null {
  return placeholder
    ? {
        cid: '',
        mediaType: placeholder.mediaType,
        imageUrl: servedUrl(placeholder.uploadId),
        uploadId: placeholder.uploadId,
      }
    : null
}

/** A render_jobs row as the Lock and upload screen's `RenderJob` (spec section 7). */
export function toRenderJob(
  row: JobRow,
  extra: { factory: Address | null; placeholder: JobPlaceholder },
): RenderJob {
  // The database trigger always sets the id; a null here would mean a row it never saw.
  if (row.onchain_job_id === null) throw new Error(`Render job ${row.id} has no on-chain job id.`)
  const base: RenderJobBase = {
    id: row.id,
    jobId: row.onchain_job_id as Hex,
    tokenCount: row.token_count,
    lockedAt: seconds(row.created_at),
    tokenListHash: (row.token_list_hash ?? ZERO_HASH) as Hex,
    quote: {
      chainId: row.quote_chain_id ?? 0,
      perTokenWei: row.fee_per_token_wei,
      tokenCount: row.token_count,
      totalWei: row.quote_total_wei,
      payer: (row.quote_payer ?? ZERO_ADDRESS) as Address,
      expiresAt: seconds(row.quote_expires_at),
      // The factory the quote was issued against; rows from before it was stored use the configured one.
      factory: row.quote_factory ? getAddress(row.quote_factory) : extra.factory,
    },
    lockOptions: { allowDuplicates: row.allow_duplicates },
    placeholder: placeholderOf(extra.placeholder),
  }
  const payment = row.payment_tx_hash
    ? {
        txHash: row.payment_tx_hash as Hex,
        paidAt: seconds(row.paid_at),
        amountWei: row.paid_amount_wei ?? '0',
      }
    : null
  const batches = { total: row.batches_total, done: row.batches_done, size: row.batch_size }
  const startedAt = seconds(row.started_at ?? row.paid_at)
  switch (row.state) {
    case 'locked':
      return { ...base, state: 'locked' }
    case 'payment_due':
      return { ...base, state: 'payment_due', payment }
    case 'paid':
    case 'waived':
      return { ...base, state: row.state, payment, batches }
    case 'failed':
      return { ...base, state: 'failed', payment, batches, error: row.error }
    case 'rendering':
      return { ...base, state: 'rendering', payment, batches, startedAt }
    case 'finalizing':
      return { ...base, state: 'finalizing', payment, batches, startedAt }
    case 'done':
      return {
        ...base,
        state: 'done',
        payment,
        batches,
        startedAt,
        finishedAt: seconds(row.finished_at),
        // render_jobs.images_cid is gone: each batch directory has its CID on its batch row.
        imagesCid: null,
        metadataCid: row.metadata_cid,
      }
  }
}

/** The screen's job before anything is locked: the review step, no quote yet. */
export function pendingJob(chainId: number | null, placeholder: JobPlaceholder): RenderJob {
  return {
    id: '',
    jobId: ZERO_HASH,
    tokenCount: 0,
    lockedAt: 0,
    tokenListHash: ZERO_HASH,
    quote: {
      chainId: chainId ?? 0,
      perTokenWei: '0',
      tokenCount: 0,
      totalWei: '0',
      payer: ZERO_ADDRESS,
      expiresAt: 0,
      factory: null,
    },
    lockOptions: { allowDuplicates: false },
    placeholder: placeholderOf(placeholder),
    state: 'locked',
  }
}

/** The fields every state shares, to build a job in another state from it (sample mode). */
export function jobBase(job: RenderJob): RenderJobBase {
  const { id, jobId, tokenCount, lockedAt, tokenListHash, quote, lockOptions, placeholder } = job
  return { id, jobId, tokenCount, lockedAt, tokenListHash, quote, lockOptions, placeholder }
}
