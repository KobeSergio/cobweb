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
