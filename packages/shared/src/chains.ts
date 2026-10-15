import { getAddress, isAddress, type Address } from 'viem'
import {
  anvil,
  arbitrum,
  base,
  berachain,
  mainnet,
  monad,
  robinhood,
  robinhoodTestnet,
  sepolia,
  type Chain,
} from 'viem/chains'

/**
 * The chains Cobweb runs on (CLAUDE.md, launch chains) plus the test chains: Sepolia, Robinhood Chain Testnet
 * and a local Anvil chain, shown outside production and, with COBWEB_TEST_CHAINS=1, in a hosted test
 * environment (docs/specs/2026-10-16-freshness-server.md, section 5.4). Each names the environment variables
 * that configure it: `RPC_URL_<id>` (server only) and `FACTORY_ADDRESS_<id>`. A chain is ready for payments
 * when both are set.
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

/** Robinhood Chain Testnet rehearses Robinhood Chain, so it asks for the same 3 confirmations. */
export const TEST_CHAINS: readonly ChainConfig[] = [
  entry(sepolia, 'Sepolia', true, 2),
  entry(robinhoodTestnet, 'Robinhood Chain Testnet', true, 3),
  entry(anvil, 'Anvil', true, 1),
]

/**
 * Whether the test chains are hidden: in production, unless COBWEB_TEST_CHAINS is 1 (a hosted test
 * environment). Both variables are read as literal `process.env.NAME` expressions, which Next replaces in the
 * browser bundle and the server bundle alike. That fixes the switch at build time in the web app, so set
 * COBWEB_TEST_CHAINS where the build runs and rebuild after changing it.
 */
export const hidesTestChains = () =>
  process.env.NODE_ENV === 'production' && process.env.COBWEB_TEST_CHAINS !== '1'

export function availableChains(hideTestChains = hidesTestChains()): readonly ChainConfig[] {
  return hideTestChains ? LAUNCH_CHAINS : [...LAUNCH_CHAINS, ...TEST_CHAINS]
}

export function chainById(id: number, hideTestChains = hidesTestChains()): ChainConfig | undefined {
  return availableChains(hideTestChains).find((chain) => chain.id === id)
}

/** How many blocks deep a payment must be on a chain. Throws a sentence for a chain that is not offered. */
export function confirmationsFor(id: number, hideTestChains = hidesTestChains()): number {
  const chain = chainById(id, hideTestChains)
  if (!chain) throw new Error(`Chain ${id} is not configured.`)
  return chain.confirmations
}

/** Whether a receipt mined in `receiptBlock` is buried under `required` blocks (itself counted) at `latest`. */
export function hasConfirmations(receiptBlock: bigint, latest: bigint, required: number): boolean {
  return latest - receiptBlock + 1n >= BigInt(required)
}

/** The factory on a chain, checksummed. Throws a sentence when the chain or its variable is not set. */
export function factoryAddress(
  id: number,
  env: Env = process.env,
  hideTestChains = hidesTestChains(),
): Address {
  const chain = chainById(id, hideTestChains)
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
