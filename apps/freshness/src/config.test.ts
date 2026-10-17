import { availableChains } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkIndexerOptions,
  DEFAULT_PORT,
  indexerOptionsOf,
  portOf,
  servedChains,
  unreadIndexerVariables,
} from './config.ts'
import { errorLine } from './health.ts'

const FACTORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

/** What `fn` throws, or null when it does not. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn()
    return null
  } catch (error) {
    return error
  }
}

describe('servedChains (docs/specs/2026-10-16-freshness-server.md, section 6.2)', () => {
  beforeEach(() => {
    // Nothing from the shell leaks in: not production, no test-chain switch, and every chain unset.
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('COBWEB_TEST_CHAINS', undefined)
    for (const chain of availableChains(false)) {
      vi.stubEnv(chain.rpcEnv, undefined)
      vi.stubEnv(chain.factoryEnv, undefined)
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('serves each available chain whose RPC URL and factory are both set, in the list order', () => {
    vi.stubEnv('RPC_URL_31337', 'http://127.0.0.1:8545')
    vi.stubEnv('FACTORY_ADDRESS_31337', FACTORY)
    vi.stubEnv('RPC_URL_46630', 'https://robinhood-testnet.example')
    vi.stubEnv('FACTORY_ADDRESS_46630', FACTORY)
    vi.stubEnv('RPC_URL_8453', 'https://base.example')
    vi.stubEnv('FACTORY_ADDRESS_8453', FACTORY)
    // One of the two alone serves nothing.
    vi.stubEnv('RPC_URL_42161', 'https://arbitrum.example')
    vi.stubEnv('FACTORY_ADDRESS_1', FACTORY)
    expect(servedChains().map((chain) => chain.id)).toEqual([8453, 46630, 31337])
  })

  it('limits the chains to the ids given, in the list order', () => {
    vi.stubEnv('RPC_URL_31337', 'http://127.0.0.1:8545')
    vi.stubEnv('FACTORY_ADDRESS_31337', FACTORY)
    vi.stubEnv('RPC_URL_46630', 'https://robinhood-testnet.example')
    vi.stubEnv('FACTORY_ADDRESS_46630', FACTORY)
    expect(servedChains([31337]).map((chain) => chain.id)).toEqual([31337])
    expect(servedChains([31337, 46630]).map((chain) => chain.id)).toEqual([46630, 31337])
    expect(servedChains([999])).toEqual([])
  })

  it('reads a blank variable as unset', () => {
    vi.stubEnv('RPC_URL_1', '')
    vi.stubEnv('FACTORY_ADDRESS_1', FACTORY)
    vi.stubEnv('RPC_URL_8453', 'https://base.example')
    vi.stubEnv('FACTORY_ADDRESS_8453', '')
    expect(servedChains()).toEqual([])
  })

  it('serves a test chain under production only with COBWEB_TEST_CHAINS=1', () => {
    vi.stubEnv('RPC_URL_31337', 'http://127.0.0.1:8545')
    vi.stubEnv('FACTORY_ADDRESS_31337', FACTORY)
    vi.stubEnv('NODE_ENV', 'production')
    expect(servedChains()).toEqual([])
    vi.stubEnv('COBWEB_TEST_CHAINS', '1')
    expect(servedChains().map((chain) => chain.name)).toEqual(['Anvil'])
  })

  it('refuses to serve a chain whose factory is not an address, naming the variable and the chain, never the value', () => {
    vi.stubEnv('RPC_URL_31337', 'http://127.0.0.1:8545')
    vi.stubEnv('FACTORY_ADDRESS_31337', 'https://not-an-address.example')
    expect(errorLine(thrownBy(() => servedChains()))).toBe(
      'ConfigurationError: FACTORY_ADDRESS_31337 is not an address, so Anvil (31337) cannot be served.',
    )
    // A chain left out by the ids given is not read, so it is not refused either.
    expect(servedChains([1])).toEqual([])
    // A wrong checksum in mixed case is still an address, which the shared reader checksums.
    vi.stubEnv('FACTORY_ADDRESS_31337', '0x5fbDB2315678afecb367f032d93F642f64180aa3')
    expect(servedChains().map((chain) => chain.id)).toEqual([31337])
  })
})

describe('portOf (docs/specs/2026-10-16-freshness-server.md, section 6.2)', () => {
  it('defaults the port to 3100 when PORT is unset or blank', () => {
    expect(DEFAULT_PORT).toBe(3100)
    expect([portOf(undefined), portOf(''), portOf('4000')]).toEqual([3100, 3100, 4000])
  })
})

describe('indexerOptionsOf (docs/specs/2026-10-17-production-hardening.md, section 8.1)', () => {
  const PASSWORD = 's3cret-Pa55word'
  const LOCAL = `postgresql://cobweb_indexer:${PASSWORD}@127.0.0.1:55322/postgres`
  const POOLER = `postgres://cobweb_indexer.abcdefghijklmnopqrst:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`

  it('answers the options from a local URL or the session pooler, and null when unset or blank', () => {
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: LOCAL })).toEqual({ databaseUrl: LOCAL })
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: ` ${POOLER} ` })).toEqual({ databaseUrl: POOLER })
    expect(indexerOptionsOf({})).toBeNull()
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: '  ' })).toBeNull()
    // The old variables alone leave the indexer off.
    expect(
      indexerOptionsOf({ SUPABASE_URL: 'http://127.0.0.1:55321', SUPABASE_SERVICE_ROLE_KEY: 'key' }),
    ).toBeNull()
  })

  it('refuses each malformed URL with a sentence that carries no part of it', () => {
    const cases: [string, string][] = [
      ['https://127.0.0.1:55321', 'must be a postgres:// or postgresql:// connection string'],
      ['not a url', 'must be a postgres:// or postgresql:// connection string'],
      [
        `mysql://cobweb_indexer:${PASSWORD}@db.example:3306/postgres`,
        'must be a postgres:// or postgresql://',
      ],
      ['postgresql://cobweb_indexer@127.0.0.1:55322/postgres', 'has no password'],
      [
        `postgresql://postgres:${PASSWORD}@127.0.0.1:55322/postgres`,
        'must connect as the cobweb_indexer role',
      ],
      [
        `postgresql://service_role:${PASSWORD}@db.example:5432/postgres`,
        'must connect as the cobweb_indexer role',
      ],
      [
        `postgresql://cobweb_indexer_x:${PASSWORD}@db.example:5432/postgres`,
        'must connect as the cobweb_indexer role',
      ],
      [
        `postgresql://%E0%A4%A:${PASSWORD}@db.example:5432/postgres`,
        'must connect as the cobweb_indexer role',
      ],
    ]
    for (const [value, sentence] of cases) {
      const line = errorLine(thrownBy(() => indexerOptionsOf({ INDEXER_DATABASE_URL: value })))
      expect(line).toContain(`ConfigurationError: INDEXER_DATABASE_URL ${sentence}`)
      for (const part of [PASSWORD, '127.0.0.1', 'db.example', '55322', 'service_role', 'mysql', '%E0'])
        expect(line).not.toContain(part)
    }
  })

  it('refuses a connection string that asks for unverified TLS to another machine, and lets this machine use plain TCP', () => {
    for (const mode of ['verify-ca', 'verify-full'])
      expect(indexerOptionsOf({ INDEXER_DATABASE_URL: `${POOLER}?sslmode=${mode}` })).toEqual({
        databaseUrl: `${POOLER}?sslmode=${mode}`,
      })
    for (const weak of [
      'sslmode=require',
      'sslmode=prefer',
      'sslmode=allow',
      'sslmode=disable',
      'ssl=false',
    ]) {
      const line = errorLine(thrownBy(() => indexerOptionsOf({ INDEXER_DATABASE_URL: `${POOLER}?${weak}` })))
      expect(line).toBe(
        'ConfigurationError: INDEXER_DATABASE_URL must verify TLS for a database on another machine: leave sslmode out, or set it to verify-full.',
      )
      expect(line).not.toContain(PASSWORD)
    }
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: `${LOCAL}?sslmode=disable` })).toEqual({
      databaseUrl: `${LOCAL}?sslmode=disable`,
    })
  })

  it("takes the path of the database's CA certificate from INDEXER_DATABASE_SSL_CA when it is set", () => {
    const path = '/app/certs/supabase-ca.crt'
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: POOLER, INDEXER_DATABASE_SSL_CA: ` ${path} ` })).toEqual({
      databaseUrl: POOLER,
      sslCaFile: path,
    })
    expect(indexerOptionsOf({ INDEXER_DATABASE_URL: POOLER, INDEXER_DATABASE_SSL_CA: ' ' })).toEqual({
      databaseUrl: POOLER,
    })
  })

  it("checks a caller's options by the same rules, the passes' pace kept", () => {
    const options = { databaseUrl: LOCAL, targetsEveryMs: 1_000 }
    expect(checkIndexerOptions(options)).toBe(options)
    expect(errorLine(thrownBy(() => checkIndexerOptions({ databaseUrl: '' })))).toContain(
      'must be a postgres://',
    )
  })
})

describe('unreadIndexerVariables', () => {
  it('names the two old variables where they are still set', () => {
    expect(unreadIndexerVariables({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'key' })).toEqual([
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
    ])
    expect(unreadIndexerVariables({ SUPABASE_SERVICE_ROLE_KEY: 'key', SUPABASE_URL: ' ' })).toEqual([
      'SUPABASE_SERVICE_ROLE_KEY',
    ])
    expect(unreadIndexerVariables({ INDEXER_DATABASE_URL: 'postgres://x' })).toEqual([])
  })
})
