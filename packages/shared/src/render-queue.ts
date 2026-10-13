/**
 * The render queue contract (docs/specs/2026-10-12-render-worker.md, section 4): the message the web
 * app sends and the worker handles. This file imports nothing, so the web app can use it without the
 * worker's dependencies.
 */

export type RenderMessage =
  | { jobId: string; step: 'start'; retries: number }
  | { jobId: string; step: 'batch'; index: number; retries: number }
  | { jobId: string; step: 'metadata'; retries: number }

/**
 * Where messages go: SQS in production, an in-memory queue locally. `backlog` is how many messages
 * are waiting to be received; a queue that cannot tell leaves it out.
 */
export type RenderQueue = {
  send(messages: RenderMessage[]): Promise<void>
  backlog?: () => Promise<number>
}

/**
 * The `error_code` values only the worker writes (the others are render problem codes): the payment
 * could not be verified, the pinning service returned another CID, the message ran out of tries, the
 * files of one batch passed the worker's memory ceiling. All fit the column's 40 characters.
 */
export const WORKER_FAILURE_CODES = [
  'payment-mismatch',
  'cid-mismatch',
  'dead-letter',
  'batch-too-large',
] as const
export type WorkerFailureCode = (typeof WORKER_FAILURE_CODES)[number]

/**
 * The render problem codes (services/render/src/problems.ts) that bad art causes and a retry cannot
 * fix: the creator has to change the art. `empty-collage` is left out on purpose: it is thrown only
 * by the preview collage, whose failure the worker logs and skips, so it never fails a job.
 */
export const ART_PROBLEM_CODES = [
  'layer-size',
  'bad-dna',
  'missing-image',
  'batch-range',
  'missing-batch',
  'reserved-key',
  'duplicate-name',
  'decode',
  // The worker's own: the files of one batch passed its memory ceiling, and the same files come back.
  'batch-too-large',
] as const
export type ArtProblemCode = (typeof ART_PROBLEM_CODES)[number]

/** Where a job's preview collage lives in the render bucket: `<collection id>/collage/<job id>.png`. */
export const collageKey = (collectionId: string, jobId: string): string =>
  `${collectionId}/collage/${jobId}.png`

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

/** The Vercel Queues topic the render messages go to. */
export const RENDER_TOPIC = 'render'

/**
 * How long a sent message is kept: 7 days, the most Vercel allows, so a message waiting behind a long
 * queue never expires. The deduplication window is 24 hours whatever this is.
 */
export const RENDER_RETENTION_SECONDS = 604_800

/**
 * A message's idempotency key: `<jobId>:start:<retries>`, `<jobId>:batch:<index>:<retries>` or
 * `<jobId>:metadata:<retries>`. The queue drops a second message with the same key for 24 hours, so a
 * step that is rerun after a partial send, or a sweep that sends a start already sent, does no work
 * twice. A creator's retry raises `retries` and so gets new keys. Under 64 characters.
 */
export function messageKey(message: RenderMessage): string {
  if (message.step === 'batch') return `${message.jobId}:batch:${message.index}:${message.retries}`
  return `${message.jobId}:${message.step}:${message.retries}`
}
