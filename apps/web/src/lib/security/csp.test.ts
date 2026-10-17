import { availableChains, LAUNCH_CHAINS } from '@cobweb/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipfsGateway, mediaBase } from '@/lib/mint/page-urls'
import {
  CSP_REPORT_PATH,
  cspHeaders,
  cspModeOf,
  cspSourcesOf,
  DEV_WALLET_ORIGIN,
  FRAME_POLICY,
  METAMASK_ORIGINS,
  newNonce,
  originOf,
  pagePolicy,
  routeClassOf,
  TURNSTILE_ORIGIN,
  WALLET_CONNECT_ORIGINS,
  type CspSources,
} from './csp'

// The storage config the media base reads carries the server marker; RainbowKit builds its config when
// lib/wagmi.ts loads, and this test reads only its chains.
vi.mock('server-only', () => ({}))
vi.mock('@rainbow-me/rainbowkit', () => ({ getDefaultConfig: (parameters: unknown) => parameters }))

const NONCE = 'bm9uY2Utb2YtdGhlLXRlc3Q='

/** A production deploy's sources: everything on https, on Vercel, no site key. */
const PRODUCTION: CspSources = {
  supabase: 'https://abcdefghijklmnopqrst.supabase.co',
  freshness: 'https://fresh.cobweb.example',
  storage: 'https://account.r2.cloudflarestorage.com',
  media: 'https://media.cobweb.example',
  gateway: 'https://cobweb.myfilebase.com',
  rpcs: ['https://mainnet.base.org', 'https://arb1.arbitrum.io'],
  turnstile: false,
  development: false,
  local: false,
  host: 'cobweb.example',
}

/** The policy's directives by name. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((entry) => {
      const [name = '', ...values] = entry.split(' ')
      return [name, values]
    }),
  )
}

describe('cspModeOf (docs/specs/2026-10-17-production-hardening.md, decision 14)', () => {
  it('reads each mode CSP_MODE names, on Vercel or off it', () => {
    for (const mode of ['enforce', 'report-only', 'off'] as const) {
      expect(cspModeOf({ CSP_MODE: mode })).toBe(mode)
      expect(cspModeOf({ CSP_MODE: mode, VERCEL: '1' })).toBe(mode)
    }
  })

  it('reads unset or unknown as report-only on Vercel and enforce off it', () => {
    expect(cspModeOf({})).toBe('enforce')
    expect(cspModeOf({ VERCEL: '1' })).toBe('report-only')
    expect(cspModeOf({ CSP_MODE: 'strict' })).toBe('enforce')
    expect(cspModeOf({ CSP_MODE: 'ENFORCE', VERCEL: '1' })).toBe('report-only')
    expect(cspModeOf({ CSP_MODE: '' })).toBe('enforce')
  })
})

describe('routeClassOf', () => {
  it('reads /api and below as api, everything else as a page', () => {
    expect(['/api', '/api/csp-report', '/api/uploads/x'].map(routeClassOf)).toEqual(['api', 'api', 'api'])
    expect(['/', '/collections', '/night-owls', '/apiary', '/api-docs'].map(routeClassOf)).toEqual([
      'page',
      'page',
      'page',
      'page',
      'page',
    ])
  })
})

describe('originOf', () => {
  it('answers the origin of a URL with a path, and null for a blank or unparsable value', () => {
    expect(originOf('https://abc.supabase.co/storage/v1/s3')).toBe('https://abc.supabase.co')
    expect(originOf('http://127.0.0.1:55321/')).toBe('http://127.0.0.1:55321')
    expect(originOf(' https://fresh.example ')).toBe('https://fresh.example')
    for (const value of [undefined, '', '  ', 'not a url', '127.0.0.1:3100', 'data:image/png;base64,AA'])
      expect(originOf(value)).toBeNull()
  })
})

describe('cspSourcesOf (decision 12)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    NEXT_PUBLIC_FRESHNESS_URL: 'https://fresh.cobweb.example/',
    ART_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    MINT_PAGE_MEDIA_URL: 'https://media.cobweb.example/pages',
    IPFS_GATEWAY_URL: 'https://cobweb.myfilebase.com/ipfs',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    NODE_ENV: 'production',
    VERCEL: '1',
  }

  it('reads each variable as its origin', () => {
    expect(cspSourcesOf(env, [], 'cobweb.example')).toEqual({
      supabase: 'https://abcdefghijklmnopqrst.supabase.co',
      freshness: 'https://fresh.cobweb.example',
      storage: 'https://account.r2.cloudflarestorage.com',
      media: 'https://media.cobweb.example',
      gateway: 'https://cobweb.myfilebase.com',
      rpcs: [],
      turnstile: true,
      development: false,
      local: false,
      host: 'cobweb.example',
    })
  })

  it('falls back as the app does: media on the Supabase origin, the gateway on ipfs.io, the rest absent', () => {
    expect(
      cspSourcesOf({ NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL }, [], 'localhost:3000'),
    ).toEqual({
      supabase: 'https://abcdefghijklmnopqrst.supabase.co',
      freshness: null,
      storage: null,
      media: 'https://abcdefghijklmnopqrst.supabase.co',
      gateway: 'https://ipfs.io',
      rpcs: [],
      turnstile: false,
      development: false,
      local: true,
      host: 'localhost:3000',
    })
    expect(
      cspSourcesOf({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '  ', NODE_ENV: 'development' }, [], 'h').turnstile,
    ).toBe(false)
    expect(cspSourcesOf({ NODE_ENV: 'development' }, [], 'h').development).toBe(true)
  })

  it('matches the origins of mediaBase() and ipfsGateway() under the same settings, set or not', () => {
    for (const settings of [env, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' }]) {
      for (const name of ['MINT_PAGE_MEDIA_URL', 'IPFS_GATEWAY_URL', 'NEXT_PUBLIC_SUPABASE_URL'] as const)
        vi.stubEnv(name, (settings as Record<string, string | undefined>)[name] ?? '')
      const sources = cspSourcesOf(settings, [], 'h')
      expect(sources.media).toBe(new URL(mediaBase()).origin)
      expect(sources.gateway).toBe(new URL(ipfsGateway()).origin)
    }
  })

  it("lists the RPC origin of every chain lib/wagmi.ts's transports call, once each", async () => {
    const { chains } = await import('@/lib/wagmi')
    const { rpcs } = cspSourcesOf({}, availableChains(), 'h')
    for (const chain of chains) expect(rpcs).toContain(new URL(chain.rpcUrls.default.http[0]!).origin)
    expect(new Set(rpcs).size).toBe(rpcs.length)
  })

  it('lists the test chains only where they are shown', () => {
    const anvil = 'http://127.0.0.1:8545'
    expect(cspSourcesOf({}, availableChains(false), 'h').rpcs).toContain(anvil)
    expect(cspSourcesOf({}, availableChains(true), 'h').rpcs).not.toContain(anvil)
    expect(cspSourcesOf({}, availableChains(true), 'h').rpcs).toHaveLength(LAUNCH_CHAINS.length)
  })
})

describe('pagePolicy (section 5.2)', () => {
  it('writes every directive in order for a production deploy enforced on Vercel', () => {
    const rpcs = PRODUCTION.rpcs.join(' ')
    const wallets = [...WALLET_CONNECT_ORIGINS, ...METAMASK_ORIGINS].join(' ')
    expect(pagePolicy(NONCE, PRODUCTION, 'enforce')).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https://account.r2.cloudflarestorage.com https://media.cobweb.example https://cobweb.myfilebase.com",
        "font-src 'self' https://fonts.gstatic.com",
        `connect-src 'self' https://abcdefghijklmnopqrst.supabase.co https://fresh.cobweb.example https://account.r2.cloudflarestorage.com https://cobweb.myfilebase.com ${rpcs} ${wallets}`,
        'frame-src https://verify.walletconnect.org https://verify.walletconnect.com',
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
        `report-uri ${CSP_REPORT_PATH}`,
        'report-to csp',
      ].join('; '),
    )
  })

  it('carries the nonce in script-src alone, never in style-src', () => {
    const policy = pagePolicy(NONCE, PRODUCTION, 'enforce')
    expect(policy.split(NONCE)).toHaveLength(2)
    expect(directives(policy).get('script-src')).toContain(`'nonce-${NONCE}'`)
    expect(
      directives(policy)
        .get('style-src')!
        .some((source) => source.startsWith("'nonce-")),
    ).toBe(false)
  })

  it("adds 'unsafe-eval' and the dev server's websocket only in development", () => {
    const production = directives(pagePolicy(NONCE, PRODUCTION, 'enforce'))
    expect(production.get('script-src')).not.toContain("'unsafe-eval'")
    expect(production.get('connect-src')!.some((source) => source.startsWith('ws://'))).toBe(false)
    const development = directives(pagePolicy(NONCE, { ...PRODUCTION, development: true }, 'enforce'))
    expect(development.get('script-src')).toContain("'unsafe-eval'")
    expect(development.get('connect-src')).toContain('ws://cobweb.example')
  })

  it("adds the dev wallet's signer only off Vercel", () => {
    expect(directives(pagePolicy(NONCE, PRODUCTION, 'enforce')).get('connect-src')).not.toContain(
      DEV_WALLET_ORIGIN,
    )
    expect(
      directives(pagePolicy(NONCE, { ...PRODUCTION, local: true }, 'enforce')).get('connect-src'),
    ).toContain(DEV_WALLET_ORIGIN)
  })

  it('upgrades insecure requests only when enforced on Vercel', () => {
    const upgrades = (sources: CspSources, mode: 'enforce' | 'report-only') =>
      directives(pagePolicy(NONCE, sources, mode)).has('upgrade-insecure-requests')
    expect(upgrades(PRODUCTION, 'enforce')).toBe(true)
    expect(upgrades(PRODUCTION, 'report-only')).toBe(false)
    expect(upgrades({ ...PRODUCTION, local: true }, 'enforce')).toBe(false)
  })

  it("names Cloudflare's script and frame only with a site key", () => {
    const without = directives(pagePolicy(NONCE, PRODUCTION, 'enforce'))
    expect([...without.get('script-src')!, ...without.get('frame-src')!]).not.toContain(TURNSTILE_ORIGIN)
    const withKey = directives(pagePolicy(NONCE, { ...PRODUCTION, turnstile: true }, 'enforce'))
    expect(withKey.get('script-src')).toContain(TURNSTILE_ORIGIN)
    expect(withKey.get('frame-src')).toContain(TURNSTILE_ORIGIN)
  })

  it('lists each source once, and the local services that answer over http for images and media', () => {
    const local: CspSources = {
      supabase: 'http://127.0.0.1:55321',
      freshness: 'http://127.0.0.1:3100',
      storage: 'http://127.0.0.1:55321',
      media: 'http://127.0.0.1:55321',
      gateway: 'https://ipfs.io',
      rpcs: ['https://mainnet.base.org', 'http://127.0.0.1:8545', 'https://mainnet.base.org'],
      turnstile: false,
      development: true,
      local: true,
      host: 'localhost:3000',
    }
    for (const [name, sources] of directives(pagePolicy(NONCE, local, 'enforce')))
      expect(new Set(sources).size, name).toBe(sources.length)
    const policy = directives(pagePolicy(NONCE, local, 'enforce'))
    expect(policy.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:', 'http://127.0.0.1:55321'])
    expect(policy.get('media-src')).toEqual(["'self'", 'blob:', 'http://127.0.0.1:55321', 'https://ipfs.io'])
  })
})

describe('cspHeaders (section 5.2)', () => {
  const input = { nonce: NONCE, sources: PRODUCTION, reportOrigin: 'https://cobweb.example' }
  const policy = pagePolicy(NONCE, PRODUCTION, 'enforce')
  const reportOnly = pagePolicy(NONCE, PRODUCTION, 'report-only')
  const reporting = `csp="https://cobweb.example${CSP_REPORT_PATH}"`

  it('puts the enforced policy on a page request and its response', () => {
    expect(cspHeaders({ ...input, mode: 'enforce', routeClass: 'page' })).toEqual({
      request: { 'content-security-policy': policy, 'x-nonce': NONCE },
      response: { 'Content-Security-Policy': policy, 'Reporting-Endpoints': reporting },
    })
  })

  it('puts the report-only policy on a page request and its response, with no enforced policy', () => {
    expect(cspHeaders({ ...input, mode: 'report-only', routeClass: 'page' })).toEqual({
      request: { 'content-security-policy-report-only': reportOnly, 'x-nonce': NONCE },
      response: { 'Content-Security-Policy-Report-Only': reportOnly, 'Reporting-Endpoints': reporting },
    })
  })

  it('answers the framing policy alone for a page when off, and for an API route in every mode', () => {
    const framing = { request: {}, response: { 'Content-Security-Policy': FRAME_POLICY } }
    expect(cspHeaders({ ...input, mode: 'off', routeClass: 'page' })).toEqual(framing)
    for (const mode of ['enforce', 'report-only', 'off'] as const)
      expect(cspHeaders({ ...input, mode, routeClass: 'api' })).toEqual(framing)
  })

  it('never carries the framing policy alone on the request, where Next would find no nonce', () => {
    for (const mode of ['enforce', 'report-only', 'off'] as const)
      for (const routeClass of ['page', 'api'] as const)
        for (const value of Object.values(cspHeaders({ ...input, mode, routeClass }).request))
          expect(value).not.toBe(FRAME_POLICY)
  })
})

describe('newNonce', () => {
  it('answers 24 base64 characters, a new one each call', () => {
    const first = newNonce()
    expect(first).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(newNonce()).not.toBe(first)
  })
})
