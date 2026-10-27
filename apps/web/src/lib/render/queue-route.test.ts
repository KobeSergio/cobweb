import { MessageFailed } from '@cobweb/worker'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  options: undefined as { retry: (error: unknown, metadata: unknown) => unknown } | undefined,
  seen: [] as Request[],
}))
vi.mock('@vercel/queue', () => ({
  handleCallback: (_handler: unknown, options: { retry: (error: unknown, metadata: unknown) => unknown }) => {
    mocks.options = options
    return (request: Request) => {
      mocks.seen.push(request)
      return new Response(null)
    }
  },
}))
vi.mock('@/lib/render/worker', () => ({ renderDeps: () => ({}) }))

import { maxDuration, POST } from '@/app/api/queues/render/route'
import { withoutPushedMessage } from '@/lib/render/queue-request'

const pushed = (headers: Record<string, string> = {}, body = '{"jobId":"j","step":"start","retries":0}') =>
  new Request('https://cobweb.test/api/queues/render', {
    method: 'POST',
    headers: {
      'ce-type': 'com.vercel.queue.v2beta',
      'ce-vqsqueuename': 'render',
      'ce-vqsconsumergroup': 'render',
      'ce-vqsmessageid': 'msg_1',
      'ce-vqsreceipthandle': 'forged-handle',
      'ce-vqsdeliverycount': '4',
      'content-type': 'application/json',
      ...headers,
    },
    body,
  })

describe('the render queue consumer route', () => {
  it('hands the SDK a retry that answers 120 seconds after a first failed delivery, then an hour', () => {
    const retry = mocks.options!.retry
    expect(retry(MessageFailed.from(new Error('x'), 1), {})).toEqual({ afterSeconds: 120 })
    expect(retry(MessageFailed.from(new Error('x'), 2), {})).toEqual({ afterSeconds: 3600 })
  })

  it('takes the wait from the failed deliveries the database counted, not from the metadata', () => {
    const retry = mocks.options!.retry
    expect(retry(MessageFailed.from(new Error('x'), 1), { deliveryCount: 9 })).toEqual({ afterSeconds: 120 })
    expect(retry(new Error('x'), { deliveryCount: 9 })).toEqual({ afterSeconds: 120 })
  })

  it('allows 800 seconds an invocation', () => {
    expect(maxDuration).toBe(800)
  })

  it('hands the SDK a request without the receipt handle and the delivery count, so it fetches the message by id', async () => {
    mocks.seen.length = 0
    await POST(pushed())
    expect(mocks.seen).toHaveLength(1)
    const seen = mocks.seen[0]!
    expect(seen.headers.has('ce-vqsreceipthandle')).toBe(false)
    expect(seen.headers.has('ce-vqsdeliverycount')).toBe(false)
    expect(seen.headers.get('ce-vqsmessageid')).toBe('msg_1')
    expect(seen.headers.get('ce-type')).toBe('com.vercel.queue.v2beta')
  })
})

describe('withoutPushedMessage', () => {
  it('removes the two headers whatever their case, and keeps the rest, the method, the url and the body', async () => {
    const stripped = withoutPushedMessage(pushed({ 'CE-VQSReceiptHandle': 'again' }))
    expect(stripped.headers.has('ce-vqsreceipthandle')).toBe(false)
    expect(stripped.headers.has('ce-vqsdeliverycount')).toBe(false)
    expect(stripped.headers.get('ce-vqsqueuename')).toBe('render')
    expect(stripped.headers.get('x-vercel-queue-prime')).toBeNull()
    expect(stripped.method).toBe('POST')
    expect(stripped.url).toBe('https://cobweb.test/api/queues/render')
    expect(await stripped.json()).toEqual({ jobId: 'j', step: 'start', retries: 0 })
  })

  it('returns a request that carries neither header as it is, the prime request of local development included', () => {
    const prime = new Request('http://localhost:3000/api/queues/render', {
      method: 'POST',
      headers: { 'x-vercel-queue-prime': '1', 'x-vercel-queue-prime-file': 'app/api/queues/render/route.ts' },
    })
    expect(withoutPushedMessage(prime)).toBe(prime)
  })
})
