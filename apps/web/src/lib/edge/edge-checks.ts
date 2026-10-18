import type { Address } from 'viem'

/**
 * Cloudflare in front, read from outside (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md,
 * section 8), pure: the arguments, the readers of an answer and each check's judgement of the answers
 * `scripts/check-edge.ts` fetched. They are unit-tested on answers shaped as Cloudflare's, since no run can reach a
 * zone before the owner makes one. A judgement answers null when its check held, else the problem.
 */

export type EdgeAnswer = { status: number; headers: Headers; body: string }
export type EdgeArgs = { app: URL; freshness: URL; chainId: number; address: Address; slug: string | null }

/**
 * What Cloudflare's features put into a page: Rocket Loader, Email Address Obfuscation's decoder, Web Analytics'
 * beacon and its host, and any path under /cdn-cgi/.
 */
export const INJECTED_MARKS: readonly string[] = [
  'rocket-loader',
  'email-decode',
  'beacon.min.js',
  'cloudflareinsights.com',
  '/cdn-cgi/',
]

/** The 13 checks in order (section 8.2): each one's subject, what holds when it passes and where to look when not. */
export const EDGE_CHECKS: readonly { subject: string; held: string; hint: string }[] = [
  {
    subject: 'setup',
    held: "the app domain and the freshness domain both answer through Cloudflare (a cf-ray header on each), /health reads ok, and the collection's state answers 200",
    hint: "the two DNS records are Proxied, and the URLs given are the custom domains, not Vercel's or Railway's own.",
  },
  {
    subject: 'health',
    held: '/health answers 200 with Cache-Control no-store and cf-cache-status DYNAMIC or BYPASS on two reads in a row',
    hint: 'the Cache Rule that bypasses /health.',
  },
  {
    subject: 'state at the edge',
    held: "two state polls in a row answer 200 with the origin's Cache-Control unchanged and a weak ETag, the second a HIT with Age 0 or 1",
    hint: "the Cache Rule for /v1/ (eligible, Edge TTL from the origin's Cache-Control, Browser TTL from the origin) and the zone's Browser Cache TTL.",
  },
  {
    subject: 'a 1 s edge',
    held: 'polls every 250 ms for 5 s never show an Age above 2, and at least two answer other than HIT, the edge going back to the origin',
    hint: "the /v1/ rule's Edge TTL, which must follow the origin's Cache-Control rather than set its own.",
  },
  {
    subject: '304 at the edge',
    held: 'a poll carrying the last ETag answers 304 with that ETag, HIT or REVALIDATED',
    hint: 'Respect Strong ETags (off) and the /v1/ rule.',
  },
  {
    subject: 'first poll',
    held: "a poll with the page's reload headers, Cache-Control no-cache and Pragma no-cache, is answered from the edge's copy (a HIT)",
    hint: "nothing in the zone; the edge passed the browser's directives to the origin, a defect for the controller (decision 21).",
  },
  {
    subject: 'query ignored',
    held: 'a poll with a random query string, right after a cached one, is a HIT',
    hint: "the /v1/ rule's cache key (Ignore query string), or the zone's Caching Level (Ignore Query String).",
  },
  {
    subject: 'wallet',
    held: 'two reads of a fresh wallet in a row answer 200 with Cache-Control public, max-age=0, s-maxage=5, the second a HIT with Age at most 5, and a read 6 s after the first is not a HIT',
    hint: 'the /v1/ rule, as for check 3.',
  },
  {
    subject: 'CORS',
    held: "a preflight from the app's origin for If-None-Match, Cache-Control and Pragma answers 204 allowing them with Access-Control-Max-Age 86400, and a state answer from the edge carries Access-Control-Allow-Origin * and exposes ETag, Retry-After and Age",
    hint: "a Transform Rule or a Managed Transform touching the freshness domain's headers.",
  },
  {
    subject: 'pages',
    held: '/ and the mint page given answer 200 HTML with cf-cache-status DYNAMIC, and two loads of / carry different nonces',
    hint: "a rule caching the app domain's pages (Cache Everything, or a Cache Rule making them eligible), which must not exist.",
  },
  {
    subject: 'policy intact',
    held: "the page policy, enforced or report-only, has 'strict-dynamic' and the nonce every script carries, its connect-src lists the freshness origin, Reporting-Endpoints names the app's /api/csp-report, and X-Frame-Options DENY, X-Content-Type-Options nosniff and Referrer-Policy strict-origin-when-cross-origin arrive",
    hint: 'Managed Transforms (off), CSP_MODE on Vercel (not off), and a redeploy after NEXT_PUBLIC_FRESHNESS_URL moved.',
  },
  {
    subject: 'nothing injected',
    held: 'no page read holds a Cloudflare script (rocket-loader, email-decode, beacon.min.js, cloudflareinsights.com or a /cdn-cgi/ path) and no answer carries a Speculation-Rules header',
    hint: 'the feature named, in the list that stays off.',
  },
  {
    subject: 'transport',
    held: 'http:// on the app domain answers a redirect to its https:// address, and / carries Strict-Transport-Security',
    hint: "Always Use HTTPS, and HSTS (Vercel's header, or Cloudflare's if Vercel sends none).",
  },
]

const FLAGS = ['--app', '--freshness', '--collection', '--slug'] as const
const COLLECTION = /^([1-9][0-9]{0,15})\/(0x[0-9a-fA-F]{40})$/
/** A mint page's link, as `src/lib/collections.ts` and the database's check write it. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/

/** An https URL's origin, or null for anything else. */
function httpsOf(value: string | undefined): URL | null {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' ? new URL(url.origin) : null
  } catch {
    return null
  }
}

/**
 * `--app`, `--freshness`, `--collection` and the optional `--slug`, each given once with its value; null without a
 * usable set: both URLs https (their origins are kept), the collection `<chain id>/<address>`, the slug a mint
 * page's link.
 */
export function edgeArgsOf(argv: readonly string[]): EdgeArgs | null {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index] ?? ''
    const value = argv[index + 1]
    if (!(FLAGS as readonly string[]).includes(name) || value === undefined || values.has(name)) return null
    values.set(name, value)
  }
  const app = httpsOf(values.get('--app'))
  const freshness = httpsOf(values.get('--freshness'))
  const collection = COLLECTION.exec(values.get('--collection') ?? '')
  const slug = values.get('--slug') ?? null
  if (!app || !freshness || !collection || (slug !== null && !SLUG.test(slug))) return null
  return {
    app,
    freshness,
    chainId: Number(collection[1]),
    address: collection[2]!.toLowerCase() as Address,
    slug,
  }
}

/** Whether the answer came through Cloudflare: it carries a cf-ray header. */
export function viaCloudflare(answer: EdgeAnswer): boolean {
  return answer.headers.has('cf-ray')
}

/** The answer's cf-cache-status in upper case, or null without one. */
export function cacheStatusOf(answer: EdgeAnswer): string | null {
  return answer.headers.get('cf-cache-status')?.trim().toUpperCase() ?? null
}

/** The answer's Age in seconds, or null without a whole number there. */
export function ageOf(answer: EdgeAnswer): number | null {
  const age = answer.headers.get('age')?.trim()
  return age && /^[0-9]+$/.test(age) ? Number(age) : null
}

/** Whether an ETag is weak: `W/"..."`. */
export function isWeakEtag(value: string | null): boolean {
  return value !== null && /^W\/"[^"]*"$/.test(value)
}

/** An attribute of a tag's attribute text, double-quoted, single-quoted or bare; null without it. */
function attributeOf(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(
    attributes,
  )
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
}

/**
 * The nonce of each script of a JavaScript type in the HTML, in order, null where a script has none: no type, a
 * module or a type naming JavaScript (Rocket Loader's rewritten `<hash>-text/javascript` included); a JSON or other
 * data script is left out.
 */
export function scriptNonces(html: string): (string | null)[] {
  return [...html.matchAll(/<script\b([^>]*)>/gi)].flatMap((match) => {
    const attributes = match[1] ?? ''
    const type = attributeOf(attributes, 'type')?.trim().toLowerCase()
    if (type && type !== 'module' && !type.includes('javascript')) return []
    return [attributeOf(attributes, 'nonce')]
  })
}

/** A policy's directives by name, in lower case. */
function directivesOf(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>()
  for (const entry of policy.split(';')) {
    const [name, ...sources] = entry.trim().split(/\s+/)
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources)
  }
  return directives
}

/** A directive's sources, in order; empty when the policy does not name it. */
export function directiveOf(policy: string, name: string): string[] {
  return directivesOf(policy).get(name.toLowerCase()) ?? []
}

/** The nonce of the policy's script-src, or null. */
export function nonceOf(policy: string): string | null {
  const source = directiveOf(policy, 'script-src').find((value) => /^'nonce-[^']+'$/.test(value))
  return source ? source.slice("'nonce-".length, -1) : null
}

/**
 * The page's policy: the enforced one when it names script-src (off, the enforced header is the framing policy
 * alone), else the report-only one, which the report week sends with no enforced policy beside it; null with neither.
 */
export function pagePolicyOf(headers: Headers): { mode: 'enforce' | 'report-only'; policy: string } | null {
  const enforced = headers.get('content-security-policy')
  if (enforced && directiveOf(enforced, 'script-src').length) return { mode: 'enforce', policy: enforced }
  const reported = headers.get('content-security-policy-report-only')
  return reported ? { mode: 'report-only', policy: reported } : null
}

/** The marks of Cloudflare's injections found in the HTML, in the order of `INJECTED_MARKS`. */
export function injectedIn(html: string): string[] {
  return INJECTED_MARKS.filter((mark) => html.includes(mark))
}

/** A cf-cache-status for a problem line. */
const statusText = (answer: EdgeAnswer) => cacheStatusOf(answer) ?? 'no cf-cache-status'

/** Whether /health answered 200 with `"status":"ok"`. */
function healthOk(answer: EdgeAnswer): boolean {
  try {
    return answer.status === 200 && (JSON.parse(answer.body) as { status?: unknown }).status === 'ok'
  } catch {
    return false
  }
}

/** Check 1: `/` and /health through Cloudflare, /health ok, the collection's state 200. */
export function judgeSetup(home: EdgeAnswer, health: EdgeAnswer, state: EdgeAnswer): string | null {
  const direct = [
    ['the app domain', home],
    ['the freshness domain', health],
  ].flatMap(([name, answer]) => (viaCloudflare(answer as EdgeAnswer) ? [] : [name as string]))
  if (direct.length) return `${direct.join(' and ')} answered with no cf-ray header`
  if (!healthOk(health)) return `/health answered ${health.status} ${health.body.slice(0, 120)}`
  return state.status === 200 ? null : `the state answered ${state.status} ${state.body.slice(0, 120)}`
}

/** Check 2: each /health read 200, no-store, DYNAMIC or BYPASS. */
export function judgeHealth(reads: readonly EdgeAnswer[]): string | null {
  for (const [index, read] of reads.entries()) {
    const cache = read.headers.get('cache-control')
    const status = cacheStatusOf(read)
    if (read.status !== 200 || cache !== 'no-store' || (status !== 'DYNAMIC' && status !== 'BYPASS'))
      return `read ${index + 1} answered ${read.status} with Cache-Control ${cache} and ${statusText(read)}`
  }
  return null
}

/** Check 3: both polls 200 with the origin's Cache-Control and a weak ETag; the second a HIT with Age 0 or 1. */
export function judgeStateAtEdge(first: EdgeAnswer, second: EdgeAnswer, stateCache: string): string | null {
  for (const [index, poll] of [first, second].entries()) {
    if (poll.status !== 200) return `poll ${index + 1} answered ${poll.status}`
    const cache = poll.headers.get('cache-control')
    if (cache !== stateCache) return `poll ${index + 1} carried Cache-Control ${cache}, not ${stateCache}`
    if (!isWeakEtag(poll.headers.get('etag')))
      return `poll ${index + 1} carried ETag ${poll.headers.get('etag')}`
  }
  const age = ageOf(second) ?? 0
  return cacheStatusOf(second) === 'HIT' && age <= 1
    ? null
    : `the second poll was ${statusText(second)} with Age ${age}`
}

/**
 * Check 4: no poll shows an Age above 2 and at least two answer other than HIT, so the edge holds the state for its
 * second and goes back to the origin after it (Review Focus 3).
 */
export function judgeOneSecond(polls: readonly EdgeAnswer[]): string | null {
  const refused = polls.findIndex((poll) => poll.status !== 200)
  if (refused >= 0) return `poll ${refused + 1} answered ${polls[refused]!.status}`
  const oldest = Math.max(0, ...polls.map((poll) => ageOf(poll) ?? 0))
  if (oldest > 2) return `a poll showed Age ${oldest}`
  const back = polls.filter((poll) => cacheStatusOf(poll) !== 'HIT').length
  return back >= 2 ? null : `${back} of the ${polls.length} polls answered other than HIT`
}

/** Check 5: the conditional poll answers 304 with the ETag it carried, from the edge's copy or revalidated. */
export function judgeNotModified(answer: EdgeAnswer, etag: string): string | null {
  if (answer.status !== 304) return `the poll carrying ${etag} answered ${answer.status}`
  const returned = answer.headers.get('etag')
  if (returned !== etag) return `the 304 carried ETag ${returned}, not ${etag}`
  const status = cacheStatusOf(answer)
  return status === 'HIT' || status === 'REVALIDATED' ? null : `the 304 was ${statusText(answer)}`
}

/** Checks 6 and 7: the poll was answered 200 from the edge's copy. */
function judgeHit(answer: EdgeAnswer, poll: string): string | null {
  return answer.status === 200 && cacheStatusOf(answer) === 'HIT'
    ? null
    : `the ${poll} answered ${answer.status}, ${statusText(answer)}`
}

/**
 * Check 6: a poll carrying the page's reload headers is a HIT, so the edge never lets a browser's request directives
 * send its first poll to the origin (Review Focus 2).
 */
export function judgeFirstPoll(answer: EdgeAnswer): string | null {
  return judgeHit(answer, 'reload poll')
}

/** Check 7: a poll with a random query string, right after a cached one, is a HIT. */
export function judgeQuery(answer: EdgeAnswer): string | null {
  return judgeHit(answer, 'poll with a random query')
}

/** Check 8: two reads 200 with the wallet's Cache-Control, the second a HIT with Age at most 5; one 6 s on not a HIT. */
export function judgeWallet(
  first: EdgeAnswer,
  second: EdgeAnswer,
  later: EdgeAnswer,
  walletCache: string,
): string | null {
  for (const [index, read] of [first, second].entries()) {
    if (read.status !== 200) return `read ${index + 1} answered ${read.status}`
    const cache = read.headers.get('cache-control')
    if (cache !== walletCache) return `read ${index + 1} carried Cache-Control ${cache}, not ${walletCache}`
  }
  const age = ageOf(second) ?? 0
  if (cacheStatusOf(second) !== 'HIT' || age > 5)
    return `the second read was ${statusText(second)} with Age ${age}`
  return cacheStatusOf(later) === 'HIT'
    ? `the read 6 s after the first was a HIT with Age ${ageOf(later)}`
    : null
}

/** A comma-separated header's values in lower case. */
const listOf = (value: string | null) => (value ?? '').split(',').map((entry) => entry.trim().toLowerCase())

/** Check 9: the preflight allows the page's three request headers for a day; a state answer exposes its three. */
export function judgeCors(preflight: EdgeAnswer, state: EdgeAnswer): string | null {
  if (preflight.status !== 204) return `the preflight answered ${preflight.status}`
  const allowed = listOf(preflight.headers.get('access-control-allow-headers'))
  const refused = ['if-none-match', 'cache-control', 'pragma'].filter((name) => !allowed.includes(name))
  if (refused.length) return `the preflight does not allow ${refused.join(', ')}`
  const maxAge = preflight.headers.get('access-control-max-age')
  if (maxAge !== '86400') return `the preflight carried Access-Control-Max-Age ${maxAge}`
  const origin = state.headers.get('access-control-allow-origin')
  if (origin !== '*') return `the state answer carried Access-Control-Allow-Origin ${origin}`
  const exposed = listOf(state.headers.get('access-control-expose-headers'))
  const hidden = ['etag', 'retry-after', 'age'].filter((name) => !exposed.includes(name))
  return hidden.length ? `the state answer does not expose ${hidden.join(', ')}` : null
}

/** Check 10: each page 200 HTML and DYNAMIC; the two loads of `/` carry two different nonces. */
export function judgePages(home: readonly [EdgeAnswer, EdgeAnswer], mint: EdgeAnswer | null): string | null {
  const pages: [string, EdgeAnswer][] = [
    ['/', home[0]],
    ['/ again', home[1]],
    ...(mint ? [['the mint page', mint] as [string, EdgeAnswer]] : []),
  ]
  for (const [name, page] of pages) {
    const html = (page.headers.get('content-type') ?? '').includes('text/html')
    if (page.status !== 200 || !html || cacheStatusOf(page) !== 'DYNAMIC')
      return `${name} answered ${page.status} ${page.headers.get('content-type')}, ${statusText(page)}`
  }
  const [first, second] = home.map((page) => {
    const policy = pagePolicyOf(page.headers)
    return policy ? nonceOf(policy.policy) : null
  })
  if (!first || !second) return 'a load of / carried no nonce'
  return first === second ? 'two loads of / carried the same nonce' : null
}

/**
 * Check 11: the page policy has 'strict-dynamic' and a nonce every script carries, its connect-src lists the
 * freshness origin given (a build still naming an earlier origin, before its redeploy, fails here: Review Focus 4),
 * Reporting-Endpoints names the app's report path, and the three headers arrive as the app sends them.
 */
export function judgePolicy(page: EdgeAnswer, args: Pick<EdgeArgs, 'app' | 'freshness'>): string | null {
  const found = pagePolicyOf(page.headers)
  if (!found) return 'the page carries no policy naming script-src'
  if (!directiveOf(found.policy, 'script-src').includes("'strict-dynamic'"))
    return `the ${found.mode} policy's script-src has no 'strict-dynamic'`
  const nonce = nonceOf(found.policy)
  if (!nonce) return `the ${found.mode} policy's script-src has no nonce`
  const scripts = scriptNonces(page.body)
  const off = scripts.filter((carried) => carried !== nonce).length
  if (!scripts.length || off) return `${off} of the ${scripts.length} scripts lack the response's nonce`
  if (!directiveOf(found.policy, 'connect-src').includes(args.freshness.origin))
    return `connect-src does not list ${args.freshness.origin}`
  const endpoint = `${args.app.origin}/api/csp-report`
  if (!(page.headers.get('reporting-endpoints') ?? '').includes(`"${endpoint}"`))
    return `Reporting-Endpoints does not name ${endpoint}`
  const expected: [string, string][] = [
    ['x-frame-options', 'DENY'],
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
  ]
  for (const [name, value] of expected)
    if (page.headers.get(name) !== value) return `${name} arrived as ${page.headers.get(name)}`
  return null
}

/** Check 12: no page holds an injected mark and no answer carries a Speculation-Rules header. */
export function judgeInjected(pages: readonly EdgeAnswer[], answers: readonly EdgeAnswer[]): string | null {
  const marks = INJECTED_MARKS.filter((mark) => pages.some((page) => page.body.includes(mark)))
  if (marks.length) return `a page holds ${marks.join(', ')}`
  return answers.some((answer) => answer.headers.has('speculation-rules'))
    ? 'an answer carries Speculation-Rules'
    : null
}

/** Check 13: http:// answers a redirect to the same host on https://, and `/` carries Strict-Transport-Security. */
export function judgeTransport(redirect: EdgeAnswer, home: EdgeAnswer, app: URL): string | null {
  const location = redirect.headers.get('location') ?? ''
  const secure = location === `https://${app.host}` || location.startsWith(`https://${app.host}/`)
  if (![301, 302, 307, 308].includes(redirect.status) || !secure)
    return `http:// answered ${redirect.status} to ${location || 'no Location'}`
  return home.headers.has('strict-transport-security') ? null : '/ carries no Strict-Transport-Security'
}
