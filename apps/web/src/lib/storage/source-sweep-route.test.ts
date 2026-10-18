import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/source-sweep/route'
import type { SourceSweepReport } from '@/lib/storage/source-sweep'

const mocks = vi.hoisted(() => ({
  sweepSources:
    vi.fn<
      (deps: unknown, options: { dryRun: boolean; describe?: (error: unknown) => string }) => Promise<unknown>
    >(),
  sourceSweepDeps: vi.fn<() => unknown>(() => ({ port: 'sources' })),
  log: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
  errorSummary: (error: unknown) => `${(error as Error).name}: [masked]`,
}))
vi.mock('@cobweb/worker', () => ({ consoleLog: mocks.log, errorSummary: mocks.errorSummary }))
vi.mock('@/lib/storage/source-sweep', async (original) => ({
  ...(await original<typeof import('@/lib/storage/source-sweep')>()),
  sweepSources: mocks.sweepSources,
}))
vi.mock('@/lib/storage/source-sweep-deps', () => ({ sourceSweepDeps: mocks.sourceSweepDeps }))

const SECRET = 'cron-secret-value'
const request = (authorization?: string) =>
  new Request('https://cobweb.test/api/cron/source-sweep', {
    headers: authorization === undefined ? {} : { authorization },
  })
const REPORT: SourceSweepReport = { dryRun: true, due: 1, deleted: 0, marked: 0, failed: [] }

describe('GET /api/cron/source-sweep (docs/specs/2026-10-17-production-hardening.md, section 7.2)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRET)
    mocks.sweepSources.mockReset()
    mocks.log.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('answers 404 and does not sweep without the secret', async () => {
    for (const header of [undefined, 'Bearer other-secret-value', SECRET])
      expect((await GET(request(header))).status).toBe(404)
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request('Bearer '))).status).toBe(404)
    expect(mocks.sweepSources).not.toHaveBeenCalled()
  })

  it("sweeps dry until SOURCE_SWEEP_DELETE is 1, words a collection's failure through the masked summary, and answers the report", async () => {
    mocks.sweepSources.mockResolvedValue(REPORT)
    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(REPORT)
    expect(mocks.sweepSources).toHaveBeenLastCalledWith(
      { port: 'sources' },
      { dryRun: true, describe: mocks.errorSummary },
    )
    vi.stubEnv('SOURCE_SWEEP_DELETE', '1')
    await GET(request(`Bearer ${SECRET}`))
    expect(mocks.sweepSources).toHaveBeenLastCalledWith(
      { port: 'sources' },
      { dryRun: false, describe: mocks.errorSummary },
    )
  })

  it('answers 500 with an empty body and logs the masked error when the sweep throws', async () => {
    mocks.sweepSources.mockRejectedValue(new Error('https://db.example/?key=abc'))
    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
    expect(mocks.log).toHaveBeenCalledWith('source sweep failed', { error: 'Error: [masked]' })
  })
})
