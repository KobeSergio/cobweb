import { enqueueRender, type RenderQueue } from '@cobweb/shared/render-queue'

/**
 * Sends a job's start message (docs/specs/2026-10-13-render-worker-vercel.md, section 7, and
 * 2026-10-14-render-screen-wiring.md, section 6) with the job's retry count: the message key is
 * `<jobId>:start:<retries>`, new for every retry, so a retry is never dropped as a duplicate of the first
 * start. A failed send is logged with the job id and the error's name and swallowed: the payment is
 * already recorded (or the retry already re-queued the batches), and the sweep starts the job within 15
 * minutes. The error's message is left out, because it can carry a URL with a token in it.
 */
export async function startRender(
  queue: RenderQueue,
  job: { id: string; retries: number },
  log: (line: string) => void = console.error,
): Promise<void> {
  try {
    await enqueueRender(queue, { id: job.id, retries: job.retries })
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Unknown error'
    log(`The render of job ${job.id} was not queued (${name}); the sweep will start it.`)
  }
}

/**
 * Starts a job the lock returned already `paid` or `waived`: a lock that owes nothing (a single asset,
 * a placeholder, a collection whose fee is zero, or a lock covered by a credit) has no payment step to
 * send its start message. A lock is always a fresh job, so it starts at retries 0. Any other state sends
 * nothing; a `payment_due` job is started when its payment is recorded.
 */
export async function startIfReady(
  queue: RenderQueue,
  job: { id: string; state: string },
  log: (line: string) => void = console.error,
): Promise<void> {
  if (job.state === 'paid' || job.state === 'waived')
    await startRender(queue, { id: job.id, retries: 0 }, log)
}
