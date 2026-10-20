// Reads Cloudflare in front of the app and the freshness server from outside
// (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 8): 13 checks with PASS and FAIL lines in
// the verify scripts' form, each failure naming the setting to look at, judged by src/lib/edge/edge-checks.ts. The
// owner runs it once the zone is set (docs/reference/cloudflare-setup.md) and after any change to it. Checks 3, 5, 6
// and 8 send the page's own request headers; checks 4 and 8 depend on timing, so one failure on a slow line is decided
// by a rerun. Checks 3, 5, 6 and 7 take two tries, since the state's 1 s copy can expire between a check's priming
// poll and its judged poll, and every misconfiguration they name fails each try alike. Reads no secret and writes
// nothing; it proves the colo nearest the machine that runs it.
//
//   pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness https://<freshness domain> \
//     --collection <chain id>/<address> [--slug <mint page link>]
//
// Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { randomBytes } from 'node:crypto'
import { STATE_CACHE, WALLET_CACHE } from '@cobweb/freshness/server'
import {
  EDGE_CHECKS,
  edgeArgsOf,
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
  type EdgeAnswer,
} from '../src/lib/edge/edge-checks.ts'

const USAGE =
  'Usage: pnpm --filter @cobweb/web check:edge --app https://<app domain> --freshness https://<freshness domain> --collection <chain id>/<address> [--slug <mint page link>]'

const args = edgeArgsOf(process.argv.slice(2))
if (!args) {
  console.error(USAGE)
  process.exit(2)
}
const { app, freshness } = args

/** A poll as the page's `cache: 'no-cache'` fetch sends it, and its first as `cache: 'reload'` sends it (decision 4). */
const NO_CACHE = { 'Cache-Control': 'max-age=0' }
const RELOAD = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
const statePath = `/v1/state/${args.chainId}/${args.address}`

/** Every answer read, with its URL, for check 12. */
const seen: { url: URL; answer: EdgeAnswer }[] = []

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** One request with no redirect followed, given up after 10 s; its status, headers and body. */
async function ask(
  url: URL,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<EdgeAnswer> {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  const answer = { status: response.status, headers: response.headers, body: await response.text() }
  seen.push({ url, answer })
  return answer
}

const at = (base: URL, path: string) => new URL(path, base)
const poll = (headers: Record<string, string> = {}, query = '') =>
  ask(at(freshness, `${statePath}${query}`), { headers })

/** A thrown error as one line: its message, and the code of its cause where fetch gives one. */
function thrown(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const code = (error.cause as { code?: unknown } | undefined)?.code
  return `${error.message.split('\n')[0]}${typeof code === 'string' ? ` (${code})` : ''}`
}

let passed = 0
let failed = 0

/** Runs check `n`: its PASS line, or its FAIL line with the problem and where to look. */
async function check(n: number, judge: () => Promise<string | null>): Promise<void> {
  const { subject, held, hint } = EDGE_CHECKS[n - 1]!
  let problem: string | null
  try {
    problem = await judge()
  } catch (error) {
    problem = `threw ${thrown(error)}`
  }
  if (problem === null) {
    passed++
    console.log(`PASS ${n}. ${subject}: ${held}`)
  } else {
    failed++
    console.log(`FAIL ${n}. ${subject}: ${held}: ${problem}. Look at: ${hint}`)
  }
}

/**
 * Runs a judgement and, when it finds a problem, once more: the state's 1 s copy can expire between a check's priming
 * poll and its judged poll, so a correct zone can read EXPIRED there. Every misconfiguration checks 3, 5, 6 and 7 name
 * fails each try alike, so the second try hides no defect and a spurious failure becomes rare.
 */
async function twice(judge: () => Promise<string | null>): Promise<string | null> {
  return (await judge()) === null ? null : judge()
}

console.log(`Reading ${app.origin} and ${freshness.origin} from outside`)

await check(1, async () =>
  judgeSetup(await ask(app), await ask(at(freshness, '/health')), await poll(NO_CACHE)),
)

await check(2, async () =>
  judgeHealth([await ask(at(freshness, '/health')), await ask(at(freshness, '/health'))]),
)

await check(3, () =>
  twice(async () => judgeStateAtEdge(await poll(NO_CACHE), await poll(NO_CACHE), STATE_CACHE)),
)

await check(4, async () => {
  const polls: EdgeAnswer[] = []
  for (let n = 0; n < 20; n++) {
    const sent = Date.now()
    polls.push(await poll())
    await wait(Math.max(0, 250 - (Date.now() - sent)))
  }
  return judgeOneSecond(polls)
})

await check(5, () =>
  twice(async () => {
    const etag = (await poll(NO_CACHE)).headers.get('etag')
    if (!etag) return 'the poll before it carried no ETag'
    return judgeNotModified(await poll({ ...NO_CACHE, 'If-None-Match': etag }), etag)
  }),
)

await check(6, () =>
  twice(async () => {
    await poll(NO_CACHE)
    return judgeFirstPoll(await poll(RELOAD))
  }),
)

await check(7, () =>
  twice(async () => {
    await poll()
    return judgeQuery(await poll({}, `?check-edge=${randomBytes(8).toString('hex')}`))
  }),
)

await check(8, async () => {
  const wallet = at(
    freshness,
    `/v1/wallet/${args.chainId}/${args.address}/0x${randomBytes(20).toString('hex')}`,
  )
  const first = await ask(wallet, { headers: NO_CACHE })
  // The edge's 5 s copy starts when the origin's answer reaches it, so the 6 s are counted from the first answer.
  const sent = Date.now()
  const second = await ask(wallet, { headers: NO_CACHE })
  await wait(Math.max(0, 6_000 - (Date.now() - sent)))
  return judgeWallet(first, second, await ask(wallet, { headers: NO_CACHE }), WALLET_CACHE)
})

await check(9, async () => {
  const preflight = await ask(at(freshness, statePath), {
    method: 'OPTIONS',
    headers: {
      Origin: app.origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'if-none-match, cache-control, pragma',
    },
  })
  return judgeCors(preflight, await poll({ ...NO_CACHE, Origin: app.origin }))
})

await check(10, async () =>
  judgePages([await ask(app), await ask(app)], args.slug ? await ask(at(app, `/${args.slug}`)) : null),
)

await check(11, async () => judgePolicy(await ask(app), args))

await check(12, async () => {
  const pages = seen
    .filter(
      ({ url, answer }) =>
        url.origin === app.origin && answer.headers.get('content-type')?.includes('text/html'),
    )
    .map(({ answer }) => answer)
  return judgeInjected(
    pages,
    seen.map(({ answer }) => answer),
  )
})

await check(13, async () => judgeTransport(await ask(new URL(`http://${app.host}/`)), await ask(app), app))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
