import { availableChains, type ChainConfig } from '@cobweb/shared'
import { BaseError, isAddress } from 'viem'

/**
 * The freshness server's settings (docs/specs/2026-10-16-freshness-server.md, section 6.2): `PORT` (Railway
 * sets it), `NODE_ENV` and `COBWEB_TEST_CHAINS` (which chains are available), and per chain `RPC_URL_<id>`
 * and `FACTORY_ADDRESS_<id>`, the names the web app uses.
 */

/** The port the server listens on when PORT is unset or blank. */
export const DEFAULT_PORT = 3100

/** The port to listen on: `PORT`, or 3100 when it is unset or blank. */
export function portOf(value: string | undefined): number {
  return Number(value || DEFAULT_PORT)
}

/**
 * The chains the server reads: each of `availableChains()` whose `RPC_URL_<id>` and `FACTORY_ADDRESS_<id>`
 * are both set, limited to `chainIds` when given. The server reads them once, at start, and does not start
 * when a served chain's factory is not an address: the error names the variable and the chain, never the
 * value, and is a viem `BaseError` so that `errorLine` prints its sentence.
 */
export function servedChains(chainIds?: number[]): ChainConfig[] {
  const chains = availableChains().filter(
    (chain) =>
      Boolean(process.env[chain.rpcEnv]) &&
      Boolean(process.env[chain.factoryEnv]) &&
      (chainIds === undefined || chainIds.includes(chain.id)),
  )
  for (const chain of chains) {
    if (isAddress(process.env[chain.factoryEnv] ?? '', { strict: false })) continue
    const sentence = `${chain.factoryEnv} is not an address, so ${chain.name} (${chain.id}) cannot be served.`
    throw new BaseError(sentence, { name: 'ConfigurationError' })
  }
  return chains
}
