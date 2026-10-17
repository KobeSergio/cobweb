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

describe('startFreshness with the indexer (docs/specs/2026-10-17-production-hardening.md, section 8.1)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses options it cannot use before it listens, so a caller in process is never left with a listening server', async () => {
    const port = await freePort()
    for (const [indexer, sentence] of [
      [{ databaseUrl: 'http://127.0.0.1:55321' }, 'must be a postgres:// or postgresql:// connection string'],
      [{ databaseUrl: 'postgresql://cobweb_indexer@127.0.0.1:55322/postgres' }, 'has no password'],
      [
        { databaseUrl: 'postgresql://postgres:pw@127.0.0.1:55322/postgres' },
        'must connect as the cobweb_indexer role',
      ],
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

  it('listens with options it can use, connecting on the first call, and closes its connections', async () => {
    // Nothing listens on port 1: a pass would fail as NETWORK, and with no chain served none runs.
    const freshness = await startFreshness({
      port: 0,
      host: '127.0.0.1',
      chainIds: [],
      indexer: { databaseUrl: 'postgresql://cobweb_indexer:pw@127.0.0.1:1/postgres' },
    })
    const health = await fetch(`${freshness.url}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ status: 'ok', problems: [] })
    await freshness.close()
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('The indexer runs on no chain as cobweb_indexer.'),
    )
  })

  it('says the indexer is off without its database', async () => {
    const freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [] })
    await freshness.close()
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('The indexer is off: set INDEXER_DATABASE_URL to run it.'),
    )
  })
})
