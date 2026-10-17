import { BaseError, HttpRequestError, LimitExceededRpcError, RpcRequestError } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  chainHealth,
  errorLine,
  errorName,
  failureLine,
  failureName,
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
  }
  const indexer: IndexerHealth = {
    collections: 2,
    behind: 1,
    block: 119,
    lastPassAt: '2026-10-16T12:00:01.000Z',
    failedPasses: 3,
    lastError: 'IndexerWriteError',
    unpaired: 1,
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
    ])
  })
})
