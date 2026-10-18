import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer, type AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorLine, type HealthBody } from './health.ts'
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

/** The server's /health body, the server started with `chainIds` and closed again. */
async function healthWith(chainIds: number[]): Promise<HealthBody> {
  const freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds })
  try {
    const response = await fetch(`${freshness.url}/health`)
    expect(response.status).toBe(200)
    return (await response.json()) as HealthBody
  } finally {
    await freshness.close()
  }
}

describe('/health with the indexer off (docs/specs/2026-10-17-production-hardening.md, section 8.2)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('RAILWAY_ENVIRONMENT', undefined)
    vi.stubEnv('NODE_ENV', 'test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('reads degraded on a hosted run, Railway or NODE_ENV=production, with the sentence the start line says', async () => {
    const hosted: Record<string, string>[] = [
      { RAILWAY_ENVIRONMENT: 'production' },
      { NODE_ENV: 'production' },
    ]
    for (const env of hosted) {
      vi.stubEnv('RAILWAY_ENVIRONMENT', undefined)
      vi.stubEnv('NODE_ENV', 'test')
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
      const body = await healthWith([])
      expect(body).toMatchObject({
        status: 'degraded',
        problems: ['The indexer is off: set INDEXER_DATABASE_URL to run it.'],
        hot: 0,
        chains: [],
      })
    }
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('The indexer is off: set INDEXER_DATABASE_URL to run it.'),
    )
  })

  it('reads ok on a local run, where the indexer is optional', async () => {
    expect(await healthWith([])).toMatchObject({ status: 'ok', problems: [] })
    vi.stubEnv('RAILWAY_ENVIRONMENT', ' ')
    expect(await healthWith([])).toMatchObject({ status: 'ok', problems: [] })
  })
})

describe('/health on a chain whose RPC refuses (docs/specs/2026-10-17-production-hardening.md, section 8.2)', () => {
  let rpc: Server
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // An RPC that refuses every request, as a provider refuses a key it does not know.
    rpc = createHttpServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'text/plain' })
      response.end('unauthorized')
    })
    await new Promise<void>((resolve) => rpc.listen(0, '127.0.0.1', resolve))
    vi.stubEnv('RAILWAY_ENVIRONMENT', undefined)
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('RPC_URL_31337', `http://127.0.0.1:${(rpc.address() as AddressInfo).port}`)
    vi.stubEnv('FACTORY_ADDRESS_31337', '0x5FbDB2315678afecb367f032d93F642f64180aa3')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await new Promise((resolve) => rpc.close(resolve))
  })

  it('answers 200 and degraded with a sentence once more than 10 state requests for unknown addresses found it refusing', async () => {
    const freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337] })
    try {
      const addresses = Array.from({ length: 11 }, (_, n) => `0x${(n + 1).toString(16).padStart(40, '0')}`)
      const answers = await Promise.all(
        addresses.map((address) => fetch(`${freshness.url}/v1/state/31337/${address}`)),
      )
      expect(answers.map((answer) => answer.status)).toEqual(Array<number>(11).fill(503))
      const response = await fetch(`${freshness.url}/health`)
      expect(response.status).toBe(200)
      const body = (await response.json()) as HealthBody
      expect(body.status).toBe('degraded')
      expect(body.problems).toEqual(['Anvil: 11 failed reads in 5 minutes (limit 10).'])
      expect(body.chains[0]).toMatchObject({ chainId: 31337, hot: 0, failedTicksRecent: 11 })
    } finally {
      await freshness.close()
    }
  })
})
