import { queueConsumer, retryAfter } from '@cobweb/worker'
import { handleCallback } from '@vercel/queue'
import { withoutPushedMessage } from '@/lib/render/queue-request'
import { renderDeps } from '@/lib/render/worker'

/** A batch of 100 tokens at 2048 by 2048 takes minutes; Pro allows 800 seconds an invocation. */
export const maxDuration = 800

/**
 * The `render` topic's consumer (docs/specs/2026-10-13-render-worker-vercel.md, sections 6 and 7).
 * Vercel's queue infrastructure invokes it. The SDK checks no signature, and a request that carries a
 * receipt handle makes it run the handler on the body and delivery count the request brings, so the
 * route removes both headers before the SDK sees the request (`withoutPushedMessage`). The SDK then
 * fetches the message by its id from the queue service with the project's credentials, which refuses an
 * id it does not hold, and acknowledges the lease that answer gives. The worker README's forged-callback
 * probe stays as the check that this holds on the platform. A message is acknowledged when the handler
 * returns and delivered again when it throws, after 120 seconds the first time and an hour after that.
 * Failed deliveries are counted on the database, not read from the request: the third failed delivery
 * fails the job with `dead-letter` and is acknowledged.
 */
const callback = handleCallback(queueConsumer(renderDeps), {
  retry: (error) => retryAfter(error),
})

export function POST(request: Request): Promise<Response> {
  return Promise.resolve(callback(withoutPushedMessage(request)))
}
