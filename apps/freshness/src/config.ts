import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
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

/** The login role the indexer connects as (docs/specs/2026-10-17-production-hardening.md, section 8.1). */
export const INDEXER_ROLE = 'cobweb_indexer'

/**
 * The indexer's settings (docs/specs/2026-10-17-production-hardening.md, section 8.1): its database, a connection
 * string for the cobweb_indexer role, which executes the indexer's four functions and nothing else, with the
 * database's CA certificate when one is given; and the passes' delays and the targets' read, which
 * `verify:indexer` shortens.
 */
export type IndexerOptions = {
  databaseUrl: string
  /**
   * The database's CA certificate, which the connection's verification then trusts: the certificate itself in PEM
   * (a value that begins -----BEGIN, as a Railway variable carries it), or the path of a file that holds it.
   */
  sslCa?: string
  /** The wait from a pass's start to the next: during a backfill, while a chain is busy, otherwise. */
  passMs?: { behind: number; fast: number; idle: number }
  /** How often the deployed collections are read again. */
  targetsEveryMs?: number
}

/** Hosts on this machine, where the local stack answers over plain TCP. */
const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]']
/** The TLS modes a connection string may name for a database on another machine: the verified ones. */
const VERIFIED_MODES: readonly string[] = ['verify-ca', 'verify-full']

/** Whether a connection string's host is this machine, in any case: a postgres:// URL keeps the case it is given. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.includes(hostname.toLowerCase())
}

/** The session pooler's name for the role: cobweb_indexer.<project ref>. */
const POOLER_USER = /^cobweb_indexer\.[a-z0-9]+$/

/** The variables the indexer read before it had its own role, which nothing reads now. */
const OLD_VARIABLES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

/**
 * The indexer's options from `INDEXER_DATABASE_URL`, a blank one read as unset: null when it is unset, so the
 * indexer stays off; with `INDEXER_DATABASE_SSL_CA`, the database's CA certificate or the path of its file, when
 * set. Otherwise it is checked as `checkIndexerOptions` checks it, which refuses the start as a malformed factory
 * address does.
 */
export function indexerOptionsOf(env: Record<string, string | undefined>): IndexerOptions | null {
  const databaseUrl = env.INDEXER_DATABASE_URL?.trim() ?? ''
  if (!databaseUrl) return null
  const sslCa = env.INDEXER_DATABASE_SSL_CA?.trim()
  return checkIndexerOptions(sslCa ? { databaseUrl, sslCa } : { databaseUrl })
}

const refusal = (sentence: string) => new BaseError(sentence, { name: 'ConfigurationError' })

/** A PEM block begins so: a value of INDEXER_DATABASE_SSL_CA that does is the certificate itself, not a path. */
const PEM_START = '-----BEGIN'

/** Whether a text holds a certificate in PEM that Node can parse. */
function holdsCertificate(pem: string): boolean {
  try {
    return new X509Certificate(pem).raw.length > 0
  } catch {
    return false
  }
}

/**
 * The CA certificate `INDEXER_DATABASE_SSL_CA` gives, in PEM: the value itself when it begins -----BEGIN, else the
 * file at the path it names. Refused, as a `ConfigurationError` naming the variable and never its value, when the
 * path cannot be read, or when neither the value nor the file holds a certificate Node can parse (a truncated paste,
 * a private key, or newlines written as \n would otherwise fail every connection's handshake).
 */
export function caCertificateOf(
  value: string,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string {
  const given = value.trim()
  let pem = given
  if (!given.startsWith(PEM_START))
    try {
      pem = read(given)
    } catch (error) {
      throw new BaseError('INDEXER_DATABASE_SSL_CA names a CA certificate file that cannot be read.', {
        name: 'ConfigurationError',
        cause: error as Error,
      })
    }
  if (!holdsCertificate(pem))
    throw refusal(
      'INDEXER_DATABASE_SSL_CA must be a CA certificate in PEM or the path of a file that holds one.',
    )
  return pem
}

/** Whether a percent-encoded part of a URL decodes, as postgres.js decodes the password it is given. */
function decodes(value: string): boolean {
  try {
    decodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

/**
 * The part of a connection string postgres.js 3.4.9 decodes as its host and port (`parseUrl` in src/index.js):
 * after `://` and the first `@`, up to the first `?` or `/`.
 */
function rawHostOf(databaseUrl: string): string {
  const authority = databaseUrl.slice(databaseUrl.indexOf('://') + 3).split(/[?/]/)[0] ?? ''
  return authority.slice(authority.indexOf('@') + 1)
}

/**
 * The indexer's options, answered as they are once checked: a `postgres://` or `postgresql://` connection string
 * with a host and a password that decode, whose user is cobweb_indexer, or the session pooler's
 * cobweb_indexer.<project ref>, and which asks for no unverified connection to a database that is not on this
 * machine (every `sslmode` or `ssl` value, when given, verify-ca or verify-full; require, prefer, allow and
 * disable each leave the certificate unchecked or TLS off); and a CA certificate, when given, that
 * `caCertificateOf` reads. A refusal is a viem `BaseError` named `ConfigurationError` whose sentence never carries
 * any part of the value. `startFreshness` checks its options with it before it listens.
 */
export function checkIndexerOptions(options: IndexerOptions): IndexerOptions {
  let url: URL | null
  try {
    url = new URL(options.databaseUrl.trim())
  } catch {
    url = null
  }
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname)
    throw refusal('INDEXER_DATABASE_URL must be a postgres:// or postgresql:// connection string.')
  if (!decodes(rawHostOf(options.databaseUrl.trim())))
    throw refusal('INDEXER_DATABASE_URL has a malformed host.')
  if (!url.password)
    throw refusal("INDEXER_DATABASE_URL has no password; include the cobweb_indexer role's password.")
  if (!decodes(url.password))
    throw refusal('INDEXER_DATABASE_URL has a malformed password; percent-encode its special characters.')
  let user: string
  try {
    user = decodeURIComponent(url.username)
  } catch {
    user = ''
  }
  if (user !== INDEXER_ROLE && !POOLER_USER.test(user))
    throw refusal('INDEXER_DATABASE_URL must connect as the cobweb_indexer role.')
  // Every value of each: postgres.js takes the last one a string names.
  if (!isLoopbackHost(url.hostname))
    for (const name of ['sslmode', 'ssl'])
      for (const mode of url.searchParams.getAll(name))
        if (!VERIFIED_MODES.includes(mode))
          throw refusal(
            'INDEXER_DATABASE_URL must verify TLS for a database on another machine: leave sslmode out, or set it to verify-full.',
          )
  if (options.sslCa !== undefined) caCertificateOf(options.sslCa)
  return options
}

/**
 * Whether this run is hosted, where the indexer must run: on Railway, which sets RAILWAY_ENVIRONMENT (a blank one
 * reads as unset), or under NODE_ENV=production. Locally the indexer is optional.
 */
export function isHostedRun(env: Record<string, string | undefined>): boolean {
  return Boolean(env.RAILWAY_ENVIRONMENT?.trim()) || env.NODE_ENV === 'production'
}

/** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` where still set: `index.ts` logs them as no longer read. */
export function unreadIndexerVariables(env: Record<string, string | undefined>): string[] {
  return OLD_VARIABLES.filter((name) => Boolean(env[name]?.trim()))
}
