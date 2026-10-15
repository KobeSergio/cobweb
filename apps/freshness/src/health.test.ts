import { BaseError, HttpRequestError, LimitExceededRpcError, RpcRequestError } from 'viem'
import { describe, expect, it } from 'vitest'
import { errorLine, errorName, failureLine } from './health.ts'

/** An RPC URL as a provider issues it, its key in the path. */
const KEYED_URL = 'https://rpc.example/v2/secret-key'

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
    expect(failureLine(new LimitExceededRpcError(rateLimit()))).toBe(
      'RpcRequestError (-32005): RPC Request failed.',
    )
  })
})
