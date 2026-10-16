import type { RefusalCode, StateBody, WalletBody } from '@cobweb/shared'
import { getAddress, type Address } from 'viem'
import type { HealthBody } from './health.ts'

/**
 * The routes and the answers (docs/specs/2026-10-16-freshness-server.md, section 6.7), pure: which path a
 * request names, the refusals as `{ "error": "<code>" }`, and every answer's headers.
 */

/**
 * The refusals' codes live in the shared package with the bodies, so the mint page reads what this writes.
 */
export type { RefusalCode }

export type Route =
  | { kind: 'state'; chainId: number; address: Address }
  | { kind: 'wallet'; chainId: number; address: Address; wallet: Address }
  | { kind: 'health' }
  | { kind: 'preflight' }
  | { kind: 'refused'; status: 400 | 404 | 405; error: RefusalCode }

/** An answer as the server writes it: no body for a 204, a 304, and HEAD. */
export type Answer = { status: number; headers: Record<string, string>; body: string | null }

export const STATE_CACHE = 'public, max-age=0, s-maxage=1, stale-while-revalidate=1, stale-if-error=60'
export const WALLET_CACHE = 'public, max-age=0, s-maxage=5'
export const REFUSAL_CACHE = 'public, max-age=0, s-maxage=10'
const JSON_TYPE = 'application/json; charset=utf-8'
/**
 * CORS on every answer a page's script may read: any origin, with the tag, the retry delay and the edge's age
 * exposed to the script, so a page that sends its own `If-None-Match` can read `ETag`, a refused one
 * `Retry-After`, and any one the `Age` an edge adds.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag, Retry-After, Age',
}
const METHODS = ['GET', 'HEAD', 'OPTIONS']

/** A positive whole number without leading zeros, within the safe integers. */
function chainIdOf(text: string): number | null {
  if (!/^[1-9][0-9]*$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) ? id : null
}

/** `0x` and 40 hex digits, refused in mixed case with a wrong checksum; answered checksummed. */
function addressOf(text: string): Address | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) return null
  const digits = text.slice(2)
  const checksummed = getAddress(text)
  const mixed = digits !== digits.toLowerCase() && digits !== digits.toUpperCase()
  return mixed && checksummed !== text ? null : checksummed
}

const BAD_REQUEST: Route = { kind: 'refused', status: 400, error: 'bad-request' }
const NOT_FOUND: Route = { kind: 'refused', status: 404, error: 'not-found' }

/**
 * The route a request names: `GET /v1/state/{chainId}/{address}`, `GET
 * /v1/wallet/{chainId}/{address}/{wallet}` and `GET /health`, HEAD as GET, OPTIONS as the preflight of a
 * known path; a method other than GET, HEAD and OPTIONS is refused first, then any other path. The route is
 * read from the raw target, its query string cut off and nothing normalized: a target that does not start
 * with `/`, an authority after `//`, a dot segment or a backslash names no route.
 */
export function routeOf(method: string | undefined, url: string | undefined): Route {
  if (!method || !METHODS.includes(method))
    return { kind: 'refused', status: 405, error: 'method-not-allowed' }
  const target = (url ?? '/').split('?')[0] ?? ''
  if (!target.startsWith('/')) return NOT_FOUND
  const path = target.split('/').slice(1)
  const preflight = method === 'OPTIONS'
  if (path.length === 1 && path[0] === 'health') return preflight ? { kind: 'preflight' } : { kind: 'health' }
  const [version, kind, chain, address, wallet] = path
  const state = kind === 'state' && path.length === 4
  const walletPath = kind === 'wallet' && path.length === 5
  if (version !== 'v1' || !(state || walletPath)) return NOT_FOUND
  if (preflight) return { kind: 'preflight' }
  const chainId = chainIdOf(chain ?? '')
  const collection = addressOf(address ?? '')
  if (chainId === null || collection === null) return BAD_REQUEST
  if (state) return { kind: 'state', chainId, address: collection }
  const holder = addressOf(wallet ?? '')
  return holder === null ? BAD_REQUEST : { kind: 'wallet', chainId, address: collection, wallet: holder }
}

/**
 * A refusal: `{ "error": "<code>" }` with CORS; a 4xx also 10 s at the edge (405 with `Allow`), a 503 (or a
 * 500) `Retry-After: 1` and `no-store`.
 */
export function refusal(status: 400 | 404 | 405 | 500 | 503, error: RefusalCode): Answer {
  const headers: Record<string, string> = { ...CORS, 'Content-Type': JSON_TYPE }
  if (status >= 500) {
    headers['Cache-Control'] = 'no-store'
    headers['Retry-After'] = '1'
  } else headers['Cache-Control'] = REFUSAL_CACHE
  if (status === 405) headers.Allow = 'GET, HEAD, OPTIONS'
  return { status, headers, body: JSON.stringify({ error }) }
}

/** The state: 200 with the body, or 304 without one when `If-None-Match` matched, both with the tag. */
export function stateAnswer(body: StateBody, etag: string, notModified: boolean): Answer {
  const headers = { ETag: etag, 'Cache-Control': STATE_CACHE, ...CORS }
  if (notModified) return { status: 304, headers, body: null }
  return { status: 200, headers: { ...headers, 'Content-Type': JSON_TYPE }, body: JSON.stringify(body) }
}

/** A wallet's quotas and vaults: 5 s at the edge, no tag. */
export function walletAnswer(body: WalletBody): Answer {
  return {
    status: 200,
    headers: { ...CORS, 'Content-Type': JSON_TYPE, 'Cache-Control': WALLET_CACHE },
    body: JSON.stringify(body),
  }
}

/** `/health`: always 200, never cached. */
export function healthAnswer(body: HealthBody): Answer {
  return {
    status: 200,
    headers: { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}

/**
 * The CORS preflight a page's request headers can make: its own `If-None-Match`, and the `Cache-Control` and
 * `Pragma` a browser may add to a `no-cache` or `reload` fetch, which every poll is. The Fetch spec adds no
 * preflight for those, but not every engine is walked (WebKit, where most minters are), so they are allowed.
 */
export const PREFLIGHT: Answer = {
  status: 204,
  headers: {
    ...CORS,
    'Access-Control-Allow-Methods': 'GET, HEAD',
    'Access-Control-Allow-Headers': 'If-None-Match, Cache-Control, Pragma',
    'Access-Control-Max-Age': '86400',
  },
  body: null,
}
