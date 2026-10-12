/**
 * The render queue contract (docs/specs/2026-10-12-render-worker.md, section 4): the message the web
 * app sends and the worker handles. This file imports nothing, so the web app can use it without the
 * worker's dependencies.
 */

export type RenderMessage =
  | { jobId: string; step: 'start'; retries: number }
  | { jobId: string; step: 'batch'; index: number; retries: number }
  | { jobId: string; step: 'metadata'; retries: number }

/** Where messages go: SQS in production, an in-memory queue locally. */
export type RenderQueue = { send(messages: RenderMessage[]): Promise<void> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function hasExactly(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => own.includes(key))
}

/**
 * A queue message body as a `RenderMessage`, or null for anything that is not exactly one of the
 * three shapes: a lower-case uuid job id, non-negative whole numbers, no other key. The caller
 * acknowledges and logs a null; it is never retried.
 */
export function parseRenderMessage(body: string): RenderMessage | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const message = value as Record<string, unknown>
  const { jobId, step, retries, index } = message
  if (typeof jobId !== 'string' || !UUID.test(jobId) || !isCount(retries)) return null
  if (step === 'start' || step === 'metadata')
    return hasExactly(message, ['jobId', 'step', 'retries']) ? { jobId, step, retries } : null
  if (step === 'batch' && isCount(index))
    return hasExactly(message, ['jobId', 'step', 'index', 'retries']) ? { jobId, step, index, retries } : null
  return null
}

/**
 * Starts (or restarts) a job's render: one `start` message carrying the job's current `retries`.
 * The start step works out which batches are still open, so this is all a retry needs to send.
 */
export function enqueueRender(queue: RenderQueue, job: { id: string; retries: number }): Promise<void> {
  return queue.send([{ jobId: job.id, step: 'start', retries: job.retries }])
}
