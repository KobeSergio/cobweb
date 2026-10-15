import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  availableChains,
  chainById,
  confirmationsFor,
  factoryAddress,
  hasConfirmations,
  hidesTestChains,
  isLocalUrl,
  LAUNCH_CHAINS,
  TEST_CHAINS,
} from './chains.ts'
import { rpcUrl } from './rpc.ts'

const LAUNCH_IDS = [1, 42161, 8453, 80094, 143, 4663]

describe('the chain list', () => {
  it('names the six launch chains and adds Sepolia, Robinhood Chain Testnet and Anvil outside production', () => {
    expect(LAUNCH_CHAINS.map((chain) => chain.id)).toEqual(LAUNCH_IDS)
    expect(availableChains(true).map((chain) => chain.id)).toEqual(LAUNCH_IDS)
    expect(availableChains(false).map((chain) => chain.id)).toEqual([...LAUNCH_IDS, 11155111, 46630, 31337])
    expect(chainById(31337, true)).toBeUndefined()
    expect(chainById(31337, false)?.name).toBe('Anvil')
    expect(chainById(10, false)).toBeUndefined()
  })

  it('names the environment variables of each chain', () => {
    expect(chainById(8453, true)).toMatchObject({
      name: 'Base',
      nativeSymbol: 'ETH',
      rpcEnv: 'RPC_URL_8453',
      factoryEnv: 'FACTORY_ADDRESS_8453',
      testnet: false,
    })
    expect(chainById(80094, true)?.nativeSymbol).toBe('BERA')
    expect(chainById(31337, false)).toMatchObject({ explorerUrl: '', testnet: true })
  })

  it("lists Robinhood Chain Testnet among the test chains, with Robinhood Chain's 3 confirmations", () => {
    expect(TEST_CHAINS.map((chain) => chain.id)).toEqual([11155111, 46630, 31337])
    expect(chainById(46630, false)).toMatchObject({
      name: 'Robinhood Chain Testnet',
      nativeSymbol: 'ETH',
      explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
      rpcEnv: 'RPC_URL_46630',
      factoryEnv: 'FACTORY_ADDRESS_46630',
      testnet: true,
      confirmations: 3,
    })
    expect(chainById(46630, false)?.viem.contracts?.multicall3).toBeDefined()
    expect(chainById(46630, true)).toBeUndefined()
  })
})

describe('factoryAddress and rpcUrl', () => {
  const env = {
    FACTORY_ADDRESS_31337: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
    RPC_URL_31337: 'http://127.0.0.1:8545',
  }

  it('reads the variables and checksums the address', () => {
    expect(factoryAddress(31337, env, false)).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(rpcUrl(31337, env, false)).toBe('http://127.0.0.1:8545')
  })

  it('throws a sentence when a variable is unset, malformed, or the chain is not available', () => {
    expect(() => factoryAddress(8453, env, false)).toThrow(
      'The factory address for chain 8453 is not configured.',
    )
    expect(() => factoryAddress(31337, { FACTORY_ADDRESS_31337: 'nope' }, false)).toThrow(
      'The factory address for chain 31337 is not configured.',
    )
    expect(() => factoryAddress(31337, env, true)).toThrow(
      'The factory address for chain 31337 is not configured.',
    )
    expect(() => rpcUrl(10, env, false)).toThrow('The RPC URL for chain 10 is not configured.')
  })
})

describe('isLocalUrl', () => {
  it('accepts loopback hosts only', () => {
    expect(isLocalUrl('http://127.0.0.1:8545')).toBe(true)
    expect(isLocalUrl('http://localhost:54321')).toBe(true)
    expect(isLocalUrl('http://[::1]:8545')).toBe(true)
    expect(isLocalUrl('https://mainnet.example.com')).toBe(false)
    expect(isLocalUrl('not a url')).toBe(false)
  })
})

describe('confirmations', () => {
  it('asks Anvil for 1, Sepolia for 2 and every launch chain for at least 3', () => {
    expect(confirmationsFor(31337, false)).toBe(1)
    expect(confirmationsFor(11155111, false)).toBe(2)
    for (const chain of LAUNCH_CHAINS) expect(confirmationsFor(chain.id, true)).toBeGreaterThanOrEqual(3)
    expect(() => confirmationsFor(31337, true)).toThrow()
  })

  it('counts the receipt block as the first confirmation', () => {
    expect(hasConfirmations(10n, 10n, 1)).toBe(true)
    expect(hasConfirmations(10n, 10n, 3)).toBe(false)
    expect(hasConfirmations(10n, 12n, 3)).toBe(true)
    expect(hasConfirmations(10n, 11n, 3)).toBe(false)
  })
})

describe('the test-chain switch (docs/specs/2026-10-16-freshness-server.md, section 5.4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const ids = () => availableChains().map((chain) => chain.id)
  const env = {
    RPC_URL_46630: 'https://rpc.example',
    FACTORY_ADDRESS_46630: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
  }

  it('hides the test chains in production, and shows them anywhere else', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('COBWEB_TEST_CHAINS', undefined)
    expect(hidesTestChains()).toBe(true)
    expect(ids()).toEqual(LAUNCH_IDS)
    vi.stubEnv('NODE_ENV', 'development')
    expect(hidesTestChains()).toBe(false)
    expect(ids()).toEqual([...LAUNCH_IDS, 11155111, 46630, 31337])
  })

  it('shows them in production with COBWEB_TEST_CHAINS=1, to every reader that takes the default', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('COBWEB_TEST_CHAINS', '1')
    expect(hidesTestChains()).toBe(false)
    expect(ids()).toEqual([...LAUNCH_IDS, 11155111, 46630, 31337])
    expect(chainById(46630)?.name).toBe('Robinhood Chain Testnet')
    expect(confirmationsFor(31337)).toBe(1)
    expect(factoryAddress(46630, env)).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(rpcUrl(46630, env)).toBe('https://rpc.example')
  })

  it('takes no value but 1', () => {
    vi.stubEnv('NODE_ENV', 'production')
    for (const value of ['', '0', 'true', 'yes', ' 1', '01']) {
      vi.stubEnv('COBWEB_TEST_CHAINS', value)
      expect(hidesTestChains()).toBe(true)
      expect(chainById(31337)).toBeUndefined()
      expect(() => rpcUrl(46630, env)).toThrow('The RPC URL for chain 46630 is not configured.')
    }
  })
})
