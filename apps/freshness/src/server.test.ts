import { createServer, type AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorLine } from './health.ts'
import { startFreshness } from './server.ts'

/** A port nothing listens on: one the system gave and took back. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise((resolve) => probe.close(resolve))
  return port
}

/** Whether a server can listen on the port, so that nothing else does; it closes again. */
async function isFree(port: number): Promise<boolean> {
  const probe = createServer()
  const listening = await new Promise<boolean>((resolve) => {
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => resolve(true))
  })
  if (listening) await new Promise((resolve) => probe.close(resolve))
  return listening
}

describe('startFreshness with the indexer (docs/specs/2026-10-16-indexer-overview.md, section 6.1)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses options it cannot use before it listens, so a caller in process is never left with a listening server', async () => {
    const port = await freePort()
    for (const [indexer, sentence] of [
      [{ supabaseUrl: 'not a url', serviceRoleKey: 'key' }, 'must be an http or https URL'],
      [{ supabaseUrl: 'http://127.0.0.1:54321/rest/v1', serviceRoleKey: 'key' }, 'with no path'],
      [{ supabaseUrl: '', serviceRoleKey: '' }, 'are both needed'],
    ] as const) {
      const refused = await startFreshness({ port, host: '127.0.0.1', chainIds: [], indexer }).then(
        () => null,
        (error: unknown) => error,
      )
      expect(errorLine(refused)).toContain(sentence)
      expect(await isFree(port)).toBe(true)
    }
    expect(console.log).not.toHaveBeenCalled()
  })

  it('listens with options it can use, the passes starting on each served chain, and closes', async () => {
    const freshness = await startFreshness({
      port: 0,
      host: '127.0.0.1',
      chainIds: [],
      indexer: { supabaseUrl: 'http://127.0.0.1:54321', serviceRoleKey: 'key' },
    })
    const health = await fetch(`${freshness.url}/health`)
    expect([health.status, ((await health.json()) as { status: string }).status]).toEqual([200, 'ok'])
    await freshness.close()
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('The indexer runs on no chain.'))
  })
})
