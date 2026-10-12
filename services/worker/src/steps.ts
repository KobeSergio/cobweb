/**
 * The three steps, the dead-letter handler and the sweep
 * (docs/specs/2026-10-12-render-worker.md, section 7). Messages may arrive more than once and in
 * any order; every step is idempotent against the database, so a repeat does no harm.
 */
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'
import type { Log } from './log.ts'
import { isJobRefusal, isRenderProblem } from './ports.ts'
import type { Chain, Jobs, Pinner, Store } from './ports.ts'

export type Deps = { jobs: Jobs; store: Store; pinner: Pinner; chain: Chain; queue: RenderQueue; log: Log }

export const PAYMENT_MISMATCH = 'The payment could not be verified on chain.'
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

/**
 * Handles one message. Returns normally when the message is done or needs no work, and throws when
 * it should be redelivered. A `RenderProblem` (bad art) fails the job at once, since a rerun cannot
 * fix it; a refusal from the database is the job having moved on; anything else is transient.
 */
export async function handle(message: RenderMessage, deps: Deps): Promise<void> {
  try {
    if (message.step === 'start') await start(message, deps)
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
    deps.log('refused', {
      jobId: message.jobId,
      step: message.step,
      index: indexOf(message),
      refusal: error.code,
    })
  }
}
