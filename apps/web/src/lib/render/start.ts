import { enqueueRender, type RenderQueue } from '@cobweb/shared/render-queue'

/**
 * Sends a newly paid job's start message (docs/specs/2026-10-13-render-worker-vercel.md, section 7).
 * A failed send is logged with the job id and the error's name and swallowed: the payment is already
 * recorded, and the sweep starts the job within 15 minutes. The error's message is left out, because
 * it can carry a URL with a token in it.
 */
export async function startRender(
  queue: RenderQueue,
  jobId: string,
  log: (line: string) => void = console.error,
): Promise<void> {
  try {
    await enqueueRender(queue, { id: jobId, retries: 0 })
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Unknown error'
    log(`The render of job ${jobId} was not queued (${name}); the sweep will start it.`)
  }
}

/**
 * Starts a job the lock returned already `paid` or `waived`: a lock that owes nothing (a single asset,
 * a placeholder, or a collection whose fee is zero) is recorded as `paid` at once and has no payment
 * step to send its start message. Any other state sends nothing; a `payment_due` job is started when
 * its payment is recorded.
 */
export async function startIfReady(
  queue: RenderQueue,
  job: { id: string; state: string },
  log: (line: string) => void = console.error,
): Promise<void> {
  if (job.state === 'paid' || job.state === 'waived') await startRender(queue, job.id, log)
}
