/* global __ENV */
/**
 * The load run (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 5): pollers on the state
 * endpoint at their rate, each VU keeping the last ETag per collection as one browser's cache does and sending the
 * page's own request headers, wallet reads of wallets no other ask reads, and /health every 5 s for the origin's
 * own counts. It keeps the legacy script's shape alone (a failed rate and a 95th percentile as thresholds, a check
 * per route); nothing of it is copied. `verify:load` runs the local profile against Anvil; the owner runs the hosted
 * one behind Cloudflare:
 *
 *   k6 run --no-usage-report -e PROFILE=hosted -e BASE=https://<freshness domain> \
 *     -e COLLECTIONS=<chain id>/<address> -e SUMMARY_FILE=$HOME/k6-hosted.json apps/freshness/load/k6-freshness.js
 */
import { check, sleep } from 'k6'
import exec from 'k6/execution'
import http from 'k6/http'
import { Counter, Rate, Trend } from 'k6/metrics'
import {
  EDGE_COUNTERS,
  edgeOf,
  headerOf,
  livenessOf,
  notOkSentenceOf,
  optionsOf,
  parametersOf,
  statePathOf,
  summaryLines,
  walletOf,
  walletPathOf,
} from './profile.js'

const parameters = parametersOf(__ENV)
export const options = optionsOf(parameters)

const stateAnswers = new Counter('state_answers')
const notModified = new Rate('state_not_modified')
const earlyOpen = new Counter('early_open')
const scheduledOpenReads = new Counter('scheduled_open_reads')
const scheduledWaitingReads = new Counter('scheduled_waiting_reads')
const degradedAnswers = new Counter('degraded_answers')
const stateAge = new Trend('state_age_s')
const walletAnswers = new Counter('wallet_answers')
const edgeCounters = Object.fromEntries(EDGE_COUNTERS.map((name) => [name, new Counter(name)]))
const edgeMitigated = new Counter('edge_mitigated')
const healthProblems = new Trend('health_problems')
const originBusiest = new Trend('origin_busiest_per_s')
const originState = new Trend('origin_state_per_s')
const originWalletWindows = new Trend('origin_wallet_windows_per_min')
const healthCountsMissing = new Counter('health_counts_missing')

/** The last ETag this VU holds per state path, as one browser's cache keeps it. */
const held = {}
/** This VU's last /health read of the wallet windows and its time. */
let lastWindows = null

/** Counts an answer by its `cf-cache-status`, and as mitigated when the edge challenged or blocked it. */
function edge(answer) {
  const { cache, mitigated } = edgeOf(answer.status, answer.headers)
  edgeCounters[cache].add(1)
  if (mitigated) edgeMitigated.add(1)
}

/** An answer's JSON body, or null when it has none. */
function bodyOf(answer) {
  try {
    return answer.json()
  } catch {
    return null
  }
}

/** Reads /health once and aborts the run with section 10's sentence when it is not ok. */
export function setup() {
  const answer = http.get(`${parameters.base}/health`, { tags: { route: 'health', name: 'health' } })
  const sentence = notOkSentenceOf(answer.status, bodyOf(answer))
  if (sentence) exec.test.abort(sentence)
}

/**
 * One poll of the VU's collection: the page's `cache: 'reload'` headers while no ETag is held, then its
 * `cache: 'no-cache'` headers with the held ETag (decision 4).
 */
export function poll() {
  const collection = parameters.collections[exec.vu.idInTest % parameters.collections.length]
  const path = statePathOf(collection)
  const etag = held[path] ?? null
  const headers = etag
    ? { 'Cache-Control': 'max-age=0', 'If-None-Match': etag }
    : { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
  const answer = http.get(`${parameters.base}${path}`, { headers, tags: { route: 'state', name: 'state' } })
  edge(answer)
  const answered = answer.status === 200 || answer.status === 304
  check(answer, { 'state answered 200 or 304': () => answered })
  if (!answered) return
  stateAnswers.add(1)
  const age = Number(headerOf(answer.headers, 'age') ?? 0)
  stateAge.add(Number.isFinite(age) && age > 0 ? age : 0)
  if (etag) {
    notModified.add(answer.status === 304)
    if (answer.status === 304)
      check(answer, {
        'a 304 carries the ETag it was asked with': () => headerOf(answer.headers, 'etag') === etag,
      })
  }
  if (answer.status !== 200) return
  const tag = headerOf(answer.headers, 'etag')
  if (tag) held[path] = tag
  const body = bodyOf(answer)
  const own =
    body !== null &&
    body.chainId === collection.chainId &&
    String(body.address).toLowerCase() === collection.address.toLowerCase() &&
    Array.isArray(body.groups)
  check(answer, { "a 200 body is the asked collection's state": () => own })
  if (!own) return
  const liveness = livenessOf(body)
  earlyOpen.add(liveness.early)
  scheduledOpenReads.add(liveness.openBySchedule)
  scheduledWaitingReads.add(liveness.waiting)
  degradedAnswers.add(body.degraded === true ? 1 : 0)
}

/** One wallet read, of a wallet no other ask of this run or of another run reads. */
export function ask() {
  const n = exec.scenario.iterationInTest
  const collection = parameters.collections[n % parameters.collections.length]
  const wallet = walletOf(exec.scenario.startTime, n)
  const answer = http.get(`${parameters.base}${walletPathOf(collection, wallet)}`, {
    headers: { 'Cache-Control': 'max-age=0' },
    tags: { route: 'wallet', name: 'wallet' },
  })
  edge(answer)
  check(answer, { 'wallet answered 200': () => answer.status === 200 })
  if (answer.status === 200) walletAnswers.add(1)
}

/** /health every 5 s: ok, its problems, the origin's state requests a second and the wallet windows a minute. */
export function watch() {
  const answer = http.get(`${parameters.base}/health`, { tags: { route: 'health', name: 'health' } })
  edge(answer)
  const body = bodyOf(answer)
  check(answer, { '/health answered 200 and ok': () => answer.status === 200 && body?.status === 'ok' })
  if (body !== null) {
    if (Array.isArray(body.problems)) healthProblems.add(body.problems.length)
    if (body.requests) {
      originBusiest.add(body.requests.busiest / body.requests.windowS)
      originState.add(body.requests.state / body.requests.windowS)
    } else healthCountsMissing.add(1)
    if (body.wallet) {
      const now = Date.now()
      if (lastWindows !== null && now > lastWindows.at)
        originWalletWindows.add(
          ((body.wallet.windows - lastWindows.windows) * 60000) / (now - lastWindows.at),
        )
      lastWindows = { windows: body.wallet.windows, at: now }
    }
  }
  sleep(5)
}

/** Section 10's lines on standard output, and k6's JSON summary to SUMMARY_FILE when it is set. */
export function handleSummary(data) {
  const summary = { stdout: `${summaryLines(data, parameters).join('\n')}\n` }
  if (parameters.summaryFile) summary[parameters.summaryFile] = JSON.stringify(data)
  return summary
}
