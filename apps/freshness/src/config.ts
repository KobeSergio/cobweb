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

/**
 * The indexer's settings (docs/specs/2026-10-16-indexer-overview.md, section 6.1): its database, the
 * project's API URL and service role key, the names and the client the render worker uses; and the passes'
 * delays and the targets' read, which `verify:indexer` shortens.
 */
export type IndexerOptions = {
  supabaseUrl: string
  serviceRoleKey: string
  /** The wait from a pass's start to the next: during a backfill, while a chain is busy, otherwise. */
  passMs?: { behind: number; fast: number; idle: number }
  /** How often the deployed collections are read again. */
  targetsEveryMs?: number
}

/**
 * Whether a value is a URL supabase-js takes: `http://` or `https://`, then a URL that parses. `createClient`
 * throws on any other, and it runs once the server listens.
 */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim()) && URL.canParse(value.trim())
}

/**
 * The indexer's options from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, a blank one read as unset: null
 * when neither is set, so the indexer stays off. One set alone, or a `SUPABASE_URL` that is not an http or
 * https URL, refuses the start, as a malformed factory address does: a viem `BaseError` named
 * `ConfigurationError` whose sentence names the variables, never a value.
 */
export function indexerOptionsOf(env: Record<string, string | undefined>): IndexerOptions | null {
  const supabaseUrl = env.SUPABASE_URL ?? ''
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supabaseUrl && !serviceRoleKey) return null
  if (!supabaseUrl || !serviceRoleKey)
    throw new BaseError(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both needed to run the indexer; set both or neither.',
      { name: 'ConfigurationError' },
    )
  if (!isHttpUrl(supabaseUrl))
    throw new BaseError('SUPABASE_URL must be an http or https URL.', { name: 'ConfigurationError' })
  return { supabaseUrl, serviceRoleKey }
}
