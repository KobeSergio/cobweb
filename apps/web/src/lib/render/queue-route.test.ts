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
import { RENDER_CONSUMER_GROUP, RENDER_TOPIC, withoutPushedMessage } from '@/lib/render/queue-request'

const pushed = (headers: Record<string, string> = {}, body = '{"jobId":"j","step":"start","retries":0}') =>
  new Request('https://cobweb.test/api/queues/render', {
    method: 'POST',
    headers: {
      'ce-type': 'com.vercel.queue.v2beta',
      'ce-vqsqueuename': 'render',
      'ce-vqsconsumergroup': RENDER_CONSUMER_GROUP,
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

  it('hands the SDK the request as it came when the flag is unset or not 1', async () => {
    for (const value of [undefined, '0', 'true']) {
      vi.stubEnv('RENDER_QUEUE_FETCH_BY_ID', value as string)
      if (value === undefined) vi.unstubAllEnvs()
      mocks.seen.length = 0
      const request = pushed()
      await POST(request)
      expect(mocks.seen).toEqual([request])
      expect(mocks.seen[0]!.headers.get('ce-vqsreceipthandle')).toBe('forged-handle')
    }
    vi.unstubAllEnvs()
  })

  it('hands the SDK a request without the receipt handle and the delivery count when the flag is 1, read per request', async () => {
    mocks.seen.length = 0
    vi.stubEnv('RENDER_QUEUE_FETCH_BY_ID', '1')
    await POST(pushed())
    vi.unstubAllEnvs()
    expect(mocks.seen).toHaveLength(1)
    const seen = mocks.seen[0]!
    expect(seen.headers.has('ce-vqsreceipthandle')).toBe(false)
    expect(seen.headers.has('ce-vqsdeliverycount')).toBe(false)
    expect(seen.headers.get('ce-vqsmessageid')).toBe('msg_1')
    expect(seen.headers.get('ce-type')).toBe('com.vercel.queue.v2beta')
  })

  it('answers 404 before the SDK when the topic is another one, with the flag on or off', async () => {
    for (const flag of [undefined, '1']) {
      if (flag) vi.stubEnv('RENDER_QUEUE_FETCH_BY_ID', flag)
      mocks.seen.length = 0
      const response = await POST(pushed({ 'ce-vqsqueuename': 'other' }))
      expect(response.status).toBe(404)
      expect(mocks.seen).toEqual([])
      vi.unstubAllEnvs()
    }
  })

  it('answers 404 for another consumer group when the flag is on, and passes it through when off', async () => {
    mocks.seen.length = 0
    vi.stubEnv('RENDER_QUEUE_FETCH_BY_ID', '1')
    expect((await POST(pushed({ 'ce-vqsconsumergroup': 'other' }))).status).toBe(404)
    expect(mocks.seen).toEqual([])
    vi.unstubAllEnvs()
    await POST(pushed({ 'ce-vqsconsumergroup': 'other' }))
    expect(mocks.seen).toHaveLength(1)
  })

  it('passes the genuine topic and group, and a push that omits both headers, through', async () => {
    vi.stubEnv('RENDER_QUEUE_FETCH_BY_ID', '1')
    mocks.seen.length = 0
    await POST(pushed({ 'ce-vqsqueuename': RENDER_TOPIC, 'ce-vqsconsumergroup': RENDER_CONSUMER_GROUP }))
    const bare = new Request('https://cobweb.test/api/queues/render', { method: 'POST', body: '{}' })
    await POST(bare)
    vi.unstubAllEnvs()
    expect(mocks.seen).toHaveLength(2)
  })

  it('derives the consumer group from the route path in vercel.json as the SDK does', () => {
    const encode = (path: string) =>
      [...path]
        .map((c) =>
          c === '_'
            ? '__'
            : c === '/'
              ? '_S'
              : c === '.'
                ? '_D'
                : /[A-Za-z0-9-]/.test(c)
                  ? c
                  : `_${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
        )
        .join('')
    expect(RENDER_CONSUMER_GROUP).toBe(encode('src/app/api/queues/render/route.ts'))
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
