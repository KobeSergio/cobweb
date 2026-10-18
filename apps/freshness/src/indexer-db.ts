import { readFileSync } from 'node:fs'
import type { MintBody } from '@cobweb/shared'
import postgres from 'postgres'
import { BaseError, type Address, type Hex } from 'viem'
import type { Summary } from './activity.ts'
import { isLoopbackHost, type IndexerOptions } from './config.ts'
import type { Records } from './indexer-records.ts'

/**
 * The indexer's database (docs/specs/2026-10-17-production-hardening.md, section 8.1): the four functions of its
 * migration, called as the cobweb_indexer role over postgres.js, which may execute those four and nothing else.
 * The request path never uses it. A failure throws `IndexerWriteError`, which names the function and the code,
 * never the database's message or the connection string.
 */

export type { Summary } from './activity.ts'

/**
 * A deployed collection as `indexer_targets` lists it: without a cursor, its blocks and sync time are null.
 */
export type Target = {
  collectionId: string
  contract: Address
  deployTx: Hex
  fromBlock: bigint | null
  indexedBlock: bigint | null
  /** Unix seconds. */
  syncedAt: number | null
}

/** One write: one segment of one scan, for the scan's collections. */
export type RecordWrite = {
  chainId: number
  fromBlock: bigint
  toBlock: bigint
  /** The head's time when the segment ends at the safe block (Unix seconds), else null. */
  syncedAt: number | null
  collections: string[]
  records: Records
}

export type IndexerDb = {
  targets(chainId: number): Promise<Target[]>
  start(collectionId: string, fromBlock: bigint): Promise<void>
  record(write: RecordWrite): Promise<Summary[]>
  summaries(chainId: number): Promise<Summary[]>
}

export type IndexerFunction = 'indexer_targets' | 'indexer_start' | 'indexer_record' | 'indexer_summaries'

/** One function's call with its arguments in order, answering its jsonb. */
export type IndexerCall = (fn: IndexerFunction, args: readonly unknown[]) => Promise<unknown>

/**
 * How long one database call may take before it is abandoned and counts as failed: the role's statement_timeout
 * too (indexer spec, Review Focus 1).
 */
export const DB_TIMEOUT_MS = 10_000

/** The refusals that mean the cursors in memory no longer match the database's. */
const GAP_SENTENCES: readonly string[] = [
  'The indexer would skip blocks.',
  'A collection is not indexed on this chain.',
]

/**
 * A database call that failed: the function and the code, a Postgres code such as 23514, 42501 (a grant is
 * missing), 42883 (the function is missing) or 28P01 (the password is refused), TIMEOUT when the call was
 * abandoned, TLS when Node refused the database's certificate or the handshake, or NETWORK when no answer
 * came. `gap` when the refusal means the cursors in memory no longer match the database's, so the targets are
 * read again.
 */
export class IndexerWriteError extends Error {
  readonly code: string
  readonly gap: boolean

  constructor(fn: string, code: string, gap: boolean) {
    super(`The indexer's ${fn} call failed (${code}).`)
    this.name = 'IndexerWriteError'
    this.code = code
    this.gap = gap
  }
}

/**
 * A mint as the functions answer it: the transaction, the recipient as stored, the block's time in Unix
 * seconds.
 */
type DbMint = {
  tx: Hex
  recipient: Address
  groupId: number
  amount: number
  firstTokenId: number
  blockTime: number
}
type DbSummary = Omit<Summary, 'recentMints'> & { recentMints: DbMint[] }
type DbTarget = Omit<Target, 'fromBlock' | 'indexedBlock'> & {
  fromBlock: number | null
  indexedBlock: number | null
}

const summaryOf = (raw: DbSummary): Summary => ({
  collectionId: raw.collectionId,
  contract: raw.contract,
  holders: raw.holders,
  syncedAt: raw.syncedAt,
  recentMints: raw.recentMints.map((mint): MintBody => ({
    txHash: mint.tx,
    recipient: mint.recipient,
    groupId: mint.groupId,
    amount: mint.amount,
    firstTokenId: mint.firstTokenId,
    blockTimestamp: mint.blockTime,
  })),
})

const blockOf = (value: number | null) => (value === null ? null : BigInt(value))

/**
 * The port over a call. Blocks travel as numbers, which hold any block below 2^53 exactly, and the sync time as
 * ISO. Every function answers jsonb, so a call answering nothing failed too.
 */
export function indexerDbOf(call: IndexerCall): IndexerDb {
  async function answered<T>(fn: IndexerFunction, args: readonly unknown[]): Promise<T> {
    const answer = await call(fn, args)
    if (answer === null || answer === undefined) throw new IndexerWriteError(fn, 'NO_ANSWER', false)
    return answer as T
  }

  return {
    async targets(chainId) {
      const rows = await answered<DbTarget[]>('indexer_targets', [chainId])
      return rows.map((row) => ({
        ...row,
        fromBlock: blockOf(row.fromBlock),
        indexedBlock: blockOf(row.indexedBlock),
      }))
    },
    async start(collectionId, fromBlock) {
      await answered('indexer_start', [collectionId, Number(fromBlock)])
    },
    async record(write) {
      const answer = await answered<Record<string, DbSummary>>('indexer_record', [
        write.chainId,
        Number(write.fromBlock),
        Number(write.toBlock),
        write.syncedAt === null ? null : new Date(write.syncedAt * 1_000).toISOString(),
        write.collections,
        write.records,
      ])
      return Object.values(answer).map(summaryOf)
    },
    async summaries(chainId) {
      return (await answered<DbSummary[]>('indexer_summaries', [chainId])).map(summaryOf)
    },
  }
}

/** Each function's parameters with their casts, so Postgres picks its one signature. */
export const INDEXER_PARAMETERS: Record<IndexerFunction, string> = {
  indexer_targets: '$1::integer',
  indexer_start: '$1::uuid, $2::bigint',
  indexer_record: '$1::integer, $2::bigint, $3::bigint, $4::timestamptz, $5::uuid[], $6::jsonb',
  indexer_summaries: '$1::integer',
}

/** The part of a postgres.js client the port uses: a query with parameters, which can be cancelled, and `end`. */
export type IndexerSql = {
  unsafe(query: string, parameters: unknown[]): PromiseLike<{ answer: unknown }[]> & { cancel(): unknown }
  end(options: { timeout: number }): Promise<void>
}

/**
 * The connection's TLS as postgres.js takes it: an object, which it merges into Node's TLS options, so the
 * certificate is checked against the system's CAs, or the given one, and the host against the certificate (Node's
 * default); or undefined for a database on this machine, where the connection string decides (plain TCP for the
 * local stack). Never postgres.js's string modes: in 3.4.9 `require`, `allow` and `prefer` set
 * `rejectUnauthorized: false`, and `prefer` falls back to plain TCP.
 */
export type IndexerTls = { rejectUnauthorized: true; ca?: string } | undefined

/** A CA certificate that cannot be read refuses the start, naming the variable that named it, never the path. */
const unreadableCa = (variable: string, error: unknown) =>
  new BaseError(`${variable} names a CA certificate file that cannot be read.`, {
    name: 'ConfigurationError',
    cause: error as Error,
  })

/**
 * The connection string postgres.js gets and its TLS (docs/specs/2026-10-17-production-hardening.md, section 8.1):
 * for a database on another machine, always verified (`rejectUnauthorized: true` with Node's host check), trusting
 * the CA certificate `INDEXER_DATABASE_SSL_CA` names, or else the file the string's `sslrootcert` names, when one
 * is given; for this machine, whatever the string says unless a CA is given. The string loses `sslrootcert`, which
 * postgres.js would send the server as a setting; `sslrootcert=system` means the system's CAs, the default.
 */
export function indexerConnectionOf(
  options: IndexerOptions,
  readCa: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): { databaseUrl: string; ssl: IndexerTls } {
  const url = new URL(options.databaseUrl.trim())
  const rootCert = url.searchParams.get('sslrootcert')
  url.searchParams.delete('sslrootcert')
  const databaseUrl = url.toString()
  let ca: string | undefined
  if (options.sslCaFile)
    try {
      ca = readCa(options.sslCaFile)
    } catch (error) {
      throw unreadableCa('INDEXER_DATABASE_SSL_CA', error)
    }
  else if (rootCert && rootCert !== 'system')
    try {
      ca = readCa(rootCert)
    } catch (error) {
      throw unreadableCa('INDEXER_DATABASE_URL', error)
    }
  if (ca) return { databaseUrl, ssl: { rejectUnauthorized: true, ca } }
  if (isLoopbackHost(url.hostname)) return { databaseUrl, ssl: undefined }
  return { databaseUrl, ssl: { rejectUnauthorized: true } }
}

/**
 * postgres.js on the connection string: at most 4 connections, no prepared statements, so either pooler mode
 * serves. The TLS object goes in as the `ssl` option, which postgres.js takes over any `sslmode` or `ssl` the
 * string names, so the string cannot turn the verification off. Building it opens no connection.
 */
export function connect(databaseUrl: string, ssl: IndexerTls): postgres.Sql {
  return postgres(databaseUrl, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 60,
    onnotice: () => {},
    ...(ssl === undefined ? {} : { ssl }),
  })
}

/**
 * The certificate checks a database's certificate can fail, as OpenSSL names them; Node's own TLS codes start
 * with ERR_TLS_ or ERR_SSL_.
 */
const CERTIFICATE_CODES: readonly string[] = [
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
]

/**
 * A Postgres refusal's code; TLS for a certificate or a handshake Node refused, whose error postgres.js passes
 * through unchanged; anything else (a refused connection, a reset, a closed socket) is NETWORK.
 */
const codeOf = (error: unknown) => {
  const failure = error as { name?: unknown; code?: unknown }
  if (failure?.name === 'PostgresError' && typeof failure.code === 'string') return failure.code
  const code = typeof failure?.code === 'string' ? failure.code : ''
  return code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_') || CERTIFICATE_CODES.includes(code)
    ? 'TLS'
    : 'NETWORK'
}

/**
 * The port as the cobweb_indexer role, over verified TLS to any database not on this machine: each call is
 * `select public.<fn>(<parameters with casts>) as answer`, abandoned and cancelled after `DB_TIMEOUT_MS`, so a
 * connection that never answers cannot hold a chain's passes, which never overlap, or the server's close. `end`
 * closes the connections. A CA certificate file that cannot be read refuses the start.
 */
export function postgresIndexerDb(
  options: IndexerOptions,
  open: (databaseUrl: string, ssl: IndexerTls) => IndexerSql = (databaseUrl, ssl) =>
    connect(databaseUrl, ssl) as unknown as IndexerSql,
): IndexerDb & { end(): Promise<void> } {
  const { databaseUrl, ssl } = indexerConnectionOf(options)
  const sql = open(databaseUrl, ssl)

  const call: IndexerCall = async (fn, args) => {
    const query = sql.unsafe(`select public.${fn}(${INDEXER_PARAMETERS[fn]}) as answer`, [...args])
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)
    })
    try {
      const outcome = await Promise.race([query, timedOut])
      if (outcome === 'timeout') {
        query.cancel()
        // Its cancellation fails the query later; the call has failed already, as TIMEOUT.
        void Promise.resolve(query).catch(() => {})
        throw new IndexerWriteError(fn, 'TIMEOUT', false)
      }
      return outcome[0]?.answer ?? null
    } catch (error) {
      if (error instanceof IndexerWriteError) throw error
      const message = (error as { message?: unknown })?.message
      // No cause, by design: postgres.js attaches the query's parameters and the database's message to its error.
      throw new IndexerWriteError(fn, codeOf(error), GAP_SENTENCES.includes(String(message)))
    } finally {
      clearTimeout(timer)
    }
  }

  return { ...indexerDbOf(call), end: () => sql.end({ timeout: 5 }) }
}
