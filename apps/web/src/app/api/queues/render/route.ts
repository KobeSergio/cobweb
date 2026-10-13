import { queueConsumer, retryAfter } from '@cobweb/worker'
import { handleCallback } from '@vercel/queue'
import { renderDeps } from '@/lib/render/worker'

/** A batch of 100 tokens at 2048 by 2048 takes minutes; Pro allows 800 seconds an invocation. */
export const maxDuration = 800

/**
 * The `render` topic's consumer (docs/specs/2026-10-13-render-worker-vercel.md, sections 6 and 7).
 * Only Vercel's queue infrastructure invokes it. A message is acknowledged when the handler returns and
 * delivered again when it throws, after 120 seconds the first time and an hour after that; the third
 * failed delivery fails the job with `dead-letter` and is acknowledged.
 */
export const POST = handleCallback(queueConsumer(renderDeps), {
  retry: (_error, metadata) => retryAfter(metadata),
})
