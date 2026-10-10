import { describe, expect, it } from 'vitest'
import { availableChains, chainById, factoryAddress, isLocalUrl, LAUNCH_CHAINS } from './chains.ts'
import { rpcUrl } from './rpc.ts'

const LAUNCH_IDS = [1, 42161, 8453, 80094, 143, 4663]

describe('the chain list', () => {
  it('names the six launch chains and adds Sepolia and Anvil outside production', () => {
    expect(LAUNCH_CHAINS.map((chain) => chain.id)).toEqual(LAUNCH_IDS)
    expect(availableChains(true).map((chain) => chain.id)).toEqual(LAUNCH_IDS)
    expect(availableChains(false).map((chain) => chain.id)).toEqual([...LAUNCH_IDS, 11155111, 31337])
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
