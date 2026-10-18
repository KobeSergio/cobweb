import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FRAME_POLICY } from '@/lib/security/csp'
import { config, proxy } from './proxy'

/** The cookie writer the proxy hands Supabase's client, which `getClaims` calls on a refresh. */
type SetAll = (
  cookies: { name: string; value: string; options: Record<string, unknown> }[],
  headers: Record<string, string>,
) => void

const mocks = vi.hoisted(() => ({
  setAll: null as SetAll | null,
  getClaims: vi.fn(async () => ({ data: null, error: null })),
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: SetAll } }) => {
    mocks.setAll = options.cookies.setAll
    return { auth: { getClaims: mocks.getClaims } }
  },
}))

const ORIGIN = 'https://cobweb.test'
const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`${ORIGIN}${path}`, { headers })

/** The nonce a policy's script-src carries, or null. */
const nonceOf = (policy: string | null) => policy?.match(/'nonce-([^']+)'/)?.[1] ?? null

/** The request headers the response forwards to the render, as Next reads them. */
const forwarded = (response: Response, name: string) => response.headers.get(`x-middleware-request-${name}`)

describe('proxy (docs/specs/2026-10-17-production-hardening.md, section 5.3)', () => {
  beforeEach(() => {
    // Unset whatever the shell says; each test that needs a mode stubs its own.
    vi.stubEnv('CSP_MODE', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    vi.stubEnv('VERCEL', '1')
    mocks.getClaims.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('enforces the page policy, forwarding it to the render with the nonce its response carries', async () => {
    vi.stubEnv('CSP_MODE', 'enforce')
    const response = await proxy(request('/night-owls'))
    const policy = response.headers.get('Content-Security-Policy')
    const nonce = nonceOf(policy)
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(policy).toContain('upgrade-insecure-requests')
    expect(response.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
    expect(response.headers.get('Reporting-Endpoints')).toBe(`csp="${ORIGIN}/api/csp-report"`)
    expect(forwarded(response, 'content-security-policy')).toBe(policy)
    expect(forwarded(response, 'x-nonce')).toBe(nonce)
    expect(forwarded(response, 'content-security-policy-report-only')).toBeNull()
  })

  it('names report-to and Reporting-Endpoints only on https, so a local http server reports through report-uri', async () => {
    vi.stubEnv('CSP_MODE', 'enforce')
    expect((await proxy(request('/night-owls'))).headers.get('Content-Security-Policy')).toContain(
      '; report-to csp',
    )
    const plain = await proxy(new NextRequest('http://localhost:3210/night-owls'))
    const policy = plain.headers.get('Content-Security-Policy')
    expect(policy).toContain('report-uri /api/csp-report')
    expect(policy).not.toContain('report-to')
    expect(plain.headers.get('Reporting-Endpoints')).toBeNull()
    expect(forwarded(plain, 'content-security-policy')).toBe(policy)
  })

  it('reports in report-only mode with no enforced policy, which Next would copy into the request', async () => {
    vi.stubEnv('CSP_MODE', 'report-only')
    const response = await proxy(request('/'))
    const policy = response.headers.get('Content-Security-Policy-Report-Only')
    expect(response.headers.get('Content-Security-Policy')).toBeNull()
    expect(policy).toContain("'strict-dynamic'")
    expect(policy).not.toContain('upgrade-insecure-requests')
    expect(forwarded(response, 'content-security-policy-report-only')).toBe(policy)
    expect(forwarded(response, 'x-nonce')).toBe(nonceOf(policy))
    expect(forwarded(response, 'content-security-policy')).toBeNull()
  })

  it('reads unset as report-only on Vercel and enforce off it', async () => {
    expect((await proxy(request('/'))).headers.get('Content-Security-Policy-Report-Only')).toContain(
      "'nonce-",
    )
    vi.stubEnv('VERCEL', '')
    expect(nonceOf((await proxy(request('/'))).headers.get('Content-Security-Policy'))).not.toBeNull()
  })

  it('keeps the framing policy alone when off, and for an API route in every mode, forwarding no policy', async () => {
    const cases: [string, string][] = [
      ['off', '/collections'],
      ['enforce', '/api/uploads/x'],
      ['report-only', '/api/uploads/x'],
      ['off', '/api/uploads/x'],
    ]
    for (const [mode, path] of cases) {
      vi.stubEnv('CSP_MODE', mode)
      const response = await proxy(request(path))
      expect(response.headers.get('Content-Security-Policy')).toBe(FRAME_POLICY)
      expect(response.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
      expect(response.headers.get('Reporting-Endpoints')).toBeNull()
      expect(forwarded(response, 'content-security-policy')).toBeNull()
      expect(forwarded(response, 'x-nonce')).toBeNull()
    }
  })

  it("replaces a client's own policy and nonce, so no client chooses the nonce Next applies", async () => {
    const chosen = {
      'content-security-policy': "script-src 'nonce-Y2hvc2Vu'",
      'content-security-policy-report-only': "script-src 'nonce-Y2hvc2Vu'",
      'x-nonce': 'Y2hvc2Vu',
    }
    vi.stubEnv('CSP_MODE', 'enforce')
    const page = await proxy(request('/', chosen))
    const nonce = nonceOf(page.headers.get('Content-Security-Policy'))
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(nonceOf(forwarded(page, 'content-security-policy'))).toBe(nonce)
    expect(forwarded(page, 'x-nonce')).toBe(nonce)
    expect(forwarded(page, 'content-security-policy-report-only')).toBeNull()
    const api = await proxy(request('/api/uploads/x', chosen))
    for (const name of Object.keys(chosen)) expect(forwarded(api, name)).toBeNull()
  })

  it('makes a new nonce for every request and refreshes the session once each', async () => {
    vi.stubEnv('CSP_MODE', 'enforce')
    const first = nonceOf((await proxy(request('/'))).headers.get('Content-Security-Policy'))
    const second = nonceOf((await proxy(request('/'))).headers.get('Content-Security-Policy'))
    expect(first).not.toBe(second)
    expect(mocks.getClaims).toHaveBeenCalledTimes(2)
  })

  it('keeps the policy and its nonce on the response that carries a refreshed session', async () => {
    vi.stubEnv('CSP_MODE', 'enforce')
    const cache = 'private, no-cache, no-store, must-revalidate, max-age=0'
    mocks.getClaims.mockImplementationOnce(async () => {
      mocks.setAll!([{ name: 'sb-test-auth-token', value: 'refreshed', options: { path: '/' } }], {
        'Cache-Control': cache,
      })
      return { data: null, error: null }
    })
    const response = await proxy(request('/collections'))
    const policy = response.headers.get('Content-Security-Policy')
    const nonce = nonceOf(policy)
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(response.headers.get('Reporting-Endpoints')).toBe(`csp="${ORIGIN}/api/csp-report"`)
    expect(forwarded(response, 'content-security-policy')).toBe(policy)
    expect(forwarded(response, 'x-nonce')).toBe(nonce)
    expect(forwarded(response, 'cookie')).toBe('sb-test-auth-token=refreshed')
    expect(response.cookies.get('sb-test-auth-token')?.value).toBe('refreshed')
    expect(response.headers.get('Cache-Control')).toBe(cache)
  })
})

describe("the proxy's matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url })

  it('admits pages and API routes, and skips static files and the report endpoint', () => {
    for (const url of ['/', '/collections', '/night-owls', '/api/uploads/x'])
      expect(matches(url), url).toBe(true)
    for (const url of ['/_next/static/x.js', '/demo/tokens/1.svg', '/api/csp-report'])
      expect(matches(url), url).toBe(false)
  })

  it('admits a page path ending in an image extension, and skips the demo art, the icon and the report endpoint', () => {
    for (const url of ['/x.png', '/a/b.png']) expect(matches(url), url).toBe(true)
    for (const url of ['/demo/tokens/1.svg', '/icon.svg', '/api/csp-report'])
      expect(matches(url), url).toBe(false)
  })

  it('admits a mint page link or a path that only starts like a skipped file, and skips each file by its full name', () => {
    for (const url of [
      '/favicon-icons',
      '/favicon-ico',
      '/icon-svg',
      '/api/csp-reports',
      '/demo/preview',
      '/assets',
      '/assets/x',
    ])
      expect(matches(url), url).toBe(true)
    for (const url of ['/favicon.ico', '/assets/logo.png', '/assets/icon.svg', '/demo/sample.png'])
      expect(matches(url), url).toBe(false)
  })
})
