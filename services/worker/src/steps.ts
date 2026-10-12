/**
 * The three steps, the dead-letter handler and the sweep
 * (docs/specs/2026-10-12-render-worker.md, section 7). Messages may arrive more than once and in
 * any order; every step is idempotent against the database, so a repeat does no harm.
 */
import { renderBatch, renderPlaceholder } from '@cobweb/render'
import type { PackedDirectory } from '@cobweb/render'
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'
import type { Log } from './log.ts'
import { isJobRefusal, isRenderProblem } from './ports.ts'
import type { Chain, Jobs, Pinner, RefusalCode, Store } from './ports.ts'
import { renderSpec, tokenSlice } from './spec.ts'

export type Deps = { jobs: Jobs; store: Store; pinner: Pinner; chain: Chain; queue: RenderQueue; log: Log }

export const PAYMENT_MISMATCH = 'The payment could not be verified on chain.'
export const CID_MISMATCH = 'The pinning service returned a different CID.'
export const RESULT_DIFFERS = 'The render gave a different result than the one already recorded.'

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
    await deps.jobs.fail(message.jobId, index, code, text, true, message.retries)
    deps.log('job failed', { jobId: message.jobId, step: message.step, index, code })
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

/** Pins a CAR and compares CIDs. False (after recording `cid-mismatch`) when the service answers with another. */
async function pinned(deps: Deps, message: RenderMessage, packed: PackedDirectory): Promise<boolean> {
  const cid = await deps.pinner.pin(packed.car, packed.cid)
  if (cid === packed.cid) return true
  await report(deps, message, indexOf(message), 'cid-mismatch', CID_MISMATCH)
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
  // nothing to check. A read error throws out of here: the message is redelivered.
  if (job.state === 'paid' && job.quoteTotalWei > 0n) {
    const paid = await deps.chain.jobPayment(job)
    if (paid < job.quoteTotalWei) {
      await report(deps, message, null, 'payment-mismatch', PAYMENT_MISMATCH)
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
  if (!job) return
  let done = job.batchesDone
  if (started.state !== 'done') {
    const data = await jobs.renderData(job)
    const spec = renderSpec(data)
    // A placeholder job's one batch is the placeholder's image directory; its metadata is the metadata step's.
    const rendered =
      spec.kind === 'placeholder'
        ? (await renderPlaceholder(spec, store.load)).image
        : await renderBatch(spec, index, tokenSlice(data, await jobs.tokens(job, index)), store.load)
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
 * Handles one message. Returns normally when the message is done or needs no work, and throws when
 * it should be redelivered. A `RenderProblem` (bad art) fails the job at once, since a rerun cannot
 * fix it; a refusal from the database is the job having moved on; anything else is transient.
 */
export async function handle(message: RenderMessage, deps: Deps): Promise<void> {
  try {
    if (message.step === 'start') await start(message, deps)
    else if (message.step === 'batch') await batch(message, deps)
    else throw new Error(`The ${message.step} step is not built yet.`)
  } catch (error) {
    if (isRenderProblem(error)) {
      await report(deps, message, indexOf(message), error.code, error.message)
      return
    }
    if (!isJobRefusal(error)) throw error
    // The output was not the same twice. The batch named is already done under another CID and the
    // database refuses a failure that names a done batch, so this is recorded on the job.
    if (error.code === 'BATCH_RESULT_DIFFERS' || error.code === 'JOB_RESULT_DIFFERS') {
      await report(deps, message, null, 'cid-mismatch', RESULT_DIFFERS)
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
