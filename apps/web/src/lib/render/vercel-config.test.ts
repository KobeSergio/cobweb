import { existsSync, readFileSync } from 'node:fs'
import { RENDER_TOPIC } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'

const app = (path: string) => new URL(`../../../${path}`, import.meta.url)
const CONSUMER = 'src/app/api/queues/render/route.ts'
const SWEEP = 'src/app/api/cron/render-sweep/route.ts'
const SOURCE_SWEEP = 'src/app/api/cron/source-sweep/route.ts'
const UPLOAD_SWEEP = 'src/app/api/cron/upload-sweep/route.ts'

type VercelConfig = {
  regions: string[]
  functions: Record<string, { experimentalTriggers: Record<string, unknown>[] }>
  crons: { path: string; schedule: string }[]
}
const config = JSON.parse(readFileSync(app('vercel.json'), 'utf8')) as VercelConfig

describe('vercel.json', () => {
  it('runs in iad1', () => {
    expect(config.regions).toEqual(['iad1'])
  })

  it('triggers the consumer route from the render topic, at most 25 at once', () => {
    expect(Object.keys(config.functions)).toEqual([CONSUMER])
    expect(existsSync(app(CONSUMER))).toBe(true)
    expect(config.functions[CONSUMER]!.experimentalTriggers).toEqual([
      {
        type: 'queue/v2beta',
        topic: RENDER_TOPIC,
        retryAfterSeconds: 120,
        maxDeliveries: 10,
        maxConcurrency: 25,
      },
    ])
  })

  it('lets the consumer run for 800 seconds', () => {
    expect(readFileSync(app(CONSUMER), 'utf8')).toContain('export const maxDuration = 800')
  })

  it('runs the render sweep every 15 minutes and the source and upload sweeps daily, on routes that exist', () => {
    expect(config.crons).toEqual([
      { path: '/api/cron/render-sweep', schedule: '*/15 * * * *' },
      { path: '/api/cron/source-sweep', schedule: '30 7 * * *' },
      { path: '/api/cron/upload-sweep', schedule: '0 7 * * *' },
    ])
    expect(existsSync(app(SWEEP))).toBe(true)
    expect(existsSync(app(SOURCE_SWEEP))).toBe(true)
    expect(readFileSync(app(SOURCE_SWEEP), 'utf8')).toContain('export const maxDuration = 300')
    expect(readFileSync(app(UPLOAD_SWEEP), 'utf8')).toContain('export const maxDuration = 800')
  })
})

describe('next.config.ts', () => {
  it('transpiles the worker and the render library and keeps sharp out of the bundle', () => {
    expect(nextConfig.transpilePackages).toEqual(
      expect.arrayContaining(['@cobweb/worker', '@cobweb/render', '@cobweb/shared']),
    )
    expect(nextConfig.serverExternalPackages).toEqual(['sharp'])
  })
})
