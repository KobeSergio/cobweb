import type { Address, Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorLine, failureLine } from './health.ts'
import {
  DB_TIMEOUT_MS,
  indexerConnectionOf,
  indexerDbOf,
  IndexerWriteError,
  postgresIndexerDb,
  type IndexerCall,
  type IndexerSql,
  type IndexerTls,
  type RecordWrite,
} from './indexer-db.ts'

const ID = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const CONTRACT: Address = '0x0409454c375c8a6ab05383bfb6d9fcde9ebb8f85'
const MINTER: Address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const DEPLOY: Hex = `0x${'da'.repeat(32)}`
const MINT_TX: Hex = `0x${'0b'.repeat(32)}`
const URL_WITH_SECRET = 'postgresql://cobweb_indexer:s3cret@db.example:5432/postgres'

const WRITE: RecordWrite = {
  chainId: 31337,
  fromBlock: 91n,
  toBlock: 100n,
  syncedAt: 1_800_000_100,
  collections: [ID],
  records: { mints: [], owners: [], airdrops: [], withdrawals: [] },
}

/** A call answering each call with the next answer, recording each function and its arguments. */
function fakeCall(...answers: unknown[]) {
  const sent: { fn: string; args: readonly unknown[] }[] = []
  const call: IndexerCall = async (fn, args) => {
    sent.push({ fn, args })
    return answers.shift() ?? null
  }
  return { sent, db: indexerDbOf(call) }
}

/**
 * A postgres.js client answering each query with the next answer: a value as the row's `answer`, an error to
 * throw, or `hang`, which never answers. It records each query and its parameters, the cancellations and the end.
 */
function fakeSql(...answers: unknown[]) {
  const sent: { query: string; parameters: unknown[] }[] = []
  const state = {
    cancelled: 0,
    ended: null as { timeout: number } | null,
    opened: '',
    ssl: null as IndexerTls | null,
  }
  const sql: IndexerSql = {
    unsafe(query, parameters) {
      sent.push({ query, parameters })
      const answer = answers.shift()
      const settled =
        answer === 'hang'
          ? new Promise<never>(() => {})
          : answer instanceof Error
            ? Promise.reject(answer)
            : Promise.resolve([{ answer }])
      return Object.assign(settled, { cancel: () => state.cancelled++ })
    },
    async end(options) {
      state.ended = options
    },
  }
  const db = postgresIndexerDb({ databaseUrl: URL_WITH_SECRET }, (url, ssl) => {
    state.opened = url
    state.ssl = ssl
    return sql
  })
  return { sent, state, db }
}

/** A Postgres refusal as postgres.js throws it. */
const pgError = (code: string, message: string) =>
  Object.assign(new Error(message), { name: 'PostgresError', code })

/** What a promise settles to: its value, or the error it rejected with. */
const settled = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => value,
    (error: unknown) => error,
  )

const codeOf = (error: unknown) => error instanceof IndexerWriteError && [error.code, error.gap]

describe('indexerDbOf (docs/specs/2026-10-17-production-hardening.md, section 8.1)', () => {
  it('reads the targets with blocks as bigints, null without a cursor', async () => {
    const target = { collectionId: ID, contract: CONTRACT, deployTx: DEPLOY, syncedAt: null }
    const { sent, db } = fakeCall([
      { ...target, fromBlock: null, indexedBlock: null },
      { ...target, fromBlock: 50, indexedBlock: 120, syncedAt: 1_800_000_120 },
    ])
    expect(await db.targets(31337)).toEqual([
      { ...target, fromBlock: null, indexedBlock: null },
      { ...target, fromBlock: 50n, indexedBlock: 120n, syncedAt: 1_800_000_120 },
    ])
    expect(sent).toEqual([{ fn: 'indexer_targets', args: [31337] }])
  })

  it('writes a segment with its blocks as numbers and its sync time as ISO, and answers whole summaries', async () => {
    const summary = { collectionId: ID, contract: CONTRACT, holders: 2, syncedAt: 1_800_000_100 }
    const mint = {
      tx: MINT_TX,
      recipient: MINTER,
      groupId: 1,
      amount: 2,
      firstTokenId: 5,
      blockTime: 1_800_000_090,
    }
    const { sent, db } = fakeCall({ [ID]: { ...summary, recentMints: [mint] } }, {})
    expect(await db.record(WRITE)).toEqual([
      {
        ...summary,
        recentMints: [
          {
            txHash: MINT_TX,
            recipient: MINTER,
            groupId: 1,
            amount: 2,
            firstTokenId: 5,
            blockTimestamp: 1_800_000_090,
          },
        ],
      },
    ])
    expect(sent[0]).toEqual({
      fn: 'indexer_record',
      args: [31337, 91, 100, new Date(1_800_000_100_000).toISOString(), [ID], WRITE.records],
    })
    // A write that leaves the cursor unsynced sends no time, and a write naming no collection answers none.
    expect(await db.record({ ...WRITE, syncedAt: null })).toEqual([])
    expect(sent[1]?.args[3]).toBeNull()
  })

  it('starts a cursor at its block, and loads the summaries', async () => {
    const { sent, db } = fakeCall({ collectionId: ID }, [])
    await db.start(ID, 50n)
    expect(await db.summaries(31337)).toEqual([])
    expect(sent).toEqual([
      { fn: 'indexer_start', args: [ID, 50] },
      { fn: 'indexer_summaries', args: [31337] },
    ])
  })

  it('fails each function that answers nothing as NO_ANSWER', async () => {
    const { db } = fakeCall()
    const errors = [
      await settled(db.targets(31337)),
      await settled(db.start(ID, 50n)),
      await settled(db.record(WRITE)),
      await settled(db.summaries(31337)),
    ]
    expect(errors.map((error) => error instanceof IndexerWriteError && error.message)).toEqual([
      "The indexer's indexer_targets call failed (NO_ANSWER).",
      "The indexer's indexer_start call failed (NO_ANSWER).",
      "The indexer's indexer_record call failed (NO_ANSWER).",
      "The indexer's indexer_summaries call failed (NO_ANSWER).",
    ])
  })
})

describe("indexerConnectionOf: the connection's TLS", () => {
  const LOCAL = 'postgresql://cobweb_indexer:pw@127.0.0.1:55322/postgres'
  const HOSTED =
    'postgres://cobweb_indexer.abcdefghijklmnopqrst:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
  const PEM = '-----BEGIN CERTIFICATE-----\nMIIBkTCB+wIJAN\n-----END CERTIFICATE-----'
  /** A file reader that records each path and answers the PEM. */
  const reader = (read: string[]) => (path: string) => {
    read.push(path)
    return PEM
  }

  it('lets a database on this machine use plain TCP, as the local stack does', () => {
    expect(indexerConnectionOf({ databaseUrl: LOCAL })).toEqual({ databaseUrl: LOCAL, ssl: undefined })
    const named = 'postgresql://cobweb_indexer:pw@localhost:55322/postgres'
    expect(indexerConnectionOf({ databaseUrl: named })).toEqual({ databaseUrl: named, ssl: undefined })
  })

  it('verifies the certificate and the host of a database on another machine, whatever its string names', () => {
    expect(indexerConnectionOf({ databaseUrl: HOSTED })).toEqual({
      databaseUrl: HOSTED,
      ssl: { rejectUnauthorized: true },
    })
    const verified = `${HOSTED}?sslmode=verify-full`
    expect(indexerConnectionOf({ databaseUrl: verified }).ssl).toEqual({ rejectUnauthorized: true })
    expect(indexerConnectionOf({ databaseUrl: `${HOSTED}?sslrootcert=system` })).toEqual({
      databaseUrl: HOSTED,
      ssl: { rejectUnauthorized: true },
    })
  })

  it('trusts the CA the file INDEXER_DATABASE_SSL_CA names, or else the one sslrootcert names, dropping that parameter', () => {
    const read: string[] = []
    expect(
      indexerConnectionOf({ databaseUrl: HOSTED, sslCaFile: '/app/certs/ca.crt' }, reader(read)),
    ).toEqual({
      databaseUrl: HOSTED,
      ssl: { rejectUnauthorized: true, ca: PEM },
    })
    const fromString = indexerConnectionOf(
      { databaseUrl: `${HOSTED}?sslrootcert=/etc/ssl/supabase.crt&sslmode=verify-full` },
      reader(read),
    )
    expect(fromString).toEqual({
      databaseUrl: `${HOSTED}?sslmode=verify-full`,
      ssl: { rejectUnauthorized: true, ca: PEM },
    })
    expect(read).toEqual(['/app/certs/ca.crt', '/etc/ssl/supabase.crt'])
  })

  it('refuses a CA file that cannot be read, naming the variable, never the path', () => {
    const missing = () => {
      throw new Error('ENOENT: no such file or directory, open /secret/ca.crt')
    }
    const refusals: unknown[] = []
    for (const options of [
      { databaseUrl: HOSTED, sslCaFile: '/secret/ca.crt' },
      { databaseUrl: `${HOSTED}?sslrootcert=/secret/ca.crt` },
    ])
      try {
        indexerConnectionOf(options, missing)
      } catch (error) {
        refusals.push(error)
      }
    expect(refusals.map(errorLine)).toEqual([
      'ConfigurationError: INDEXER_DATABASE_SSL_CA names a CA certificate file that cannot be read.',
      'ConfigurationError: INDEXER_DATABASE_URL names a CA certificate file that cannot be read.',
    ])
  })
})

describe('postgresIndexerDb', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens its connection string and calls each function with its arguments and casts', async () => {
    const { sent, state, db } = fakeSql([], {}, {}, [])
    await db.targets(31337)
    await db.start(ID, 50n)
    await db.record(WRITE)
    await db.summaries(31337)
    expect([state.opened, state.ssl]).toEqual([URL_WITH_SECRET, { rejectUnauthorized: true }])
    expect(sent).toEqual([
      { query: 'select public.indexer_targets($1::integer) as answer', parameters: [31337] },
      { query: 'select public.indexer_start($1::uuid, $2::bigint) as answer', parameters: [ID, 50] },
      {
        query:
          'select public.indexer_record($1::integer, $2::bigint, $3::bigint, $4::timestamptz, $5::uuid[], $6::jsonb) as answer',
        parameters: [31337, 91, 100, new Date(1_800_000_100_000).toISOString(), [ID], WRITE.records],
      },
      { query: 'select public.indexer_summaries($1::integer) as answer', parameters: [31337] },
    ])
  })

  it("names a refusal by its function and Postgres code, a gap for a skip and an unindexed collection, never the database's message", async () => {
    const { db } = fakeSql(
      pgError('23514', 'The indexer would skip blocks.'),
      pgError('23514', 'A collection is not indexed on this chain.'),
      pgError('23514', 'A record names a collection outside this write.'),
      pgError('42501', 'permission denied for function indexer_targets'),
      pgError('42883', 'function public.indexer_summaries(integer) does not exist'),
      pgError('28P01', 'password authentication failed for user "cobweb_indexer"'),
    )
    const errors = [
      await settled(db.record(WRITE)),
      await settled(db.record(WRITE)),
      await settled(db.record(WRITE)),
      await settled(db.targets(31337)),
      await settled(db.summaries(31337)),
      await settled(db.summaries(31337)),
    ]
    expect(errors.map(codeOf)).toEqual([
      ['23514', true],
      ['23514', true],
      ['23514', false],
      ['42501', false],
      ['42883', false],
      ['28P01', false],
    ])
    expect((errors[0] as Error).message).toBe("The indexer's indexer_record call failed (23514).")
    expect(errors.map((error) => failureLine(error))).toEqual([
      'IndexerWriteError (23514)',
      'IndexerWriteError (23514)',
      'IndexerWriteError (23514)',
      'IndexerWriteError (42501)',
      'IndexerWriteError (42883)',
      'IndexerWriteError (28P01)',
    ])
  })

  it('names a call no database answered NETWORK, whatever its error carries', async () => {
    const refused = Object.assign(new Error(`connect ECONNREFUSED to ${URL_WITH_SECRET}`), {
      code: 'ECONNREFUSED',
    })
    const closed = Object.assign(new Error('write CONNECTION_CLOSED db.example:5432'), {
      code: 'CONNECTION_CLOSED',
    })
    const { db } = fakeSql(refused, closed)
    const errors = [await settled(db.summaries(31337)), await settled(db.targets(31337))]
    expect(errors.map(codeOf)).toEqual([
      ['NETWORK', false],
      ['NETWORK', false],
    ])
    expect(errors.map((error) => failureLine(error)).join(' ')).not.toContain('s3cret')
  })

  it('abandons and cancels a call that has not answered after 10 s, so it cannot hold a pass', async () => {
    vi.useFakeTimers()
    const { state, db } = fakeSql('hang')
    let outcome: unknown = 'waiting'
    void settled(db.summaries(31337)).then((value) => {
      outcome = value
    })
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS - 1)
    expect([outcome, state.cancelled]).toEqual(['waiting', 0])
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome instanceof IndexerWriteError && [outcome.code, outcome.message]).toEqual([
      'TIMEOUT',
      "The indexer's indexer_summaries call failed (TIMEOUT).",
    ])
    expect(state.cancelled).toBe(1)
  })

  it('closes its connections on end', async () => {
    const { state, db } = fakeSql()
    await db.end()
    expect(state.ended).toEqual({ timeout: 5 })
  })
})
