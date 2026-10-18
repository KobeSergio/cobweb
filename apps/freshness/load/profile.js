/**
 * The load run's parameters, options and readings (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md,
 * section 5), pure and in plain JavaScript: it imports nothing from k6, so Vitest runs profile.test.ts beside it,
 * and k6-freshness.js builds the run from it. The pollers are driven as their rate (decision 3), so the edge and the
 * origin meet the requests 20,000 browsers polling every 3 s would send.
 */

/** Each profile's defaults: pollers, a poller's interval in seconds and wallet reads a minute. */
export const PROFILES = {
  local: { pollers: 100, intervalS: 1, wallets: 1500 },
  hosted: { pollers: 20000, intervalS: 3, wallets: 5000 },
}

/** The local run's length; the hosted pollers ramp for a minute and hold for two, the wallets read in the second. */
const LOCAL_S = 20
const RAMP_S = 60
const HOLD_S = 120

/** The `cf-cache-status` values Cloudflare answers, each counted in its own `edge_<value>` metric. */
const EDGE_STATUSES = ['HIT', 'MISS', 'EXPIRED', 'REVALIDATED', 'UPDATING', 'STALE', 'DYNAMIC', 'BYPASS']

/** The counters every answer counts in one of: its `cf-cache-status`, another value, or none. */
export const EDGE_COUNTERS = [
  ...EDGE_STATUSES.map((status) => `edge_${status.toLowerCase()}`),
  'edge_other',
  'edge_none',
]

const SENTENCES = {
  profile: 'PROFILE must be local or hosted.',
  base: "BASE must be the freshness server's origin, such as https://fresh.example.com.",
  collections: 'COLLECTIONS must list one or more <chain id>/<address>, separated by commas.',
  numbers: 'POLLERS, INTERVAL_S and WALLETS must be whole numbers above 0.',
}

/** http or https, a host or an IPv6 literal, an optional port, and no path but an optional trailing slash. */
const ORIGIN = /^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::[0-9]{1,5})?\/?$/i
const COLLECTION = /^([1-9][0-9]{0,15})\/(0x[0-9a-fA-F]{40})$/
const WHOLE = /^[1-9][0-9]{0,8}$/

/**
 * The run's parameters from k6's `__ENV` (or any object of strings): the profile, the freshness origin, the
 * collections, the pollers, their interval, the wallet reads a minute and where the JSON summary goes. Throws the
 * sentence of section 10 for the first value it cannot use.
 */
export function parametersOf(env) {
  const profile = env.PROFILE
  if (profile !== 'local' && profile !== 'hosted') throw new Error(SENTENCES.profile)
  const base = String(env.BASE ?? '').trim()
  if (!ORIGIN.test(base)) throw new Error(SENTENCES.base)
  const collections = String(env.COLLECTIONS ?? '')
    .split(',')
    .map((entry) => COLLECTION.exec(entry.trim()))
  if (collections.some((match) => match === null)) throw new Error(SENTENCES.collections)
  const defaults = PROFILES[profile]
  const whole = (value, fallback) => {
    const text = String(value ?? '').trim()
    if (text === '') return fallback
    if (!WHOLE.test(text)) throw new Error(SENTENCES.numbers)
    return Number(text)
  }
  return {
    profile,
    base: base.replace(/\/$/, ''),
    collections: collections.map((match) => ({ chainId: Number(match[1]), address: match[2] })),
    pollers: whole(env.POLLERS, defaults.pollers),
    intervalS: whole(env.INTERVAL_S, defaults.intervalS),
    wallets: whole(env.WALLETS, defaults.wallets),
    summaryFile: String(env.SUMMARY_FILE ?? '').trim() || null,
  }
}

/** The pollers' rate: POLLERS divided by INTERVAL_S polls a second, at least one. */
function pollRateOf(parameters) {
  return Math.max(1, Math.round(parameters.pollers / parameters.intervalS))
}

/**
 * k6's options: the three scenarios of section 5.2, the thresholds of section 5.4 with the dropped iterations held
 * to 1% of those the scenarios plan, and the summary's trend statistics with `p(99)` and `count` added.
 */
export function optionsOf(parameters) {
  const rate = pollRateOf(parameters)
  const hosted = parameters.profile === 'hosted'
  const scenarios = hosted
    ? {
        pollers: {
          executor: 'ramping-arrival-rate',
          exec: 'poll',
          startRate: 0,
          timeUnit: '1s',
          stages: [
            { duration: `${RAMP_S}s`, target: rate },
            { duration: `${HOLD_S}s`, target: rate },
          ],
          preAllocatedVUs: 1000,
          maxVUs: 3000,
        },
        wallets: {
          executor: 'constant-arrival-rate',
          exec: 'ask',
          rate: parameters.wallets,
          timeUnit: '1m',
          duration: `${RAMP_S}s`,
          startTime: `${RAMP_S}s`,
          preAllocatedVUs: 100,
          maxVUs: 500,
        },
        health: {
          executor: 'constant-vus',
          exec: 'watch',
          vus: 1,
          duration: `${RAMP_S + HOLD_S}s`,
          gracefulStop: '0s',
        },
      }
    : {
        pollers: {
          executor: 'constant-arrival-rate',
          exec: 'poll',
          rate,
          timeUnit: '1s',
          duration: `${LOCAL_S}s`,
          preAllocatedVUs: 20,
          maxVUs: 100,
        },
        wallets: {
          executor: 'constant-arrival-rate',
          exec: 'ask',
          rate: parameters.wallets,
          timeUnit: '1m',
          duration: `${LOCAL_S}s`,
          preAllocatedVUs: 10,
          maxVUs: 50,
        },
        health: {
          executor: 'constant-vus',
          exec: 'watch',
          vus: 1,
          duration: `${LOCAL_S}s`,
          gracefulStop: '0s',
        },
      }
  const planned = hosted
    ? rate * (RAMP_S / 2 + HOLD_S) + parameters.wallets * (RAMP_S / 60)
    : rate * LOCAL_S + Math.round((parameters.wallets * LOCAL_S) / 60)
  const thresholds = {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{route:state}': [hosted ? 'p(95)<500' : 'p(95)<200'],
    'http_req_duration{route:wallet}': [hosted ? 'p(95)<1000' : 'p(95)<400'],
    checks: ['rate>0.99'],
    state_not_modified: ['rate>0.9'],
    degraded_answers: ['count==0'],
    early_open: ['count==0'],
    health_problems: ['max==0'],
    dropped_iterations: [`count<=${Math.floor(planned / 100)}`],
  }
  if (hosted)
    Object.assign(thresholds, {
      state_age_s: ['max<=10'],
      edge_mitigated: ['count==0'],
      health_counts_missing: ['count==0'],
      origin_busiest_per_s: ['max<=2'],
    })
  return {
    scenarios,
    thresholds,
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
  }
}

/** `/v1/state/<chain id>/<lowercase address>`: one edge entry per collection. */
export function statePathOf(collection) {
  return `/v1/state/${collection.chainId}/${collection.address.toLowerCase()}`
}

/** `/v1/wallet/<chain id>/<lowercase address>/<lowercase wallet>`. */
export function walletPathOf(collection, wallet) {
  return `/v1/wallet/${collection.chainId}/${collection.address.toLowerCase()}/${wallet.toLowerCase()}`
}

/**
 * A wallet no other ask of this run or of another run reads: `0x`, the run's start in 12 hex digits and the
 * ask's number in 28, lowercase.
 */
export function walletOf(runStartMs, n) {
  return `0x${runStartMs.toString(16).padStart(12, '0')}${n.toString(16).padStart(28, '0')}`
}

/**
 * How a state body's groups read against its own block time: `early` counts a group active by neither its flag
 * nor a reached start (a start of 0 or above the block's time), `openBySchedule` one active by its start alone,
 * and `waiting` one closed whose start is still ahead. A group open by its flag counts in none.
 */
export function livenessOf(body) {
  const counts = { early: 0, openBySchedule: 0, waiting: 0 }
  for (const group of body.groups) {
    if (group.flag) continue
    const reached = group.startTimestamp !== 0 && group.startTimestamp <= body.blockTimestamp
    if (group.active && !reached) counts.early++
    else if (group.active) counts.openBySchedule++
    else if (group.startTimestamp > body.blockTimestamp) counts.waiting++
  }
  return counts
}

/** A response header by name in any case, as k6 hands them canonicalized; null without it. */
export function headerOf(headers, name) {
  const wanted = name.toLowerCase()
  for (const key of Object.keys(headers ?? {})) if (key.toLowerCase() === wanted) return String(headers[key])
  return null
}

/**
 * Where an answer counts at the edge: the `edge_<value>` counter of its `cf-cache-status`, `edge_other` for another
 * value, `edge_none` without one; and whether the edge mitigated it, a `cf-mitigated` header or a 403 or 429 of HTML,
 * which a challenge or a block answers in place of the origin's JSON.
 */
export function edgeOf(status, headers) {
  const value = headerOf(headers, 'cf-cache-status')
  const upper = value === null ? null : value.trim().toUpperCase()
  const cache =
    upper === null
      ? 'edge_none'
      : EDGE_STATUSES.includes(upper)
        ? `edge_${upper.toLowerCase()}`
        : 'edge_other'
  const html = (headerOf(headers, 'content-type') ?? '').toLowerCase().includes('text/html')
  return {
    cache,
    mitigated: headerOf(headers, 'cf-mitigated') !== null || ((status === 403 || status === 429) && html),
  }
}

/**
 * The sentence `setup` aborts the run with when /health is not ok, its problems joined by spaces (each keeps its own
 * full stop until the last, where the sentence's own goes); null when it is ok.
 */
export function notOkSentenceOf(status, body) {
  if (status === 200 && body?.status === 'ok') return null
  const problems =
    Array.isArray(body?.problems) && body.problems.length
      ? body.problems.join(' ')
      : status === 0
        ? '/health did not answer'
        : `/health answered ${status} without status ok`
  return `The freshness server is not ok before the run: ${problems.replace(/\.$/, '')}. Fix it, then run again.`
}

/** A whole number with its thousands grouped. */
const grouped = (value) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Section 10's summary lines from k6's summary data, in place of k6's own text summary. */
export function summaryLines(data, parameters) {
  const metrics = data?.metrics ?? {}
  const number = (name, key) => {
    const value = metrics[name]?.values?.[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  const state = 'http_req_duration{route:state}'
  const wallet = 'http_req_duration{route:wallet}'
  const passes = number('state_not_modified', 'passes')
  const carried = passes + number('state_not_modified', 'fails')
  const cache = [...EDGE_STATUSES, 'other']
    .map((status) => [status, number(`edge_${status.toLowerCase()}`, 'count')])
    .filter(([, count]) => count > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
  const failed = Object.keys(metrics)
    .sort()
    .flatMap((name) =>
      Object.entries(metrics[name].thresholds ?? {})
        .filter(([, result]) => !result.ok)
        .map(([expression]) => `${name} ${expression}`),
    )
  return [
    `k6-freshness, ${parameters.profile} profile, against ${parameters.base}.`,
    `State: ${grouped(number(state, 'count'))} polls, ${grouped(passes)} of the ${grouped(carried)} that carried an ETag answered 304, p95 ${number(state, 'p(95)').toFixed(1)} ms.`,
    `Wallet: ${grouped(number(wallet, 'count'))} reads, p95 ${number(wallet, 'p(95)').toFixed(1)} ms.`,
    `Failed: ${(number('http_req_failed', 'rate') * 100).toFixed(2)}% of all requests. Dropped iterations: ${grouped(number('dropped_iterations', 'count'))}. Edge mitigations: ${grouped(number('edge_mitigated', 'count'))}.`,
    cache.length
      ? `Edge cache: ${cache.map(([status, count]) => `${status} ${grouped(count)}`).join(', ')}.`
      : 'Edge cache: no answer came through Cloudflare.',
    number('origin_busiest_per_s', 'count') > 0
      ? `Origin: the busiest collection drew at most ${number('origin_busiest_per_s', 'max').toFixed(1)} state requests a second; the wallet windows peaked at ${grouped(number('origin_wallet_windows_per_min', 'max'))} a minute.`
      : "Origin: /health carries no request counts; deploy this sub-project's freshness server first.",
    failed.length ? `Thresholds failed: ${failed.join(', ')}.` : 'Thresholds: every one passed.',
  ]
}
