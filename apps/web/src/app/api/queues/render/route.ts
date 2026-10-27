import { queueConsumer, retryAfter } from '@cobweb/worker'
import { handleCallback } from '@vercel/queue'
import { fetchByIdEnabled, namesAnotherQueue, withoutPushedMessage } from '@/lib/render/queue-request'
import { renderDeps } from '@/lib/render/worker'

/** A batch of 100 tokens at 2048 by 2048 takes minutes; Pro allows 800 seconds an invocation. */
export const maxDuration = 800

/**
 * The `render` topic's consumer (docs/specs/2026-10-13-render-worker-vercel.md, sections 6 and 7).
 * Vercel's queue infrastructure invokes it. The SDK checks no signature, and a request that carries a
 * receipt handle makes it run the handler on the body and delivery count the request brings. With
 * `RENDER_QUEUE_FETCH_BY_ID=1` the route removes both headers first (`withoutPushedMessage`), so the SDK
 * fetches the message by its id from the queue service with the project's credentials, which refuses an
 * id it does not hold. That is off by default: a genuine push already holds a lease, and a fetch by id
 * may answer 409 (`MessageLockedError`), which would fail every delivery. It is turned on only after the
 * positive probe in the worker README passes on a preview. With it off the route behaves as the SDK
 * does, and a made-up delivery still cannot dead-letter a job or burn a retry: failed deliveries are
 * counted on the database (`render_delivery_failures`), never read from the request. Either way a
 * request that names another topic (or, with the flag on, another consumer group) is answered 404.
 * A message is acknowledged when the handler returns and delivered again when it throws, after 120
 * seconds the first time and an hour after that; the third failed delivery fails the job with
 * `dead-letter` and is acknowledged.
 */
const callback = handleCallback(queueConsumer(renderDeps), {
  retry: (error) => retryAfter(error),
})

export function POST(request: Request): Promise<Response> {
  if (namesAnotherQueue(request)) return Promise.resolve(new Response(null, { status: 404 }))
  return Promise.resolve(callback(fetchByIdEnabled() ? withoutPushedMessage(request) : request))
}
