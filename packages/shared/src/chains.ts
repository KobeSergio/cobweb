import { getAddress, isAddress, type Address } from 'viem'
import { anvil, arbitrum, base, berachain, mainnet, monad, robinhood, sepolia, type Chain } from 'viem/chains'

/**
 * The chains Cobweb runs on (CLAUDE.md, launch chains) plus Sepolia and a local Anvil chain outside
 * production. Each names the environment variables that configure it: `RPC_URL_<id>` (server only)
 * and `FACTORY_ADDRESS_<id>`. A chain is ready for payments when both are set.
 */
export type ChainConfig = {
  id: number
  name: string
  nativeSymbol: string
  /** Block explorer root, or '' where there is none (Anvil). */
  explorerUrl: string
  rpcEnv: string
  factoryEnv: string
  testnet: boolean
  /** Blocks (the receipt's own included) a payment must be buried under before it is recorded. */
  confirmations: number
  viem: Chain
}

export type Env = Record<string, string | undefined>

function entry(chain: Chain, name: string, testnet: boolean, confirmations: number): ChainConfig {
  return {
    id: chain.id,
    name,
    nativeSymbol: chain.nativeCurrency.symbol,
    explorerUrl: chain.blockExplorers?.default.url ?? '',
    rpcEnv: `RPC_URL_${chain.id}`,
    factoryEnv: `FACTORY_ADDRESS_${chain.id}`,
    testnet,
    confirmations,
    viem: chain,
  }
}

export const LAUNCH_CHAINS: readonly ChainConfig[] = [
  entry(mainnet, 'Ethereum', false, 5),
  entry(arbitrum, 'Arbitrum', false, 3),
  entry(base, 'Base', false, 3),
  entry(berachain, 'Berachain', false, 3),
  entry(monad, 'Monad', false, 3),
  entry(robinhood, 'Robinhood Chain', false, 3),
]

export const TEST_CHAINS: readonly ChainConfig[] = [
  entry(sepolia, 'Sepolia', true, 2),
  entry(anvil, 'Anvil', true, 1),
]

export const isProduction = () => process.env.NODE_ENV === 'production'

export function availableChains(production = isProduction()): readonly ChainConfig[] {
  return production ? LAUNCH_CHAINS : [...LAUNCH_CHAINS, ...TEST_CHAINS]
}

export function chainById(id: number, production = isProduction()): ChainConfig | undefined {
  return availableChains(production).find((chain) => chain.id === id)
}

/** How many blocks deep a payment must be on a chain. Throws a sentence for a chain that is not offered. */
export function confirmationsFor(id: number, production = isProduction()): number {
  const chain = chainById(id, production)
  if (!chain) throw new Error(`Chain ${id} is not configured.`)
  return chain.confirmations
}

/** Whether a receipt mined in `receiptBlock` is buried under `required` blocks (itself counted) at `latest`. */
export function hasConfirmations(receiptBlock: bigint, latest: bigint, required: number): boolean {
  return latest - receiptBlock + 1n >= BigInt(required)
}

/** The factory on a chain, checksummed. Throws a sentence when the chain or its variable is not set. */
export function factoryAddress(id: number, env: Env = process.env, production = isProduction()): Address {
  const chain = chainById(id, production)
  const value = chain ? env[chain.factoryEnv] : undefined
  if (!value || !isAddress(value, { strict: false }))
    throw new Error(`The factory address for chain ${id} is not configured.`)
  return getAddress(value)
}

/** Whether a URL points at this machine. The scripts refuse anything else. */
export function isLocalUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}
