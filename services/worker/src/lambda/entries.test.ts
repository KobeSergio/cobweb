import { readFileSync } from 'node:fs'
import type { SQSEvent, SQSRecord } from 'aws-lambda'
import { describe, expect, it, vi } from 'vitest'
import { JobRefusal } from '../ports.ts'
import { harness } from '../testing/harness.ts'
import { JOB_ID } from '../testing/fixtures.ts'

// The entry points read their ports from loadDeps; the test hands them the fakes.
const built = vi.hoisted(() => ({ deps: null as unknown, loads: 0 }))
vi.mock('./deps.ts', () => ({
  loadDeps: async () => {
    built.loads += 1
    return built.deps
  },
}))

const record = (messageId: string, body: unknown): SQSRecord =>
  ({ messageId, body: JSON.stringify(body) }) as SQSRecord
const event = (...records: SQSRecord[]): SQSEvent => ({ Records: records })

describe('the dead-letter entry point', () => {
  it('fails the job and reports no batch item failure', async () => {
    const h = await harness()
    built.deps = h.deps
    const { handler } = await import('./dead.ts')
    const response = await handler(event(record('d1', { jobId: JOB_ID, step: 'metadata', retries: 0 })))
    expect(response).toEqual({ batchItemFailures: [] })
    expect(h.jobs.failures).toMatchObject([{ index: null, code: 'dead-letter', final: true }])
  })

  it('never reports a failure for a failure report the database refuses', async () => {
    const h = await harness()
    h.jobs.fail = async () => {
      throw new JobRefusal('JOB_NOT_RENDERING')
    }
    built.deps = h.deps
    const { handler } = await import('./dead.ts')
    const response = await handler(event(record('d1', { jobId: JOB_ID, step: 'metadata', retries: 0 })))
    expect(response).toEqual({ batchItemFailures: [] })
    expect(h.lines).toContain('failure report refused:JOB_NOT_RENDERING')
  })

  it('reports the message when the database cannot be reached, so it stays on the dead-letter queue', async () => {
    const h = await harness()
    h.jobs.fail = async () => {
      throw new Error('connection reset')
    }
    built.deps = h.deps
    const { handler } = await import('./dead.ts')
    const response = await handler(event(record('d1', { jobId: JOB_ID, step: 'metadata', retries: 0 })))
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'd1' }] })
  })
})

describe('the render entry point', () => {
  it('runs the start step and reports no failure', async () => {
    const h = await harness()
    built.deps = h.deps
    const { handler } = await import('./render.ts')
    const response = await handler(event(record('r1', { jobId: JOB_ID, step: 'start', retries: 0 })))
    expect(response).toEqual({ batchItemFailures: [] })
    expect(h.jobs.record.state).toBe('rendering')
    expect(h.queue.sent.map((message) => message.step)).toEqual(['batch', 'batch', 'batch'])
  })

  it('acknowledges a body that is not a render message', async () => {
    const h = await harness()
    built.deps = h.deps
    const { handler } = await import('./render.ts')
    expect(await handler(event(record('r1', { hello: 'world' })))).toEqual({ batchItemFailures: [] })
    expect(h.jobs.calls).toEqual([])
  })
})

describe('the sweep entry point', () => {
  it('sweeps with the production ports', async () => {
    const h = await harness()
    built.deps = h.deps
    const { handler } = await import('./sweep.ts')
    await expect(handler()).resolves.toBeUndefined()
    expect(h.jobs.calls).toContain('stuck')
  })
})

describe('the entry point sources', () => {
  it('log no event, error object, env value or URL of their own', () => {
    for (const file of ['handler.ts', 'render.ts', 'dead.ts', 'sweep.ts', 'deps.ts']) {
      const text = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
      expect(text, file).not.toMatch(/console\./)
      expect(text, file).not.toMatch(/JSON\.stringify|process\.env\.(?!RENDER_SECRET_ARN)/)
      for (const match of text.matchAll(/\berror:(?!\s*unknown)\s*([^,}\n]+)/g))
        expect(match[1], file).toMatch(/^errorSummary\(/)
    }
  })
})
