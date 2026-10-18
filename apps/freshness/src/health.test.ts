import { BaseError, HttpRequestError, LimitExceededRpcError, RpcRequestError } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  chainHealth,
  errorLine,
  errorName,
  failureLine,
  failureName,
  HEALTH_LIMITS,
  healthProblems,
  type ChainHealth,
  type HealthLimits,
  type IndexerHealth,
  type ReaderHealth,
} from './health.ts'
import { IndexerWriteError } from './indexer-db.ts'

/** An RPC URL as a provider issues it, its key in the path. */
const KEYED_URL: string = 'https://rpc.example/v2/secret-key'

/** A JSON-RPC rate limit (-32005) as the node answers it, its message and viem's both carrying the URL. */
const rateLimit = (): RpcRequestError =>
  new RpcRequestError({
    body: { method: 'eth_call' },
    error: { code: -32005, message: `Too many requests from ${KEYED_URL}` },
    url: KEYED_URL,
  })

describe('the log lines (docs/specs/2026-10-16-freshness-server.md, section 6.1)', () => {
  it("name a JSON-RPC failure's code found on an inner error, and never a message or the URL", () => {
    // Only the inner error carries the code; every message on the chain carries the URL.
    const error = new BaseError(`The call to ${KEYED_URL} failed.`, { cause: rateLimit() })
    expect(error.message).toContain(KEYED_URL)
    expect(errorLine(error)).toBe('RpcRequestError (-32005): RPC Request failed.')
    expect(errorName(error)).toBe('RpcRequestError')
  })

  it("keep the code of viem's wrapping RPC error, and add none to a failure without one", () => {
    expect(errorLine(new LimitExceededRpcError(rateLimit()))).toBe(
      'RpcRequestError (-32005): RPC Request failed.',
    )
    expect(errorLine(new HttpRequestError({ url: KEYED_URL, status: 503 }))).toBe(
      'HttpRequestError: HTTP request failed.',
    )
    expect(errorLine(new TypeError(`fetch ${KEYED_URL} failed`))).toBe('TypeError')
  })

  it("add an unexpected failure's code in capitals once, and a whole-number code only as errorLine does", () => {
    const invalid = Object.assign(new TypeError(`Invalid URL: ${KEYED_URL}`), { code: 'ERR_INVALID_URL' })
    expect(failureLine(invalid)).toBe('TypeError (ERR_INVALID_URL)')
    // A port in use, as Node's listen reports it: the message names the address, and errno is not a code.
    const inUse = Object.assign(new Error('listen EADDRINUSE: address already in use :::3100'), {
      code: 'EADDRINUSE',
      errno: -48,
      syscall: 'listen',
    })
    expect(failureLine(inUse)).toBe('Error (EADDRINUSE)')
    expect(failureLine(new LimitExceededRpcError(rateLimit()))).toBe(
      'RpcRequestError (-32005): RPC Request failed.',
    )
  })

  it("name a failure for /health by its name and codes as the log line does, without viem's short message", () => {
    expect(failureName(new IndexerWriteError('indexer_targets', 'PGRST202', false))).toBe(
      'IndexerWriteError (PGRST202)',
    )
    expect(failureName(new IndexerWriteError('indexer_record', 'HTTP_401', false))).toBe(
      'IndexerWriteError (HTTP_401)',
    )
    const inner = new BaseError(`The call to ${KEYED_URL} failed.`, { cause: rateLimit() })
    expect(failureName(inner)).toBe('RpcRequestError (-32005)')
    expect(failureName(new HttpRequestError({ url: KEYED_URL, status: 503 }))).toBe('HttpRequestError')
    const invalid = Object.assign(new TypeError(`Invalid URL: ${KEYED_URL}`), { code: 'ERR_INVALID_URL' })
    expect(failureName(invalid)).toBe('TypeError (ERR_INVALID_URL)')
    // A code that is not capitals, digits and underscores is left out, as the log line leaves it out.
    expect(failureName(Object.assign(new Error('boom'), { code: `see ${KEYED_URL}` }))).toBe('Error')
    for (const error of [inner, invalid]) expect(failureName(error)).not.toContain('secret-key')
  })

  it('stop walking a chain of causes that refers back to itself', () => {
    const reset = Object.assign(new Error(`fetch ${KEYED_URL} failed`), { code: 'ECONNRESET' })
    reset.cause = reset
    expect(errorLine(reset)).toBe('Error')
    expect(failureLine(reset)).toBe('Error (ECONNRESET)')
    const call = new BaseError('The call failed.')
    call.cause = call
    expect(errorLine(call)).toBe('BaseError: The call failed.')
    expect(errorName(call)).toBe('BaseError')
  })
})

describe('chainHealth (docs/specs/2026-10-16-indexer-overview.md, section 6.7)', () => {
  const reader: ReaderHealth = {
    chainId: 31337,
    name: 'Anvil',
    hot: 1,
    tier: 'live',
    block: 120,
    lagSeconds: 2,
    lastGoodTickAt: '2026-10-16T12:00:00.000Z',
    failedTicks: 0,
    lastError: null,
    logGaps: 0,
    failedTicksRecent: 0,
    hotSince: '2026-10-16T11:59:00.000Z',
  }
  const indexer: IndexerHealth = {
    collections: 2,
    behind: 1,
    block: 119,
    lastPassAt: '2026-10-16T12:00:01.000Z',
    failedPasses: 3,
    lastError: 'IndexerWriteError',
    unpaired: 1,
    failedPassesRecent: 0,
    lastGoodPassAt: '2026-10-16T12:00:01.000Z',
    behindSince: null,
  }

  it("keeps the reader's fields and adds the indexer's last, null while the indexer is off", () => {
    expect(chainHealth(reader, null)).toEqual({ ...reader, indexer: null })
    const on = chainHealth(reader, indexer)
    expect(Object.keys(on)).toEqual([...Object.keys(reader), 'indexer'])
    expect(on.indexer).toEqual(indexer)
    expect(Object.keys(on.indexer!)).toEqual([
      'collections',
      'behind',
      'block',
      'lastPassAt',
      'failedPasses',
      'lastError',
      'unpaired',
      'failedPassesRecent',
      'lastGoodPassAt',
      'behindSince',
    ])
  })
})

describe('healthProblems (docs/specs/2026-10-17-production-hardening.md, section 8.2)', () => {
  const START = Date.parse('2026-10-17T12:00:00.000Z')
  /** ISO for `seconds` after the start. */
  const at = (seconds: number) => new Date(START + seconds * 1_000).toISOString()
  /** A chain hot since the start, read well and indexed well at 1,000 s past it, with one hot collection. */
  const healthy = (
    changes: Partial<ReaderHealth> = {},
    indexer: Partial<IndexerHealth> | null = {},
  ): ChainHealth => ({
    chainId: 31337,
    name: 'Anvil',
    hot: 1,
    tier: 'live',
    block: 120,
    lagSeconds: 2,
    lastGoodTickAt: at(1_000),
    failedTicks: 40,
    lastError: 'HttpRequestError',
    logGaps: 0,
    failedTicksRecent: 0,
    hotSince: at(0),
    ...changes,
    indexer:
      indexer === null
        ? null
        : {
            collections: 2,
            behind: 0,
            block: 119,
            lastPassAt: at(1_000),
            failedPasses: 30,
            lastError: 'IndexerWriteError (23514)',
            unpaired: 0,
            failedPassesRecent: 0,
            lastGoodPassAt: at(1_000),
            behindSince: null,
            ...indexer,
          },
  })
  const problemsAt = (seconds: number, chain: ChainHealth) =>
    healthProblems([chain], START + seconds * 1_000, START)

  it('reads ok at each limit, the cumulative counts aside', () => {
    expect(HEALTH_LIMITS).toEqual({
      readerStaleS: 60,
      readerLagS: 120,
      readerFailures: 10,
      indexerStaleS: 120,
      indexerBehindS: 900,
      indexerFailures: 5,
    })
    const atLimits = healthy(
      { lagSeconds: 120, failedTicksRecent: 10 },
      { failedPassesRecent: 5, behind: 1, behindSince: at(160), lastGoodPassAt: at(940) },
    )
    expect(problemsAt(1_060, atLimits)).toEqual([])
    expect(problemsAt(1_061, atLimits)).toEqual([
      'Anvil: no good read for 61 s (limit 60 s).',
      'Anvil: no good index pass for 121 s (limit 120 s).',
      'Anvil: 1 collection behind for 901 s (limit 900 s).',
    ])
  })

  it("says one sentence for each limit a chain's reader passes", () => {
    expect(problemsAt(1_061, healthy())).toEqual(['Anvil: no good read for 61 s (limit 60 s).'])
    expect(problemsAt(1_000, healthy({ lagSeconds: 121 }))).toEqual([
      'Anvil: the newest block is 121 s old (limit 120 s).',
    ])
    expect(problemsAt(1_000, healthy({ failedTicksRecent: 11 }))).toEqual([
      'Anvil: 11 failed reads in 5 minutes (limit 10).',
    ])
  })

  it("says one sentence for each limit a chain's indexer passes", () => {
    const fresh = { lastGoodTickAt: at(1_121) }
    expect(problemsAt(1_121, healthy(fresh))).toEqual(['Anvil: no good index pass for 121 s (limit 120 s).'])
    expect(problemsAt(1_000, healthy({}, { behind: 3, behindSince: at(99) }))).toEqual([
      'Anvil: 3 collections behind for 901 s (limit 900 s).',
    ])
    expect(problemsAt(1_000, healthy({}, { failedPassesRecent: 6 }))).toEqual([
      'Anvil: 6 failed index passes in 5 minutes (limit 5).',
    ])
  })

  it('names one collection behind in the singular, and none while no collection is behind', () => {
    expect(problemsAt(1_000, healthy({}, { behind: 1, behindSince: at(99) }))).toEqual([
      'Anvil: 1 collection behind for 901 s (limit 900 s).',
    ])
    // Between a catch-up pass's last scan and its end the count reads 0 while the time is still set.
    expect(problemsAt(1_000, healthy({}, { behind: 0, behindSince: at(99) }))).toEqual([])
  })

  it('counts a stale read from the later of the last good read and the moment the chain turned hot', () => {
    // Cold for 100 s after its last good read, then hot again: its first tick has 60 s to end.
    const rewoken = healthy({ lastGoodTickAt: at(1_000), hotSince: at(1_100) }, null)
    expect(problemsAt(1_160, rewoken)).toEqual([])
    expect(problemsAt(1_161, rewoken)).toEqual(['Anvil: no good read for 61 s (limit 60 s).'])
    // Hot all along: the last good read counts.
    expect(problemsAt(1_061, healthy({ hotSince: at(10) }, null))).toEqual([
      'Anvil: no good read for 61 s (limit 60 s).',
    ])
    // Hot with no good read since the start.
    expect(problemsAt(61, healthy({ lastGoodTickAt: null, hotSince: at(0) }, null))).toEqual([
      'Anvil: no good read for 61 s (limit 60 s).',
    ])
  })

  it('reads the limits it is given', () => {
    const tight: HealthLimits = { ...HEALTH_LIMITS, readerStaleS: 30, indexerFailures: 1 }
    expect(healthProblems([healthy({}, { failedPassesRecent: 2 })], START + 1_031_000, START, tight)).toEqual(
      ['Anvil: no good read for 31 s (limit 30 s).', 'Anvil: 2 failed index passes in 5 minutes (limit 1).'],
    )
  })

  it('counts from the start while there was no good read or pass yet', () => {
    const none = healthy({ lastGoodTickAt: null }, { lastGoodPassAt: null })
    expect(problemsAt(60, none)).toEqual([])
    expect(problemsAt(121, none)).toEqual([
      'Anvil: no good read for 121 s (limit 60 s).',
      'Anvil: no good index pass for 121 s (limit 120 s).',
    ])
  })

  it('has no reader problem but its failures with no hot collection, and no indexer problem with the indexer off', () => {
    const quiet = healthy({ hot: 0, lastGoodTickAt: null, lagSeconds: 500, failedTicksRecent: 11 }, null)
    expect(problemsAt(10_000, quiet)).toEqual(['Anvil: 11 failed reads in 5 minutes (limit 10).'])
  })

  it('names each chain in the order served', () => {
    const base = healthy({ chainId: 8453, name: 'Base', failedTicksRecent: 12 }, null)
    expect(healthProblems([base, healthy({ lagSeconds: 200 })], START + 1_999_000, START)).toEqual([
      'Base: no good read for 999 s (limit 60 s).',
      'Base: 12 failed reads in 5 minutes (limit 10).',
      'Anvil: no good read for 999 s (limit 60 s).',
      'Anvil: the newest block is 200 s old (limit 120 s).',
      'Anvil: no good index pass for 999 s (limit 120 s).',
    ])
  })
})
