import { describe, expect, it } from 'vitest'
import {
  ageOf,
  cacheStatusOf,
  directiveOf,
  EDGE_CHECKS,
  edgeArgsOf,
  injectedIn,
  isWeakEtag,
  judgeCors,
  judgeFirstPoll,
  judgeHealth,
  judgeInjected,
  judgeNotModified,
  judgeOneSecond,
  judgePages,
  judgePolicy,
  judgeQuery,
  judgeSetup,
  judgeStateAtEdge,
  judgeTransport,
  judgeWallet,
  nonceOf,
  pagePolicyOf,
  scriptNonces,
  viaCloudflare,
  type EdgeAnswer,
} from './edge-checks'

const APP = 'https://cobweb.example'
const FRESHNESS = 'https://fresh.cobweb.example'
const ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const STATE_CACHE = 'public, max-age=0, s-maxage=1, stale-while-revalidate=1, stale-if-error=60'
const WALLET_CACHE = 'public, max-age=0, s-maxage=5'
const ETAG = 'W/"5d41402abc4b2a76b9719d911017c592"'
const RAY = '8f1a2b3c4d5e6f70-SIN'
const NONCE = 'q2Vx3f8NoHn2pQb1sZ4tWw=='
const OTHER_NONCE = 'Hk9rT1mZ0aQ7yLc5vB3nXg=='

function answer(status: number, headers: Record<string, string> = {}, body = ''): EdgeAnswer {
  return { status, headers: new Headers(headers), body }
}

/** A state answer from the edge, as Cloudflare passes the origin's headers on. */
function state(cache: string | null, age?: number, extra: Record<string, string> = {}): EdgeAnswer {
  return answer(
    200,
    {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': STATE_CACHE,
      etag: ETAG,
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'ETag, Retry-After, Age',
      'cf-ray': RAY,
      ...(cache === null ? {} : { 'cf-cache-status': cache }),
      ...(age === undefined ? {} : { age: String(age) }),
      ...extra,
    },
    '{"chainId":11155111}',
  )
}

/** The app's page policy, as the proxy writes it on https. */
function policy(nonce: string, freshness = FRESHNESS): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `connect-src 'self' https://umwkpwtkwmdizgndxnjc.supabase.co ${freshness} https://rpc.walletconnect.org`,
    "frame-ancestors 'none'",
    'report-uri /api/csp-report',
    'report-to csp',
  ].join('; ')
}

/** A page's HTML as Next writes it: nonced scripts, a module and a JSON script. */
function html(nonce: string, extra = ''): string {
  return [
    '<!DOCTYPE html><html><head>',
    `<script src="/_next/static/chunks/webpack.js" async="" nonce="${nonce}"></script>`,
    '<script type="application/json" id="__cobweb">{"chains":[1]}</script>',
    '</head><body>',
    `<script nonce="${nonce}">self.__next_f.push([1,""])</script>`,
    `<script type="module" nonce="${nonce}" src="/_next/static/chunks/main.js"></script>`,
    extra,
    '</body></html>',
  ].join('')
}

/** A page from the app through the edge, in enforce mode unless the headers say otherwise; null drops a header. */
function page(nonce: string, headers: Record<string, string | null> = {}, body = html(nonce)): EdgeAnswer {
  const merged: Record<string, string | null> = {
    'content-type': 'text/html; charset=utf-8',
    'cf-cache-status': 'DYNAMIC',
    'cf-ray': RAY,
    'content-security-policy': policy(nonce),
    'reporting-endpoints': `csp="${APP}/api/csp-report"`,
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'strict-transport-security': 'max-age=63072000',
    ...headers,
  }
  const kept = Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== null)
  return answer(200, Object.fromEntries(kept), body)
}

const ROCKET_LOADED = [
  `<script type="a1b2c3d4e5f6a7b8c9d0e1f2-text/javascript" nonce="${NONCE}" src="/_next/static/chunks/main.js"></script>`,
  '<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js" data-cf-settings="a1b2c3d4e5f6a7b8c9d0e1f2-|49" defer></script>',
].join('')
const EMAIL_OBFUSCATED = [
  '<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="1c7479707073">[email&#160;protected]</a>',
  '<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>',
].join('')
const BEACON =
  '<script defer src=\'https://static.cloudflareinsights.com/beacon.min.js\' data-cf-beacon=\'{"token": "0a1b2c"}\'></script>'

describe('edgeArgsOf (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 8.1)', () => {
  const ARGS = ['--app', APP, '--freshness', FRESHNESS, '--collection', `11155111/${ADDRESS}`]

  it("reads the four arguments, the slug optional, keeping the URLs' origins and the address in lower case", () => {
    const read = edgeArgsOf([...ARGS, '--slug', 'night-owls'])
    expect(read?.app.href).toBe(`${APP}/`)
    expect(read?.freshness.href).toBe(`${FRESHNESS}/`)
    expect(read).toMatchObject({ chainId: 11155111, address: ADDRESS.toLowerCase(), slug: 'night-owls' })
    expect(edgeArgsOf(ARGS)?.slug).toBeNull()
    expect(edgeArgsOf(['--app', `${APP}/mint`, ...ARGS.slice(2)])?.app.href).toBe(`${APP}/`)
  })

  it('answers null for a missing argument, an http URL, a malformed collection or slug, or an unknown or repeated flag', () => {
    const unusable: string[][] = [
      [],
      ARGS.slice(2),
      ARGS.slice(0, 4),
      [...ARGS.slice(0, 5)],
      ['--app', 'http://cobweb.example', ...ARGS.slice(2)],
      ['--app', APP, '--freshness', 'http://fresh.cobweb.example', ...ARGS.slice(4)],
      [...ARGS.slice(0, 5), `11155111/${ADDRESS.slice(0, 20)}`],
      [...ARGS.slice(0, 5), ADDRESS],
      [...ARGS, '--slug', 'Night Owls'],
      [...ARGS, '--wallet', ADDRESS],
      [...ARGS, '--app', APP],
    ]
    for (const argv of unusable) expect(edgeArgsOf(argv), argv.join(' ')).toBeNull()
  })
})

describe('the readers (section 8.1)', () => {
  it("reads cf-ray, cf-cache-status and Age on a Cloudflare answer, and none of them on Vercel's own", () => {
    const hit = state('hit', 1)
    expect([viaCloudflare(hit), cacheStatusOf(hit), ageOf(hit)]).toEqual([true, 'HIT', 1])
    const vercel = answer(200, { 'x-vercel-cache': 'MISS', 'x-vercel-id': 'sin1::abc', age: 'soon' })
    expect([viaCloudflare(vercel), cacheStatusOf(vercel), ageOf(vercel)]).toEqual([false, null, null])
  })

  it('tells a weak ETag from a strong one', () => {
    expect([isWeakEtag(ETAG), isWeakEtag('"5d41"'), isWeakEtag('W/5d41'), isWeakEtag(null)]).toEqual([
      true,
      false,
      false,
      false,
    ])
  })

  it("reads each JavaScript script's nonce, a module's among them, leaving a JSON script out", () => {
    expect(scriptNonces(html(NONCE))).toEqual([NONCE, NONCE, NONCE])
  })

  it('reads a Rocket Loader rewrite as a script that keeps its nonce and a loader that has none', () => {
    expect(scriptNonces(ROCKET_LOADED)).toEqual([NONCE, null])
  })

  it('takes the enforced policy, else the report-only one, and null with neither or with the framing policy alone', () => {
    expect(pagePolicyOf(new Headers({ 'content-security-policy': policy(NONCE) }))).toEqual({
      mode: 'enforce',
      policy: policy(NONCE),
    })
    expect(pagePolicyOf(new Headers({ 'content-security-policy-report-only': policy(NONCE) }))).toEqual({
      mode: 'report-only',
      policy: policy(NONCE),
    })
    expect(pagePolicyOf(new Headers())).toBeNull()
    expect(pagePolicyOf(new Headers({ 'content-security-policy': "frame-ancestors 'none'" }))).toBeNull()
  })

  it('reads a directive and the nonce of script-src', () => {
    expect(nonceOf(policy(NONCE))).toBe(NONCE)
    expect(nonceOf("script-src 'self' 'strict-dynamic'")).toBeNull()
    expect(directiveOf(policy(NONCE), 'Connect-Src')).toEqual([
      "'self'",
      'https://umwkpwtkwmdizgndxnjc.supabase.co',
      FRESHNESS,
      'https://rpc.walletconnect.org',
    ])
    expect(directiveOf(policy(NONCE), 'img-src')).toEqual([])
  })

  it('finds each injected mark in its usual shape, and none on a clean page', () => {
    expect(injectedIn(html(NONCE, ROCKET_LOADED))).toEqual(['rocket-loader', '/cdn-cgi/'])
    expect(injectedIn(html(NONCE, EMAIL_OBFUSCATED))).toEqual(['email-decode', '/cdn-cgi/'])
    expect(injectedIn(html(NONCE, BEACON))).toEqual(['beacon.min.js', 'cloudflareinsights.com'])
    expect(injectedIn(html(NONCE))).toEqual([])
  })
})

describe('the judges (section 8.2)', () => {
  const health = (body: object, headers: Record<string, string> = {}) =>
    answer(
      200,
      { 'cf-ray': RAY, 'cache-control': 'no-store', 'cf-cache-status': 'DYNAMIC', ...headers },
      JSON.stringify(body),
    )

  it('names the 13 checks in order', () => {
    expect(EDGE_CHECKS.map((entry) => entry.subject)).toEqual([
      'setup',
      'health',
      'state at the edge',
      'a 1 s edge',
      '304 at the edge',
      'first poll',
      'query ignored',
      'wallet',
      'CORS',
      'pages',
      'policy intact',
      'nothing injected',
      'transport',
    ])
  })

  it('check 1: both domains through Cloudflare, /health ok and the state 200', () => {
    expect(judgeSetup(page(NONCE), health({ status: 'ok' }), state('MISS'))).toBeNull()
    const vercel = answer(200, { 'content-type': 'text/html' })
    expect(judgeSetup(vercel, vercel, vercel)).toBe(
      'the app domain and the freshness domain answered with no cf-ray header',
    )
    expect(judgeSetup(page(NONCE), health({ status: 'degraded' }), state('MISS'))).toBe(
      '/health answered 200 {"status":"degraded"}',
    )
    expect(
      judgeSetup(
        page(NONCE),
        health({ status: 'ok' }),
        answer(404, { 'cf-ray': RAY }, '{"error":"not-a-collection"}'),
      ),
    ).toBe('the state answered 404 {"error":"not-a-collection"}')
  })

  it('check 2: /health no-store and never cached at the edge', () => {
    const bypass = health({ status: 'ok' }, { 'cf-cache-status': 'BYPASS' })
    expect(judgeHealth([health({ status: 'ok' }), bypass])).toBeNull()
    expect(judgeHealth([bypass, health({ status: 'ok' }, { 'cf-cache-status': 'HIT', age: '3' })])).toBe(
      'read 2 answered 200 with Cache-Control no-store and HIT',
    )
  })

  it("check 3: the origin's Cache-Control and weak ETag kept, the second poll a HIT with Age 0 or 1", () => {
    expect(judgeStateAtEdge(state('MISS'), state('HIT', 0), STATE_CACHE)).toBeNull()
    expect(judgeStateAtEdge(state('EXPIRED'), state('HIT'), STATE_CACHE)).toBeNull()
    expect(judgeStateAtEdge(state('MISS'), state('EXPIRED', 0), STATE_CACHE)).toBe(
      'the second poll was EXPIRED with Age 0',
    )
    const browserTtl = state('HIT', 0, { 'cache-control': 'public, max-age=14400' })
    expect(judgeStateAtEdge(state('MISS'), browserTtl, STATE_CACHE)).toBe(
      `poll 2 carried Cache-Control public, max-age=14400, not ${STATE_CACHE}`,
    )
    expect(judgeStateAtEdge(state('MISS', 0, { etag: '"5d41"' }), state('HIT', 0), STATE_CACHE)).toBe(
      'poll 1 carried ETag "5d41"',
    )
  })

  it('check 4: an edge that holds the state past its second, or never goes back to the origin, fails (Review Focus 3)', () => {
    const second = ['HIT', 'HIT', 'HIT', 'HIT', 'UPDATING', 'HIT', 'HIT', 'HIT', 'REVALIDATED', 'HIT']
    const polls = [...second, ...second].map((cache, index) => state(cache, cache === 'HIT' ? index % 2 : 0))
    expect(judgeOneSecond(polls)).toBeNull()
    const held = Array.from({ length: 20 }, (_, index) => state('HIT', Math.floor(index / 4)))
    expect(judgeOneSecond(held)).toBe('a poll showed Age 4')
    const neverBack = Array.from({ length: 20 }, (_, index) => state('HIT', index % 2))
    expect(judgeOneSecond(neverBack)).toBe('0 of the 20 polls answered other than HIT')
    expect(judgeOneSecond([state('HIT', 0), answer(503, { 'cf-ray': RAY })])).toBe('poll 2 answered 503')
  })

  it('check 5: a 304 with the ETag it was asked with, from the edge or revalidated', () => {
    const notModified = (cache: string, etag = ETAG) =>
      answer(304, { etag, 'cache-control': STATE_CACHE, 'cf-cache-status': cache, 'cf-ray': RAY })
    expect(judgeNotModified(notModified('HIT'), ETAG)).toBeNull()
    expect(judgeNotModified(notModified('REVALIDATED'), ETAG)).toBeNull()
    expect(judgeNotModified(state('HIT'), ETAG)).toBe(`the poll carrying ${ETAG} answered 200`)
    expect(judgeNotModified(notModified('HIT', 'W/"0"'), ETAG)).toBe(
      `the 304 carried ETag W/"0", not ${ETAG}`,
    )
    expect(judgeNotModified(notModified('MISS'), ETAG)).toBe('the 304 was MISS')
  })

  it("check 6: an edge that lets a page's reload poll through to the origin fails (Review Focus 2)", () => {
    expect(judgeFirstPoll(state('HIT', 0))).toBeNull()
    for (const cache of ['MISS', 'EXPIRED', 'REVALIDATED', 'BYPASS', 'DYNAMIC'])
      expect(judgeFirstPoll(state(cache, 0))).toBe(`the reload poll answered 200, ${cache}`)
    expect(judgeFirstPoll(state(null))).toBe('the reload poll answered 200, no cf-cache-status')
  })

  it('check 7: a random query right after a cached poll is a HIT', () => {
    expect(judgeQuery(state('HIT', 0))).toBeNull()
    expect(judgeQuery(state('MISS'))).toBe('the poll with a random query answered 200, MISS')
  })

  it('check 8: the wallet held 5 s at the edge and no longer', () => {
    const read = (cache: string, age?: number, extra: Record<string, string> = {}) =>
      answer(200, {
        'cache-control': WALLET_CACHE,
        'cf-cache-status': cache,
        'cf-ray': RAY,
        ...(age === undefined ? {} : { age: String(age) }),
        ...extra,
      })
    expect(judgeWallet(read('MISS'), read('HIT', 0), read('EXPIRED'), WALLET_CACHE)).toBeNull()
    expect(judgeWallet(read('MISS'), read('MISS'), read('MISS'), WALLET_CACHE)).toBe(
      'the second read was MISS with Age 0',
    )
    expect(judgeWallet(read('MISS'), read('HIT', 0), read('HIT', 6), WALLET_CACHE)).toBe(
      'the read 6 s after the first was a HIT with Age 6',
    )
    expect(
      judgeWallet(
        read('MISS', 0, { 'cache-control': 'public, max-age=14400' }),
        read('HIT'),
        read('MISS'),
        WALLET_CACHE,
      ),
    ).toBe(`read 1 carried Cache-Control public, max-age=14400, not ${WALLET_CACHE}`)
  })

  it("check 9: the preflight allows the page's headers for a day, and the state exposes ETag, Retry-After and Age", () => {
    const preflight = (allowed: string) =>
      answer(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD',
        'access-control-allow-headers': allowed,
        'access-control-max-age': '86400',
        'cf-ray': RAY,
      })
    expect(judgeCors(preflight('If-None-Match, Cache-Control, Pragma'), state('HIT'))).toBeNull()
    expect(judgeCors(preflight('If-None-Match'), state('HIT'))).toBe(
      'the preflight does not allow cache-control, pragma',
    )
    expect(
      judgeCors(
        preflight('If-None-Match, Cache-Control, Pragma'),
        state('HIT', 0, { 'access-control-expose-headers': 'ETag' }),
      ),
    ).toBe('the state answer does not expose retry-after, age')
  })

  it('check 10: every page dynamic at the edge, each load of / with its own nonce', () => {
    expect(judgePages([page(NONCE), page(OTHER_NONCE)], page(NONCE))).toBeNull()
    expect(judgePages([page(NONCE), page(NONCE)], null)).toBe('two loads of / carried the same nonce')
    expect(judgePages([page(NONCE), page(OTHER_NONCE, { 'cf-cache-status': 'HIT' })], null)).toBe(
      '/ again answered 200 text/html; charset=utf-8, HIT',
    )
    expect(
      judgePages(
        [page(NONCE), page(OTHER_NONCE)],
        answer(404, { 'content-type': 'text/html', 'cf-cache-status': 'DYNAMIC' }),
      ),
    ).toBe('the mint page answered 404 text/html, DYNAMIC')
  })

  it('check 11: a build whose policy still names an earlier freshness origin fails, as does any script without the nonce (Review Focus 4)', () => {
    const args = { app: new URL(APP), freshness: new URL(FRESHNESS) }
    expect(judgePolicy(page(NONCE), args)).toBeNull()
    const reportOnly = page(NONCE, {
      'content-security-policy': null,
      'content-security-policy-report-only': policy(NONCE),
    })
    expect(judgePolicy(reportOnly, args)).toBeNull()
    const earlier = page(NONCE, {
      'content-security-policy': policy(NONCE, 'https://freshness-production.up.railway.app'),
    })
    expect(judgePolicy(earlier, args)).toBe(`connect-src does not list ${FRESHNESS}`)
    expect(judgePolicy(page(NONCE, {}, html(NONCE, ROCKET_LOADED)), args)).toBe(
      "1 of the 5 scripts lack the response's nonce",
    )
    expect(judgePolicy(page(NONCE, { 'x-frame-options': null }), args)).toBe(
      'x-frame-options arrived as null',
    )
    expect(judgePolicy(page(NONCE, { 'content-security-policy': "frame-ancestors 'none'" }), args)).toBe(
      'the page carries no policy naming script-src',
    )
    expect(
      judgePolicy(
        page(NONCE, { 'reporting-endpoints': 'csp="https://cobweb-cobweb3.vercel.app/api/csp-report"' }),
        args,
      ),
    ).toBe(`Reporting-Endpoints does not name ${APP}/api/csp-report`)
  })

  it('check 12: no injected script in any page and no Speculation-Rules on any answer', () => {
    expect(judgeInjected([page(NONCE)], [page(NONCE), state('HIT')])).toBeNull()
    expect(judgeInjected([page(NONCE, {}, html(NONCE, EMAIL_OBFUSCATED))], [])).toBe(
      'a page holds email-decode, /cdn-cgi/',
    )
    const speedBrain = page(NONCE, { 'speculation-rules': '"/cdn-cgi/speculation"' })
    expect(judgeInjected([page(NONCE)], [speedBrain])).toBe('an answer carries Speculation-Rules')
  })

  it('check 13: http:// redirected to the same host on https://, and HSTS on /', () => {
    const app = new URL(APP)
    const redirect = (status: number, location?: string) =>
      answer(status, { 'cf-ray': RAY, ...(location ? { location } : {}) })
    expect(judgeTransport(redirect(301, `${APP}/`), page(NONCE), app)).toBeNull()
    expect(judgeTransport(redirect(308, APP), page(NONCE), app)).toBeNull()
    expect(judgeTransport(redirect(200), page(NONCE), app)).toBe('http:// answered 200 to no Location')
    expect(judgeTransport(redirect(301, 'https://cobweb-cobweb3.vercel.app/'), page(NONCE), app)).toBe(
      'http:// answered 301 to https://cobweb-cobweb3.vercel.app/',
    )
    expect(
      judgeTransport(redirect(301, `${APP}/`), page(NONCE, { 'strict-transport-security': null }), app),
    ).toBe('/ carries no Strict-Transport-Security')
  })
})
