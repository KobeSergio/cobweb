import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/upload-sweep/route'

const mocks = vi.hoisted(() => ({
  sweepUploads:
    vi.fn<
      (
        deps: unknown,
        options: { dryRun: boolean; now: number; describe?: (error: unknown) => string },
      ) => Promise<unknown>
    >(),
  uploadSweepDeps: vi.fn<() => unknown>(() => ({ ports: 'uploads' })),
  log: vi.fn<(event: string, fields?: Record<string, unknown>) => void>(),
}))
vi.mock('@cobweb/worker', () => ({
  consoleLog: mocks.log,
  errorSummary: (error: unknown) => `${(error as Error).name}: [masked]`,
}))
vi.mock('@/lib/storage/sweep', async (original) => ({
  ...(await original<typeof import('@/lib/storage/sweep')>()),
  sweepUploads: mocks.sweepUploads,
}))
vi.mock('@/lib/storage/upload-sweep-deps', () => ({ uploadSweepDeps: mocks.uploadSweepDeps }))

const SECRET = 'cron-secret-value'
const request = (authorization?: string) =>
  new Request('https://cobweb.test/api/cron/upload-sweep', {
    headers: authorization === undefined ? {} : { authorization },
  })
const COUNTS = { listed: 4, old: 3, orphaned: 1, deleted: 0 }
const REPORT = { dryRun: true, art: COUNTS, media: COUNTS }

describe('GET /api/cron/upload-sweep (docs/specs/2026-10-17-production-hardening.md, section 14, point 8)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    vi.stubEnv('CRON_SECRET', SECRET)
    mocks.sweepUploads.mockReset()
    mocks.log.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('answers 404 and does not sweep without the secret', async () => {
    for (const header of [undefined, 'Bearer other-secret-value', SECRET])
      expect((await GET(request(header))).status).toBe(404)
    expect(mocks.sweepUploads).not.toHaveBeenCalled()
  })

  it('sweeps dry until UPLOAD_SWEEP_DELETE is 1, and answers the counts', async () => {
    mocks.sweepUploads.mockResolvedValue(REPORT)
    const response = await GET(request(`Bearer ${SECRET}`))
    expect([response.status, await response.json()]).toEqual([200, REPORT])
    expect(mocks.sweepUploads).toHaveBeenLastCalledWith(
      { ports: 'uploads' },
      { dryRun: true, now: 1_000_000, describe: expect.any(Function) },
    )
    vi.stubEnv('UPLOAD_SWEEP_DELETE', '1')
    await GET(request(`Bearer ${SECRET}`))
    expect(mocks.sweepUploads).toHaveBeenLastCalledWith(
      { ports: 'uploads' },
      { dryRun: false, now: 1_000_000, describe: expect.any(Function) },
    )
    expect(mocks.log).not.toHaveBeenCalled()
  })

  it('answers 500 with the report and logs both outcomes when a bucket fails, its error masked', async () => {
    const failed = { dryRun: true, art: { failed: 'Error: [masked]' }, media: COUNTS }
    mocks.sweepUploads.mockResolvedValue(failed)
    const response = await GET(request(`Bearer ${SECRET}`))
    expect([response.status, await response.json()]).toEqual([500, failed])
    expect(mocks.log).toHaveBeenCalledWith('upload sweep failed', {
      art: 'failed: Error: [masked]',
      media: '4 listed, 3 old, 1 orphaned, 0 deleted',
    })
    const describeError = mocks.sweepUploads.mock.lastCall?.[1].describe
    expect(describeError?.(new TypeError('https://storage.example/?key=abc'))).toBe('TypeError: [masked]')
  })

  it('answers 500 with an empty body and logs the masked error when the sweep throws', async () => {
    mocks.sweepUploads.mockRejectedValue(new Error('https://storage.example/?key=abc'))
    const response = await GET(request(`Bearer ${SECRET}`))
    expect([response.status, await response.text()]).toEqual([500, ''])
    expect(mocks.log).toHaveBeenCalledWith('upload sweep failed', { error: 'Error: [masked]' })
  })
})
