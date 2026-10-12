/**
 * The worker's ports (docs/specs/2026-10-12-render-worker.md, section 5). The steps depend on these
 * types only; each has a production adapter (src/adapters) and a local or test double (src/doubles).
 */
import type { ImageRef } from '@cobweb/render'

export type RenderState =
  'locked' | 'payment_due' | 'paid' | 'waived' | 'rendering' | 'finalizing' | 'done' | 'failed'

/** The `render_jobs` columns the worker reads. The token list is never part of it (it can be large). */
export type JobRecord = {
  id: string
  collectionId: string
  kind: 'real' | 'placeholder'
  state: RenderState
  tokenCount: number
  batchSize: number
  batchesTotal: number
  batchesDone: number
  /** `quote_total_wei`, read as text so no wei is lost. */
  quoteTotalWei: bigint
  quoteChainId: number | null
  quotePayer: string | null
  quoteFactory: string | null
  /** The factory's bytes32 job id (`render_jobs.onchain_job_id`). */
  onchainJobId: string
  placeholderUploadId: string | null
  /** How many times the creator retried the job; messages carry the value they were made with. */
  retries: number
  errorCode: string | null
  /** True when the job's state is `waived` or its `waived_by` column is set. Nothing to pay on chain. */
  waived: boolean
}

export type BatchRecord = {
  index: number
  state: 'queued' | 'running' | 'done' | 'failed'
  attempts: number
  firstTokenId: number
  lastTokenId: number
  imagesCid: string | null
}

export type FinishResult = {
  metadataCid: string
  baseUri: string
  placeholderImageCid: string | null
  collageKey: string | null
}

/** Everything the spec mapper needs besides the tokens, as plain rows. Frozen while the job is open. */
export type RenderData = {
  job: JobRecord
  collection: {
    id: string
    name: string
    description: string
    projectType: 'generative' | 'one_of_one' | 'single_asset'
    canvasWidth: number | null
    tokenName: string | null
    tokenDescription: string
    showBlankTraits: boolean
  }
  artCollections: { id: string; position: number }[]
  layers: {
    id: string
    artCollectionId: string
    name: string
    displayName: string | null
    position: number
  }[]
  traits: {
    id: string
    layerId: string
    name: string
    blank: boolean
    inMetadata: boolean
    uploadId: string | null
    position: number
  }[]
  uploads: { id: string; storageKey: string }[]
}

/** One batch's tokens as stored: `tokens` rows for generative, `render_jobs.token_list` entries otherwise. */
export type TokenRows =
  | {
      kind: 'generative'
      rows: { tokenId: number; artCollectionId: string; dna: string[]; description: string | null }[]
    }
  | { kind: 'assets'; rows: { id: number; uploadId: string; attributes: unknown }[] }

export type Jobs = {
  job(jobId: string): Promise<JobRecord | null>
  renderData(job: JobRecord): Promise<RenderData>
  tokens(job: JobRecord, index: number): Promise<TokenRows>
  batches(jobId: string): Promise<BatchRecord[]>
  claim(jobId: string): Promise<JobRecord>
  batchStart(jobId: string, index: number): Promise<BatchRecord>
  batchDone(
    jobId: string,
    index: number,
    cid: string,
    size: number,
  ): Promise<{ batchesDone: number; last: boolean }>
  fail(
    jobId: string,
    index: number | null,
    code: string,
    message: string,
    final: boolean,
    retries: number,
  ): Promise<JobRecord>
  finish(jobId: string, result: FinishResult): Promise<JobRecord>
  /**
   * Jobs in `rendering` or `finalizing`, and jobs in `paid` or `waived`, that nothing has touched for
   * this many minutes. A paid job whose start message ran out of deliveries is still unclaimed, and
   * the database refuses to fail an unclaimed job for anything but a payment mismatch, so only the
   * sweep can pick it up again.
   */
  stuck(olderThanMinutes: number): Promise<{ id: string; retries: number }[]>
}

export type Store = {
  /**
   * Reads one image. When the key does not exist it throws an error whose `name` is `MissingObject`
   * (a `MissingObject`); any other error is transient (the network, the service, a timeout) and the
   * message is redelivered rather than the job failed for bad art.
   */
  load(ref: ImageRef): Promise<Uint8Array>
  putCollage(key: string, png: Uint8Array): Promise<void>
}

/** The error `Store.load` throws for a key that does not exist. */
export class MissingObject extends Error {
  constructor(key: string) {
    super(`No object at ${key}`)
    this.name = 'MissingObject'
  }
}

/** Checked by name, not `instanceof`, like the other error checks here. */
export function isMissingObject(error: unknown): boolean {
  return error instanceof Error && error.name === 'MissingObject'
}

export type Pinner = { pin(car: Uint8Array, expectedCid: string): Promise<string> }
export type Chain = { jobPayment(job: JobRecord): Promise<bigint> }

/**
 * The sentences the job state functions refuse with (supabase/migrations/20261012010000_render_job_state.sql),
 * character for character. A test reads the migration and checks each one is raised there.
 */
export const SENTENCES = {
  JOB_NOT_READY: 'This job is not ready to render.',
  BATCH_COUNT_MISMATCH: 'The batch count does not match the token count.',
  JOB_NOT_RENDERING: 'This job is not rendering.',
  NO_SUCH_BATCH: 'There is no such batch.',
  BATCH_RESULT_DIFFERS: 'This batch was already recorded with a different result.',
  BATCH_ALREADY_DONE: 'This batch is already done.',
  JOB_RESULT_DIFFERS: 'This job was already finished with a different result.',
  BATCHES_STILL_RENDERING: 'This job has batches still rendering.',
  JOB_FAILURE_NEEDS_FINAL: 'A job-level failure must be final.',
} as const

export type RefusalCode = keyof typeof SENTENCES

/** A refusal from a job state function: the database said no, on purpose, with a known sentence. */
export class JobRefusal extends Error {
  code: RefusalCode

  constructor(code: RefusalCode) {
    super(SENTENCES[code])
    this.name = 'JobRefusal'
    this.code = code
  }
}

/** The refusal a database error stands for (errcode 23514 and a known sentence), or null for any other error. */
export function refusalOf(error: { code?: string; message?: string } | null | undefined): JobRefusal | null {
  if (!error || error.code !== '23514') return null
  const found = (Object.keys(SENTENCES) as RefusalCode[]).find((code) => SENTENCES[code] === error.message)
  return found ? new JobRefusal(found) : null
}

/** Checked by name, not `instanceof`: a bundle may hold more than one copy of a module. */
export function isJobRefusal(error: unknown): error is JobRefusal {
  return error instanceof Error && error.name === 'JobRefusal' && 'code' in error
}

/** A `RenderProblem` from `@cobweb/render`, checked by name for the same reason. */
export function isRenderProblem(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    error.name === 'RenderProblem' &&
    typeof (error as { code?: unknown }).code === 'string'
  )
}
