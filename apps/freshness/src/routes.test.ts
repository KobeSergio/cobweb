import { statePath, walletPath } from '@cobweb/shared'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import type { HealthBody } from './health.ts'
import {
  healthAnswer,
  PREFLIGHT,
  refusal,
  routeOf,
  stateAnswer,
  walletAnswer,
  type Answer,
  type Route,
} from './routes.ts'
import type { StateBody } from './state-body.ts'
import type { WalletBody } from './wallet.ts'

const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const W: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const lower = (address: Address) => address.toLowerCase()

describe('routeOf (docs/specs/2026-10-16-freshness-server.md, section 6.7)', () => {
  it('routes the paths the mint page builds with the shared package (docs/specs/2026-10-16-mint-page-live-data.md, section 5)', () => {
    expect(routeOf('GET', statePath(31337, A))).toEqual<Route>({ kind: 'state', chainId: 31337, address: A })
    expect(routeOf('GET', walletPath(31337, A, W))).toEqual<Route>({
      kind: 'wallet',
      chainId: 31337,
      address: A,
      wallet: W,
    })
  })

  it('routes the state, wallet and health paths, HEAD as GET, and the preflight', () => {
    expect(routeOf('GET', `/v1/state/31337/${lower(A)}`)).toEqual<Route>({
      kind: 'state',
      chainId: 31337,
      address: A,
    })
    expect(routeOf('HEAD', `/v1/state/1/${A}?poll=1`)).toEqual<Route>({
      kind: 'state',
      chainId: 1,
      address: A,
    })
    expect(routeOf('GET', `/v1/wallet/8453/${lower(A)}/${lower(W)}`)).toEqual<Route>({
      kind: 'wallet',
      chainId: 8453,
      address: A,
      wallet: W,
    })
    expect(routeOf('GET', '/health')).toEqual<Route>({ kind: 'health' })
    expect(routeOf('HEAD', '/health')).toEqual<Route>({ kind: 'health' })
    expect(routeOf('OPTIONS', `/v1/state/31337/${lower(A)}`)).toEqual<Route>({ kind: 'preflight' })
    expect(routeOf('OPTIONS', `/v1/wallet/31337/${lower(A)}/${lower(W)}`)).toEqual<Route>({
      kind: 'preflight',
    })
  })

  it('refuses chain ids 0, -1, 1.5, 01 and letters', () => {
    for (const chainId of ['0', '-1', '1.5', '01', 'base', '1e3', '99999999999999999999'])
      expect(routeOf('GET', `/v1/state/${chainId}/${lower(A)}`)).toEqual<Route>({
        kind: 'refused',
        status: 400,
        error: 'bad-request',
      })
  })

  it('accepts a lowercase, uppercase or correctly checksummed address, and answers it checksummed', () => {
    const upper = `0x${A.slice(2).toUpperCase()}` as Address
    for (const address of [lower(A), A, upper])
      expect(routeOf('GET', `/v1/wallet/31337/${address}/${lower(W)}`)).toMatchObject({
        address: A,
        wallet: W,
      })
  })

  it('refuses a wrong checksum and 39 or 41 digits, in the collection or the wallet', () => {
    // One letter's case flipped: mixed case with a wrong checksum.
    const wrongChecksum = A.replace('C375', 'c375')
    for (const path of [
      `/v1/state/31337/${wrongChecksum}`,
      `/v1/state/31337/${lower(A).slice(0, -1)}`,
      `/v1/state/31337/${lower(A)}0`,
      `/v1/state/31337/${lower(A).slice(2)}`,
      `/v1/wallet/31337/${lower(A)}/${W.replace('70997970C5', '70997970c5')}`,
      `/v1/wallet/31337/${lower(A)}/${lower(W)}0`,
    ])
      expect(routeOf('GET', path)).toEqual<Route>({ kind: 'refused', status: 400, error: 'bad-request' })
  })

  it('answers 404 for any other path, / included, and 405 for other methods', () => {
    for (const path of [
      '/',
      '/v1',
      '/v1/state/31337',
      `/v1/state/31337/${lower(A)}/`,
      `/v1/collection/31337/${lower(A)}`,
      `/v2/state/31337/${lower(A)}`,
      '/health/',
    ])
      expect(routeOf('GET', path)).toEqual<Route>({ kind: 'refused', status: 404, error: 'not-found' })
    expect(routeOf('OPTIONS', '/nowhere')).toEqual<Route>({
      kind: 'refused',
      status: 404,
      error: 'not-found',
    })
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', undefined])
      expect(routeOf(method, `/v1/state/31337/${lower(A)}`)).toEqual<Route>({
        kind: 'refused',
        status: 405,
        error: 'method-not-allowed',
      })
  })

  it('routes the raw target, so an authority, a dot segment, a backslash or no leading slash answers 404', () => {
    for (const target of [
      '//',
      '//[',
      '//a:99999',
      '//%',
      '//@',
      `//x/v1/state/31337/${lower(A)}`,
      `/v1/state/../state/31337/${lower(A)}`,
      `/v1/state/%2e%2e/state/31337/${lower(A)}`,
      `/v1\\state/31337/${lower(A)}`,
      `http://freshness.example/v1/state/31337/${lower(A)}`,
      '*',
    ])
      expect(routeOf('GET', target)).toEqual<Route>({ kind: 'refused', status: 404, error: 'not-found' })
  })

  it('answers the preflight on /health too', () => {
    expect(routeOf('OPTIONS', '/health')).toEqual<Route>({ kind: 'preflight' })
    expect(PREFLIGHT.status).toBe(204)
  })
})

describe('the answers', () => {
  it('give each refusal its code, CORS, and the 4xx edge cache or a 503 retry', () => {
    expect(refusal(404, 'not-a-collection')).toEqual({
      status: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'ETag, Retry-After, Age',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=10',
      },
      body: '{"error":"not-a-collection"}',
    })
    expect(refusal(405, 'method-not-allowed').headers).toMatchObject({ Allow: 'GET, HEAD, OPTIONS' })
    expect(refusal(503, 'not-read-yet')).toEqual({
      status: 503,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'ETag, Retry-After, Age',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '1',
      },
      body: '{"error":"not-read-yet"}',
    })
  })

  it('give the state its tag and edge cache, with the body on a 200 and none on a 304', () => {
    const body = { chainId: 31337 } as StateBody
    const headers = {
      ETag: 'W/"tag"',
      'Cache-Control': 'public, max-age=0, s-maxage=1, stale-while-revalidate=1, stale-if-error=60',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'ETag, Retry-After, Age',
    }
    expect(stateAnswer(body, 'W/"tag"', false)).toEqual({
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
      body: '{"chainId":31337}',
    })
    expect(stateAnswer(body, 'W/"tag"', true)).toEqual({ status: 304, headers, body: null })
  })

  it('give a wallet 5 s at the edge, /health no-store, and the preflight its CORS headers', () => {
    expect(walletAnswer({ chainId: 31337 } as WalletBody).headers).toEqual({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'ETag, Retry-After, Age',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=5',
    })
    expect(healthAnswer({ status: 'ok' } as HealthBody)).toEqual({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: '{"status":"ok"}',
    })
    expect(PREFLIGHT).toEqual({
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'ETag, Retry-After, Age',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'If-None-Match',
        'Access-Control-Max-Age': '86400',
      },
      body: null,
    })
  })

  it('give the 500 internal no-store and Retry-After 1, with CORS', () => {
    expect(refusal(500, 'internal')).toEqual({
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'ETag, Retry-After, Age',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '1',
      },
      body: '{"error":"internal"}',
    })
  })

  it('give a 400 the 4xx edge cache and CORS, with no Allow and no Retry-After', () => {
    expect(refusal(400, 'bad-request')).toEqual({
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'ETag, Retry-After, Age',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=10',
      },
      body: '{"error":"bad-request"}',
    })
  })

  it("expose the ETag, Retry-After and Age to a page's script on every answer that allows its origin", () => {
    const answers: Answer[] = [
      refusal(400, 'bad-request'),
      refusal(404, 'not-found'),
      refusal(405, 'method-not-allowed'),
      refusal(500, 'internal'),
      refusal(503, 'busy'),
      stateAnswer({ chainId: 31337 } as StateBody, 'W/"tag"', false),
      stateAnswer({ chainId: 31337 } as StateBody, 'W/"tag"', true),
      walletAnswer({ chainId: 31337 } as WalletBody),
      PREFLIGHT,
    ]
    for (const answer of answers)
      expect(answer.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'ETag, Retry-After, Age',
      })
  })
})
