import { availableChains } from '@cobweb/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PORT, servedChains } from './config.ts'

const FACTORY = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

describe('servedChains (docs/specs/2026-10-16-freshness-server.md, section 6.2)', () => {
  beforeEach(() => {
    // No chain variable from the shell leaks in: every chain starts unset.
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
    vi.stubEnv('RPC_URL_8453', 'https://base.example')
    vi.stubEnv('FACTORY_ADDRESS_1', FACTORY)
    vi.stubEnv('RPC_URL_46630', 'https://robinhood-testnet.example')
    vi.stubEnv('FACTORY_ADDRESS_46630', FACTORY)
    expect(servedChains().map((chain) => chain.id)).toEqual([46630, 31337])
  })

  it('limits the chains to the ids given', () => {
    vi.stubEnv('RPC_URL_31337', 'http://127.0.0.1:8545')
    vi.stubEnv('FACTORY_ADDRESS_31337', FACTORY)
    vi.stubEnv('RPC_URL_46630', 'https://robinhood-testnet.example')
    vi.stubEnv('FACTORY_ADDRESS_46630', FACTORY)
    expect(servedChains([31337]).map((chain) => chain.id)).toEqual([31337])
    expect(servedChains([999])).toEqual([])
  })

  it('serves a test chain under production only with COBWEB_TEST_CHAINS=1', () => {
    vi.stubEnv('RPC_URL_31337', 'http://127.0.0.1:8545')
    vi.stubEnv('FACTORY_ADDRESS_31337', FACTORY)
    vi.stubEnv('NODE_ENV', 'production')
    expect(servedChains()).toEqual([])
    vi.stubEnv('COBWEB_TEST_CHAINS', '1')
    expect(servedChains().map((chain) => chain.name)).toEqual(['Anvil'])
  })

  it('listens on 3100 when PORT is unset', () => {
    expect(DEFAULT_PORT).toBe(3100)
  })
})
