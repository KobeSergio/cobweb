import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/render-sweep/route'

const mocks = vi.hoisted(() => ({
  sweep: vi.fn<(deps: unknown) => Promise<number>>(),
  workerDeps: vi.fn<(kind: string) => unknown>(() => ({ ports: 'jobs' })),
  log: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
}))
vi.mock('@cobweb/worker', () => ({
  sweep: mocks.sweep,
  consoleLog: mocks.log,
  errorSummary: (error: unknown) => `${(error as Error).name}: [masked]`,
}))
vi.mock('@/lib/render/worker', () => ({ workerDeps: mocks.workerDeps }))

const SECRET = 'cron-secret-value'
const request = (authorization?: string) =>
  new Request('https://cobweb.test/api/cron/render-sweep', {
    headers: authorization === undefined ? {} : { authorization },
  })

describe('GET /api/cron/render-sweep', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRET)
    mocks.sweep.mockReset()
    mocks.log.mockReset()
    mocks.workerDeps.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('answers 404 and does not sweep without the header or with another secret', async () => {
    for (const header of [undefined, 'Bearer other-secret-value', SECRET]) {
      const response = await GET(request(header))
      expect(response.status).toBe(404)
    }
    expect(mocks.sweep).not.toHaveBeenCalled()
  })

  it('answers 404 and does not sweep when CRON_SECRET is unset, even for a bare Bearer header', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request('Bearer '))).status).toBe(404)
    expect(mocks.sweep).not.toHaveBeenCalled()
  })

  it('sweeps with the jobs ports and answers with the count re-sent', async () => {
    mocks.sweep.mockResolvedValue(2)
    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ requeued: 2 })
    expect(mocks.workerDeps).toHaveBeenCalledWith('jobs')
  })

  it('answers 500 with an empty body and logs the masked error when the sweep throws', async () => {
    mocks.sweep.mockRejectedValue(new Error('https://db.example/?key=abc'))
    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
    expect(mocks.log).toHaveBeenCalledWith('sweep failed', { error: 'Error: [masked]' })
  })
})
