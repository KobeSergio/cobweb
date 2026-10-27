/**
 * The headers with which Vercel Queues pushes a message's body and its lease to a consumer. The queue
 * SDK trusts them: with a receipt handle it takes the body and the delivery count from the request and
 * runs the handler without asking the queue service. Anyone who can reach the route can send them.
 */
const PUSHED_MESSAGE_HEADERS = ['ce-vqsreceipthandle', 'ce-vqsdeliverycount'] as const

/**
 * The same request without the pushed lease. The SDK then fetches the message from the queue service by
 * its id with the project's own credentials, takes the lease from the answer and acknowledges that, so
 * an id the service does not hold fails there and never reaches the handler. The body stays: the SDK
 * reads it on the older structured callbacks.
 */
export function withoutPushedMessage(request: Request): Request {
  if (!PUSHED_MESSAGE_HEADERS.some((name) => request.headers.has(name))) return request
  const headers = new Headers(request.headers)
  for (const name of PUSHED_MESSAGE_HEADERS) headers.delete(name)
  return new Request(request, { headers })
}

/** The topic `apps/web/vercel.json` triggers this route for. */
export const RENDER_TOPIC = 'render'

/**
 * The consumer group of this route: the SDK names it from the route's file path as `vercel.json` gives it
 * (`filePathToConsumerGroup` in `@vercel/queue`: `_` doubles, `/` is `_S`, `.` is `_D`).
 */
export const RENDER_CONSUMER_GROUP = 'src_Sapp_Sapi_Squeues_Srender_Sroute_Dts'

/** True when the flag that turns the fetch-by-id strip on is set, read at request time. */
export function fetchByIdEnabled(): boolean {
  return process.env.RENDER_QUEUE_FETCH_BY_ID === '1'
}

/**
 * True when the request names another topic than `render` (always checked) or, with the fetch-by-id flag
 * on, another consumer group than this route's. A missing header passes: the caller chooses these two
 * headers, and the SDK would call the queue service with the project's token for whatever they name.
 * The group is checked with the flag because its name is derived from the file path and is confirmed
 * only by the preview probe; a wrong guess must not refuse genuine pushes.
 */
export function namesAnotherQueue(request: Request): boolean {
  const topic = request.headers.get('ce-vqsqueuename')
  if (topic !== null && topic !== RENDER_TOPIC) return true
  const group = request.headers.get('ce-vqsconsumergroup')
  return fetchByIdEnabled() && group !== null && group !== RENDER_CONSUMER_GROUP
}
