import type { ChainConfig } from '@cobweb/shared'

/**
 * The Content-Security-Policy (docs/specs/2026-10-17-production-hardening.md, section 5.2), pure: the proxy
 * works out the mode, the route's class, a nonce and the sources for each request, and this module writes the
 * headers. Scripts run only with the response's nonce (`'strict-dynamic'` admits what a nonced script inserts);
 * every origin the browser calls is read from the settings the app itself reads, never from a hand list. No
 * value here is a secret: each one reaches the browser anyway.
 */

export type CspMode = 'enforce' | 'report-only' | 'off'
export type RouteClass = 'page' | 'api'
export type CspEnv = Record<string, string | undefined>
export type CspSources = {
  supabase: string | null
  freshness: string | null
  storage: string | null
  media: string | null
  gateway: string
  rpcs: string[]
  turnstile: boolean
  development: boolean
  local: boolean
  host: string
}

export const CSP_REPORT_PATH = '/api/csp-report'
export const FRAME_POLICY = "frame-ancestors 'none'"
/** The dev wallet's signer (apps/web/scripts/dev-wallet), which its injected provider fetches from the page. */
export const DEV_WALLET_ORIGIN = 'http://127.0.0.1:8787'
/** Cloudflare Turnstile's script and frame. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

/**
 * WalletConnect's relay, RPC, events and Verify, and the wallet list RainbowKit 2.2.11's WalletConnect option
 * opens: `@walletconnect/core` and `@walletconnect/ethereum-provider` 2.21.1 and `@reown/appkit` 1.7.8. Verify
 * loads its attestation in a hidden frame. An upgrade of any of them reads its hosts again.
 */
export const WALLET_CONNECT_ORIGINS: readonly string[] = [
  'https://rpc.walletconnect.org',
  'wss://relay.walletconnect.org',
  'https://pulse.walletconnect.org',
  'https://api.web3modal.org',
  'https://verify.walletconnect.org',
  'https://verify.walletconnect.com',
]

/**
 * MetaMask's SDK, which RainbowKit's MetaMask option uses with the extension or on a phone: `@metamask/sdk` 0.33.1.
 * An upgrade reads its hosts again.
 */
export const METAMASK_ORIGINS: readonly string[] = [
  'https://metamask-sdk.api.cx.metamask.io',
  'wss://metamask-sdk.api.cx.metamask.io',
  'https://mm-sdk-analytics.api.cx.metamask.io',
]

const MODES: readonly CspMode[] = ['enforce', 'report-only', 'off']

/** `CSP_MODE` when it is one of the three; unset (or unknown), report-only on Vercel and enforce off it. */
export function cspModeOf(env: CspEnv): CspMode {
  const mode = env.CSP_MODE as CspMode | undefined
  if (mode && MODES.includes(mode)) return mode
  return env.VERCEL === '1' ? 'report-only' : 'enforce'
}

/** `api` for /api and below, `page` for everything else. */
export function routeClassOf(pathname: string): RouteClass {
  return pathname === '/api' || pathname.startsWith('/api/') ? 'api' : 'page'
}

/** A URL's origin, or null for a blank or unparsable value or one with no origin (a `data:` URL). */
export function originOf(url: string | undefined): string | null {
  if (!url?.trim()) return null
  try {
    const { origin } = new URL(url.trim())
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

/**
 * The origins the browser calls, from the settings the app reads: Supabase, the freshness server, the storage
 * endpoint (path style keeps every presigned URL on it), the mint page's media (`mediaBase()`'s default is the
 * Supabase origin), the IPFS gateway (`ipfsGateway()`'s default is ipfs.io) and each available chain's public RPC,
 * which wagmi's `http()` calls.
 */
export function cspSourcesOf(env: CspEnv, chains: readonly ChainConfig[], host: string): CspSources {
  const supabase = originOf(env.NEXT_PUBLIC_SUPABASE_URL)
  const rpcs = chains.flatMap((chain) => {
    const origin = originOf(chain.viem.rpcUrls.default.http[0])
    return origin ? [origin] : []
  })
  return {
    supabase,
    freshness: originOf(env.NEXT_PUBLIC_FRESHNESS_URL),
    storage: originOf(env.ART_S3_ENDPOINT),
    media: originOf(env.MINT_PAGE_MEDIA_URL) ?? supabase,
    gateway: originOf(env.IPFS_GATEWAY_URL) ?? 'https://ipfs.io',
    rpcs: [...new Set(rpcs)],
    turnstile: Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
    development: env.NODE_ENV === 'development',
    local: env.VERCEL !== '1',
    host,
  }
}

/** A directive with its sources in order, each once, null ones left out. */
function directive(name: string, sources: readonly (string | null | false)[]): string {
  const kept = sources.filter((source): source is string => typeof source === 'string' && source.length > 0)
  return [name, ...new Set(kept)].join(' ')
}

/**
 * The page policy, its directives in the spec's order. Images may come from any https host (the ruling on the
 * spec's section 14, point 4: an image cannot run script, and a creator's metadata may put token art on any host),
 * and from the storage, media and gateway origins when one answers over http, as the local services do. Styles
 * allow inline, since RainbowKit, sonner and AppKit write style elements without a nonce (decision 11).
 */
export function pagePolicy(nonce: string, sources: CspSources, mode: 'enforce' | 'report-only'): string {
  const plain = [sources.storage, sources.media, sources.gateway].filter(
    (origin): origin is string => origin !== null && origin.startsWith('http:'),
  )
  return [
    "default-src 'self'",
    directive('script-src', [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      sources.turnstile && TURNSTILE_ORIGIN,
      sources.development && "'unsafe-eval'",
    ]),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    directive('img-src', ["'self'", 'data:', 'blob:', 'https:', ...plain]),
    directive('media-src', ["'self'", 'blob:', sources.storage, sources.media, sources.gateway]),
    "font-src 'self' https://fonts.gstatic.com",
    directive('connect-src', [
      "'self'",
      sources.supabase,
      sources.freshness,
      sources.storage,
      sources.gateway,
      ...sources.rpcs,
      ...WALLET_CONNECT_ORIGINS,
      ...METAMASK_ORIGINS,
      sources.local && DEV_WALLET_ORIGIN,
      sources.development && `ws://${sources.host}`,
    ]),
    directive('frame-src', [
      'https://verify.walletconnect.org',
      'https://verify.walletconnect.com',
      sources.turnstile && TURNSTILE_ORIGIN,
    ]),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    FRAME_POLICY,
    ...(mode === 'enforce' && !sources.local ? ['upgrade-insecure-requests'] : []),
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp',
  ].join('; ')
}

/** 16 random bytes in base64: 24 characters. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

/**
 * The headers for one request. A page in enforce mode: the policy on the request, where Next reads its nonce, and
 * on the response. In report-only mode: the report-only policy on both and no enforced policy, since Next 16.3
 * copies each of the proxy's response headers into the request it renders and reads `content-security-policy`
 * before the report-only header: an enforced `frame-ancestors 'none'` there would leave every script without its
 * nonce. `X-Frame-Options: DENY`, which next.config.ts sets on every path, keeps the framing block in that mode.
 * Off, and for every API route: the framing policy alone. The request never carries the framing policy, where
 * Next would find no nonce.
 */
export function cspHeaders(input: {
  mode: CspMode
  routeClass: RouteClass
  nonce: string
  sources: CspSources
  reportOrigin: string
}): { request: Record<string, string>; response: Record<string, string> } {
  const { mode, routeClass, nonce, sources, reportOrigin } = input
  if (routeClass === 'api' || mode === 'off')
    return { request: {}, response: { 'Content-Security-Policy': FRAME_POLICY } }
  const policy = pagePolicy(nonce, sources, mode)
  const reporting = { 'Reporting-Endpoints': `csp="${reportOrigin}${CSP_REPORT_PATH}"` }
  if (mode === 'enforce')
    return {
      request: { 'content-security-policy': policy, 'x-nonce': nonce },
      response: { 'Content-Security-Policy': policy, ...reporting },
    }
  return {
    request: { 'content-security-policy-report-only': policy, 'x-nonce': nonce },
    response: { 'Content-Security-Policy-Report-Only': policy, ...reporting },
  }
}
