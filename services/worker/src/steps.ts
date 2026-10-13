/**
 * The three steps, the dead-letter handler and the sweep
 * (docs/specs/2026-10-12-render-worker.md, section 7). Messages may arrive more than once and in
 * any order; every step is idempotent against the database, so a repeat does no harm.
 */
import {
  mapLimit,
  previewCollage,
  RenderProblem,
  renderBatch,
  renderMetadataSet,
  renderPlaceholder,
} from '@cobweb/render'
import type { AssetSpec, AssetToken, GenerativeSpec, GenerativeToken, PackedDirectory } from '@cobweb/render'
import { collageKey, enqueueRender, WORKER_FAILURE_CODES } from '@cobweb/shared/render-queue'
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'
import { errorSummary } from './log.ts'
import type { Log } from './log.ts'
import {
  BatchTooLarge,
  isBatchTooLarge,
  isJobRefusal,
  isMissingObject,
  isObjectTooLarge,
  isRenderProblem,
} from './ports.ts'
import type { Chain, JobRecord, Jobs, Pinner, RefusalCode, RenderData, Store } from './ports.ts'
import { renderSpec, tokenSlice } from './spec.ts'

/**
 * In-process retries of the two calls most likely to fail for a moment: the payment read and the
 * pin. `delaysMs` has one entry per retry; `sleep` is injected so tests never wait. Left out of
 * `Deps`, a call is tried once (the local runner and the unit tests).
 */
export type Retry = { delaysMs: readonly number[]; sleep: (ms: number) => Promise<void> }

/** About ten seconds in all: tries at 0, 1, 4 and 10 seconds. */
export const PRODUCTION_RETRY: Retry = {
  delaysMs: [1000, 3000, 6000],
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}

export type Deps = {
  jobs: Jobs
  store: Store
  pinner: Pinner
  chain: Chain
  queue: RenderQueue
  log: Log
  retry?: Retry
  /** The ceiling on the real bytes of one pass-through batch; tests lower it. */
  maxBatchBytes?: number
}

/**
 * Runs `call`, and when it throws tries again after each delay of `deps.retry`, then throws the last
 * error. A verdict is a return value (a wrong CID, a short payment), never a throw, so it is not
 * retried. The error is logged by name and masked line only.
 */
async function retried<T>(deps: Deps, what: string, call: () => Promise<T>): Promise<T> {
  const delays = deps.retry?.delaysMs ?? []
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (error) {
      const delay = delays[attempt]
      if (delay === undefined || !deps.retry) throw error
      deps.log('retrying', { what, attempt: attempt + 1, error: errorSummary(error) })
      await deps.retry.sleep(delay)
    }
  }
}

export const PAYMENT_MISMATCH = 'The payment could not be verified on chain.'
export const CID_MISMATCH = 'The pinning service returned a different CID.'
export const RESULT_DIFFERS = 'The render gave a different result than the one already recorded.'
export const DEAD_LETTER = 'The render did not finish after several tries.'
export const BATCH_TOO_LARGE =
  'This batch of files is larger than the worker can hold. Tell support about it.'
export const FILE_TOO_LARGE = 'A file is larger than the upload limit.'

/** How many tokens the collage shows, and so how many of batch 0 are composited again for it. */
const COLLAGE_TOKENS = 16
/** Batches whose tokens are read at once in the metadata step. */
const TOKEN_READS_IN_FLIGHT = 8

type Token = GenerativeToken | AssetToken

/** The codes only the worker writes, from the shared list the screen reads (spec, section 4). */
const [PAYMENT_MISMATCH_CODE, CID_MISMATCH_CODE, DEAD_LETTER_CODE, BATCH_TOO_LARGE_CODE] =
  WORKER_FAILURE_CODES

/** A message's batch index, or null for a job-level message. */
const indexOf = (message: RenderMessage): number | null => (message.step === 'batch' ? message.index : null)

/**
 * Records a final failure with the message's `retries`, so a report older than the creator's latest
 * retry is ignored by the database. A refusal of the report itself (the job moved on, the batch is
 * already done) is logged and not thrown: a message that cannot fail its job must not loop.
 */
async function report(
  deps: Deps,
  message: RenderMessage,
  index: number | null,
  code: string,
  text: string,
): Promise<void> {
  try {
    const job = await deps.jobs.fail(message.jobId, index, code, text, true, message.retries)
    // The state the database returned: a report it ignored as stale leaves the job as it was.
    deps.log('job failed', { jobId: message.jobId, step: message.step, index, code, state: job.state })
  } catch (error) {
    if (!isJobRefusal(error)) throw error
    deps.log('failure report refused', {
      jobId: message.jobId,
      step: message.step,
      code,
      refusal: error.code,
    })
  }
}

/** The refusals that only mean the job moved on or the message is a repeat. Any other is logged apart. */
const EXPECTED_REFUSALS: readonly RefusalCode[] = [
  'JOB_NOT_RENDERING',
  'JOB_NOT_READY',
  'NO_SUCH_BATCH',
  'BATCHES_STILL_RENDERING',
]

/**
 * The most bytes one pass-through batch (1/1 or single asset) may load, counted from what is really
 * read, not from the sizes the database holds: the lock sizes batches from `uploads.bytes`, a planning
 * number, to about 500 MB. A batch is held about 2.8 times over while it is packed, which the 4 GB
 * Performance instance takes at about 1.7 GB.
 */
export const MAX_BATCH_BYTES = 600_000_000

/**
 * A loader that adds up the bytes it has really returned, each distinct key once (editions of one
 * file load it once), and throws `BatchTooLarge` when the total passes `max`.
 */
export function boundedLoad(load: Store['load'], max: number): Store['load'] {
  const seen = new Set<string>()
  let total = 0
  return async (ref) => {
    const bytes = await load(ref)
    if (!seen.has(ref.key)) {
      seen.add(ref.key)
      total += bytes.byteLength
      if (total > max) throw new BatchTooLarge()
    }
    return bytes
  }
}

/**
 * Runs a render call with a loader that remembers a storage error that is not a `MissingObject`. The
 * render library turns every failed load into a `missing-image` problem; when one of those follows a
 * transient storage error, the remembered error is thrown instead, so the message is redelivered
 * and the job is not failed for art that is there.
 */
async function withStore<T>(store: Store, run: (load: Store['load']) => Promise<T>): Promise<T> {
  const transient: unknown[] = []
  const load: Store['load'] = async (ref) => {
    try {
      return await store.load(ref)
    } catch (error) {
      if (!isMissingObject(error)) transient.push(error)
      throw error
    }
  }
  try {
    return await run(load)
  } catch (error) {
    if (transient.length > 0 && isRenderProblem(error) && error.code === 'missing-image') {
      // A file above the upload limit is bad art a retry cannot fix; any other remembered error is a fault.
      if (transient.some(isObjectTooLarge)) throw new RenderProblem('decode', FILE_TOO_LARGE)
      const big = transient.find(isBatchTooLarge)
      if (big) throw big
      throw transient[0]
    }
    throw error
  }
}

/** Pins a CAR and compares CIDs. False (after recording `cid-mismatch`) when the service answers with another. */
async function pinned(deps: Deps, message: RenderMessage, packed: PackedDirectory): Promise<boolean> {
  const cid = await retried(deps, 'pin', () => deps.pinner.pin(packed.car, packed.cid))
  if (cid === packed.cid) return true
  await report(deps, message, indexOf(message), CID_MISMATCH_CODE, CID_MISMATCH)
  return false
}

async function start(message: RenderMessage, deps: Deps): Promise<void> {
  const { jobs, queue, log } = deps
  const job = await jobs.job(message.jobId)
  if (!job || job.state === 'done' || job.state === 'failed') {
    log('start skipped', { jobId: message.jobId, state: job?.state ?? 'missing' })
    return
  }
  // The payment is checked before the claim and fails closed. A waived job and a free one have
  // nothing to check. A read error that outlasts the in-process retries throws out of here and the
  // message is redelivered; a lagging node (PaymentUnproven) is such an error, never a verdict.
  if (job.state === 'paid' && !job.waived && job.quoteTotalWei > 0n) {
    const paid = await retried(deps, 'payment', () => deps.chain.jobPayment(job))
    if (paid < job.quoteTotalWei) {
      await report(deps, message, null, PAYMENT_MISMATCH_CODE, PAYMENT_MISMATCH)
      return
    }
  }
  const claimed = await jobs.claim(job.id)
  const batches = await jobs.batches(job.id)
  const open = batches.filter((batch) => batch.state !== 'done')
  if (open.length > 0) {
    await queue.send(
      open.map((batch) => ({ jobId: job.id, step: 'batch', index: batch.index, retries: claimed.retries })),
    )
  } else if (batches.length > 0) {
    await queue.send([{ jobId: job.id, step: 'metadata', retries: claimed.retries }])
  }
  log('start done', { jobId: job.id, state: claimed.state, open: open.length, batches: batches.length })
}

async function batch(message: RenderMessage & { step: 'batch' }, deps: Deps): Promise<void> {
  const { jobs, store, queue, log } = deps
  const { jobId, index } = message
  const started = await jobs.batchStart(jobId, index)
  const job = await jobs.job(jobId)
  if (!job) {
    log('job vanished', { jobId, index })
    return
  }
  let done = job.batchesDone
  if (started.state !== 'done') {
    const data = await jobs.renderData(job)
    const spec = renderSpec(data)
    // A placeholder job's one batch is the placeholder's image directory; its metadata is the metadata step's.
    // A pass-through batch (1/1, single asset) is bounded by the bytes it really loads.
    const bounded = spec.kind === 'one_of_one' || spec.kind === 'single_asset'
    let rendered: PackedDirectory
    const limited: Store = bounded
      ? { ...store, load: boundedLoad(store.load, deps.maxBatchBytes ?? MAX_BATCH_BYTES) }
      : store
    try {
      rendered = await withStore(limited, async (load) =>
        spec.kind === 'placeholder'
          ? (await renderPlaceholder(spec, load)).image
          : await renderBatch(spec, index, tokenSlice(data, await jobs.tokens(job, index)), load),
      )
    } catch (error) {
      // Final: a rerun reads the same files.
      if (!isBatchTooLarge(error)) throw error
      await report(deps, message, index, BATCH_TOO_LARGE_CODE, BATCH_TOO_LARGE)
      return
    }
    if (!(await pinned(deps, message, rendered))) return
    done = (await jobs.batchDone(jobId, index, rendered.cid, rendered.size)).batchesDone
    log('batch done', { jobId, index, cid: rendered.cid, size: rendered.size, done })
  } else {
    log('batch already done', { jobId, index })
  }
  // Sent whenever the count is full, whether or not this call made the flip, so a crash between the
  // flip and the send cannot strand the job. The metadata step ignores a job that is not finalizing.
  if (done === job.batchesTotal) await queue.send([{ jobId, step: 'metadata', retries: job.retries }])
}

/**
 * Every token of the job, read a batch at a time and kept only as the render library's token. Trait
 * and collection ids are shared between tokens, so the same text is kept once: a 100,000 token
 * generative job holds about 20 MB of tokens here, and the metadata set built from them (about 70 MB
 * of JSON, held about three times over while it is packed) peaks near 300 MB.
 */
async function allTokens(job: JobRecord, data: RenderData, jobs: Jobs, indexes: number[]): Promise<Token[]> {
  const seen = new Map<string, string>()
  const shared = (text: string): string => {
    const known = seen.get(text)
    if (known !== undefined) return known
    seen.set(text, text)
    return text
  }
  const slices = await mapLimit(indexes, TOKEN_READS_IN_FLIGHT, async (index) =>
    tokenSlice(data, await jobs.tokens(job, index)).map((token) =>
      'dna' in token
        ? { ...token, collectionId: shared(token.collectionId), dna: token.dna.map(shared) }
        : token,
    ),
  )
  return slices.flat()
}

/**
 * The preview collage: the first 16 tokens of batch 0 composited again (the worker keeps no batch
 * output), stills only, written to the render bucket. Any failure is logged and skipped; a collage
 * never fails a job.
 */
async function collage(
  job: JobRecord,
  data: RenderData,
  spec: GenerativeSpec | AssetSpec,
  deps: Deps,
): Promise<string | null> {
  try {
    // GIF and MP4 files are dropped here, before anything is read or packed: the collage cannot show them.
    const first = tokenSlice(data, await deps.jobs.tokens(job, 0))
      .sort((a, b) => a.id - b.id)
      .slice(0, COLLAGE_TOKENS)
      .filter((token) => !('image' in token) || (token.image.ext !== 'gif' && token.image.ext !== 'mp4'))
    if (first.length === 0) return null
    // With a batch size of 16, ids 1 to 16 are exactly batch 0, whatever the job's own batch size.
    const rendered = await renderBatch({ ...spec, batchSize: COLLAGE_TOKENS }, 0, first, deps.store.load)
    const stills = rendered.files
      .filter((file) => /\.(png|jpg|webp)$/.test(file.name))
      .sort((a, b) => Number.parseInt(a.name, 10) - Number.parseInt(b.name, 10))
      .map((file) => file.bytes)
    if (stills.length === 0) return null
    const key = collageKey(job.collectionId, job.id)
    await deps.store.putCollage(key, await previewCollage(stills))
    return key
  } catch (error) {
    deps.log('collage skipped', { jobId: job.id, error: errorSummary(error) })
    return null
  }
}

async function metadata(message: RenderMessage, deps: Deps): Promise<void> {
  const { jobs, store, log } = deps
  const job = await jobs.job(message.jobId)
  if (!job || job.state !== 'finalizing') {
    log('metadata skipped', { jobId: message.jobId, state: job?.state ?? 'missing' })
    return
  }
  // Fresh: the collection's text is not frozen by the lock, so one job's metadata comes from one read.
  const data = await jobs.renderData(job, { fresh: true })
  const spec = renderSpec(data)
  if (spec.kind === 'placeholder') {
    const { image, metadata: set } = await withStore(store, (load) => renderPlaceholder(spec, load))
    if (!(await pinned(deps, message, image)) || !(await pinned(deps, message, set))) return
    await jobs.finish(job.id, {
      metadataCid: set.cid,
      baseUri: set.baseUri,
      placeholderImageCid: image.cid,
      collageKey: null,
    })
    log('job done', { jobId: job.id, metadataCid: set.cid })
    return
  }
  const cids = new Map<number, string>()
  for (const row of await jobs.batches(job.id)) if (row.imagesCid) cids.set(row.index, row.imagesCid)
  // A single asset writes one file for token 1, so only batch 0 is read.
  const indexes = spec.kind === 'single_asset' ? [0] : Array.from({ length: job.batchesTotal }, (_, i) => i)
  const set = await renderMetadataSet(spec, await allTokens(job, data, jobs, indexes), cids)
  if (!(await pinned(deps, message, set))) return
  const collageKey = spec.kind === 'single_asset' ? null : await collage(job, data, spec, deps)
  await jobs.finish(job.id, {
    metadataCid: set.cid,
    baseUri: set.baseUri,
    placeholderImageCid: null,
    collageKey,
  })
  log('job done', { jobId: job.id, metadataCid: set.cid, collage: collageKey !== null })
}

/**
 * The sentence a creator reads for a render problem. A missing image is reported without its storage
 * key (a key is not for a creator); the key goes to the log line.
 */
function creatorText(problem: Error & { code: string }, message: RenderMessage, deps: Deps): string {
  if (problem.code !== 'missing-image') return problem.message
  const { tokenId, detail } = problem as { tokenId?: number; detail?: Record<string, string | number> }
  deps.log('image missing', {
    jobId: message.jobId,
    step: message.step,
    index: indexOf(message),
    tokenId: tokenId ?? null,
    key: typeof detail?.key === 'string' ? detail.key : null,
  })
  return tokenId === undefined ? 'An image file is missing.' : `Token ${tokenId}: an image file is missing.`
}

/**
 * Handles one message. Returns normally when the message is done or needs no work, and throws when
 * it should be redelivered. A `RenderProblem` (bad art) fails the job at once, since a rerun cannot
 * fix it; a refusal from the database is the job having moved on; anything else is transient.
 */
export async function handle(message: RenderMessage, deps: Deps): Promise<void> {
  try {
    if (message.step === 'start') await start(message, deps)
    else if (message.step === 'batch') await batch(message, deps)
    else await metadata(message, deps)
  } catch (error) {
    if (isRenderProblem(error)) {
      await report(deps, message, indexOf(message), error.code, creatorText(error, message, deps))
      return
    }
    if (!isJobRefusal(error)) throw error
    // The output was not the same twice. The batch named is already done under another CID and the
    // database refuses a failure that names a done batch, so this is recorded on the job.
    if (error.code === 'BATCH_RESULT_DIFFERS' || error.code === 'JOB_RESULT_DIFFERS') {
      await report(deps, message, null, CID_MISMATCH_CODE, RESULT_DIFFERS)
      return
    }
    // A refusal outside the expected set means the worker sent something the database never should
    // see; it is acknowledged all the same, but under its own event so it can be found.
    const expected = EXPECTED_REFUSALS.includes(error.code)
    deps.log(expected ? 'refused' : 'refused-unexpected', {
      jobId: message.jobId,
      step: message.step,
      index: indexOf(message),
      refusal: error.code,
      ...(expected ? {} : { sentence: error.message }),
    })
  }
}

/**
 * Fails the job of a message that was received three times without success. For a job that was never
 * claimed (a start message that ran out of deliveries) the database refuses the report: that is
 * logged and the message acknowledged, and the sweep sends the job's start message again.
 */
export async function handleDead(message: RenderMessage, deps: Deps): Promise<void> {
  await report(deps, message, indexOf(message), DEAD_LETTER_CODE, DEAD_LETTER)
}

/** How long a job may sit with nothing touched before the sweep sends its start message again. */
export const STUCK_MINUTES = 15

/**
 * Re-enqueues a start message for each job left `rendering` or `finalizing`, or left `paid` or
 * `waived` and never claimed, with nothing touched for 15 minutes. The start step then claims an
 * unclaimed job, re-sends the open batches of a `rendering` one, or sends `metadata` for a
 * `finalizing` one. The message carries the job's key (`messageKey`), so a start the queue already
 * took within the last day is dropped as a duplicate instead of being run twice.
 */
export async function sweep(deps: Deps): Promise<number> {
  const jobs = await deps.jobs.stuck(STUCK_MINUTES)
  for (const job of jobs) {
    await enqueueRender(deps.queue, job)
    // Only after the send went through: a failed send leaves the job eligible for the next sweep.
    // Without this a job is returned on every sweep until something updates its row.
    try {
      await deps.jobs.touch(job.id)
    } catch (error) {
      deps.log('touch failed', { jobId: job.id, error: errorSummary(error) })
    }
  }
  deps.log('sweep', { requeued: jobs.length })
  return jobs.length
}
