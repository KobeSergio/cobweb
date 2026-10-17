import { availableChains } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PORT, indexerOptionsOf, portOf, servedChains } from './config.ts'
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

describe('indexerOptionsOf (docs/specs/2026-10-16-indexer-overview.md, section 6.1)', () => {
  const URL = 'http://127.0.0.1:54321'
  const KEY = 'service-role-key-value'

  it('answers the options from both variables, and null from neither or from blanks', () => {
    expect(indexerOptionsOf({ SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: KEY })).toEqual({
      supabaseUrl: URL,
      serviceRoleKey: KEY,
    })
    expect(indexerOptionsOf({})).toBeNull()
    expect(indexerOptionsOf({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' })).toBeNull()
  })

  it('refuses one set alone with a sentence naming both variables, never a value', () => {
    for (const env of [
      { SUPABASE_URL: URL },
      { SUPABASE_SERVICE_ROLE_KEY: KEY },
      { SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: '' },
    ]) {
      const line = errorLine(thrownBy(() => indexerOptionsOf(env)))
      expect(line).toBe(
        'ConfigurationError: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both needed to run the indexer; set both or neither.',
      )
      expect(line).not.toContain(KEY)
    }
  })

  it('refuses a SUPABASE_URL that is not an http or https URL, naming the variable, never the value', () => {
    for (const supabaseUrl of [
      'localhost:54321',
      'ftp://127.0.0.1:54321',
      // The URL parser reads it as http://127.0.0.1:54321/, but supabase-js refuses it without the slashes.
      'http:127.0.0.1:54321',
      'http://',
      'not a url',
    ]) {
      const env = { SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: KEY }
      expect(errorLine(thrownBy(() => indexerOptionsOf(env)))).toBe(
        'ConfigurationError: SUPABASE_URL must be an http or https URL.',
      )
    }
    // A hosted project's URL, its scheme in any case.
    const hosted = 'HTTPS://abcdefghijklmnopqrst.supabase.co'
    expect(indexerOptionsOf({ SUPABASE_URL: hosted, SUPABASE_SERVICE_ROLE_KEY: KEY })).toEqual({
      supabaseUrl: hosted,
      serviceRoleKey: KEY,
    })
  })
})
