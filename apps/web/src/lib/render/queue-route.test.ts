import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  options: undefined as { retry: (error: unknown, metadata: unknown) => unknown } | undefined,
}))
vi.mock('@vercel/queue', () => ({
  handleCallback: (_handler: unknown, options: { retry: (error: unknown, metadata: unknown) => unknown }) => {
    mocks.options = options
    return () => new Response(null)
  },
}))
vi.mock('@/lib/render/worker', () => ({ renderDeps: () => ({}) }))

import { maxDuration } from '@/app/api/queues/render/route'

describe('the render queue consumer route', () => {
  it('hands the SDK a retry that takes the error first and answers 120 seconds, then an hour', () => {
    const retry = mocks.options!.retry
    expect(retry(new Error('x'), { messageId: 'm', deliveryCount: 1 })).toEqual({ afterSeconds: 120 })
    expect(retry(new Error('x'), { messageId: 'm', deliveryCount: 2 })).toEqual({ afterSeconds: 3600 })
  })

  it('allows 800 seconds an invocation', () => {
    expect(maxDuration).toBe(800)
  })
})
