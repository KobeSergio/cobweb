// Runs k6's local profile against the freshness server in process and a LOCAL Anvil chain
// (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 6): one collection deployed straight
// through the factory (the deploy simulated, then the simulated request sent), Holders open and Public scheduled
// 10 s ahead with a block mined every second, then `k6 run` as a child process for 20 s, judged by its exit code,
// its JSON summary and /health's request counts. The scheduled start falls inside the run, so the run also shows
// liveness turning under load, and never early. Ten PASS lines. Needs Anvil with the factory and k6 on the PATH;
// no Supabase (the indexer stays off).
//
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   brew install k6
//   pnpm --filter @cobweb/web verify:load
//
// The chain fixture (scripts/chain-fixture.ts) reads the settings from the environment and apps/web/.env.local
// and refuses a non-local endpoint. Never prints a key, and hands k6 none of its settings. The collection stays
// on Anvil, about 35 blocks later. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAddressEqual, parseEther, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { startFreshness, type Freshness, type HealthBody, type StateBody } from '@cobweb/freshness/server'
import {
  chain,
  chainReady,
  check,
  CID,
  collectionSalt,
  COLLECTION_CREATION_CODE,
  encodeCollectionArgs,
  factory,
  factoryAbi,
  predictCollectionAddress,
  rpc,
  runChecks,
  sendCall,
  sendRequest,
} from './chain-fixture.ts'

const { phaseCalls } = await import('../src/lib/manage/phase-calls.ts')

/** The launch groups the collection deploys with: Public (id 0) and Holders (id 1). */
const PUBLIC = 0
const HOLDERS = 1
/** Public's scheduled start, ahead of the latest block's time. */
const START_AHEAD_S = 10
const K6_SCRIPT = fileURLToPath(new URL('../../freshness/load/k6-freshness.js', import.meta.url))
const K6_MISSING = 'k6 is not installed; install it with brew install k6.'

const creatorKey = privateKeyToAccount(generatePrivateKey())

/** k6's JSON summary, the parts this script reads. */
type K6Metric = { values: Record<string, number>; thresholds?: Record<string, { ok: boolean }> }
type K6Summary = {
  metrics: Record<string, K6Metric>
  root_group: { checks: { name: string; passes: number; fails: number }[] }
}

let freshness: Freshness | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let mining: Promise<unknown> = Promise.resolve()
let k6: ChildProcess | null = null
let folder: string | null = null

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A request to the server, failed after 5 s so a hung answer fails its check instead of stalling it. */
async function get(path: string): Promise<Response> {
  if (!freshness) throw new Error('the server is not running')
  return fetch(`${freshness.url}${path}`, { signal: AbortSignal.timeout(5_000) })
}
const healthOf = async () => (await (await get('/health')).json()) as HealthBody

/**
 * A collection deployed straight through the factory from the creator, recording nothing: the deploy is
 * simulated, the factory's answer must be the predicted address, and the simulated request is sent as it is.
 */
async function deployCollection(): Promise<Address> {
  const args = encodeCollectionArgs({
    name: 'Load run',
    symbol: 'LOAD',
    payout: creatorKey.address,
    baseUri: `ipfs://${CID('e')}/`,
    maxSupply: 5n,
    groupSupplies: [3n, 2n],
    groupPrices: [0n, 0n],
    publicMaxPerWallet: 2n,
    royaltyBps: 500,
    owner: creatorKey.address,
    royaltyReceiver: creatorKey.address,
  })
  const salt = collectionSalt(randomUUID())
  const address = predictCollectionAddress({
    factory,
    deployer: creatorKey.address,
    salt,
    creationCode: COLLECTION_CREATION_CODE,
    args,
  })
  const { request, result } = await chain.simulateContract({
    account: creatorKey,
    address: factory,
    abi: factoryAbi,
    functionName: 'deployCollection',
    args: [COLLECTION_CREATION_CODE, args, salt],
  })
  if (!isAddressEqual(result, address))
    throw new Error(`the collection would deploy at ${result}, not ${address}`)
  await sendRequest(creatorKey, request)
  return address
}

/** Mines one block a second until `stopTicker`. */
function startTicker(): void {
  ticker = setInterval(() => {
    mining = chain.mine({ blocks: 1 }).catch(() => {})
  }, 1_000)
}

/** Stops the ticker and waits for a block it was mining. */
async function stopTicker(): Promise<void> {
  if (ticker) clearInterval(ticker)
  ticker = null
  await mining
}

/**
 * `k6 run` with the arguments, its output gathered; the exit code is null when k6 could not start. k6 sees its
 * PATH, HOME and NODE_ENV alone, so no setting of this process reaches its `__ENV`.
 */
function runK6(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    }
    const child = spawn('k6', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    k6 = child
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.once('error', (error) => resolve({ code: null, stdout, stderr: error.message }))
    child.once('close', (code) => {
      k6 = null
      resolve({ code, stdout, stderr })
    })
  })
}

async function main(): Promise<void> {
  const version = spawnSync('k6', ['version'], { encoding: 'utf8' })
  const k6Version = version.error ? null : (version.stdout.trim().split('\n')[0] ?? '')
  console.log(`Verifying the load run with ${k6Version ?? 'no k6'} against ${rpc}`)
  await check(
    '1. setup: k6 answers its version, Anvil answers as 31337 and the factory approves the shipped creation code hash',
    async () => (k6Version?.startsWith('k6 v') ? chainReady() : K6_MISSING),
  )
  await chain.setBalance({ address: creatorKey.address, value: parseEther('10') })
  const collection = await deployCollection()
  await sendCall(creatorKey, collection, phaseCalls.open(HOLDERS))
  freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337] })
  const server = freshness
  const T = Number((await chain.getBlock()).timestamp) + START_AHEAD_S
  await sendCall(creatorKey, collection, phaseCalls.schedule(PUBLIC, T))
  startTicker()

  await check(
    "2. server: with Holders open and Public scheduled 10 s ahead, the collection's first state read answers 200 with Public scheduled and inactive, and /health reads ok, counting that read alone",
    async () => {
      const answer = await get(`/v1/state/31337/${collection.toLowerCase()}`)
      if (answer.status !== 200) return `${answer.status} ${await answer.text()}`
      const groups = ((await answer.json()) as StateBody).groups
      const publicGroup = groups.find((group) => group.id === PUBLIC)
      const holders = groups.find((group) => group.id === HOLDERS)
      if (publicGroup?.startTimestamp !== T || publicGroup.active || publicGroup.flag || !holders?.active)
        return `groups ${JSON.stringify(groups)}`
      const health = await healthOf()
      if (health.status !== 'ok' || health.problems.length)
        return `${health.status}: ${health.problems.join(' ')}`
      const counted = {
        windowS: 60,
        state: 1,
        notModified: 0,
        wallet: 0,
        refused: 0,
        collections: 1,
        busiest: 1,
      }
      return JSON.stringify(health.requests) === JSON.stringify(counted)
        ? null
        : `requests ${JSON.stringify(health.requests)}`
    },
  )

  folder = await mkdtemp(join(tmpdir(), 'cobweb-load-'))
  const summaryFile = join(folder, 'summary.json')
  const run = await runK6([
    'run',
    '--quiet',
    '--no-color',
    '--no-usage-report',
    '-e',
    'PROFILE=local',
    '-e',
    `BASE=${server.url}`,
    '-e',
    `COLLECTIONS=31337/${collection}`,
    '-e',
    `SUMMARY_FILE=${summaryFile}`,
    K6_SCRIPT,
  ])
  let summary: K6Summary = { metrics: {}, root_group: { checks: [] } }
  const value = (name: string, key: string) => summary.metrics[name]?.values[key] ?? 0
  const checked = (name: string) => summary.root_group.checks.find((entry) => entry.name === name)

  await check(
    '3. run: k6 runs the local profile for 20 s, 100 state polls and 25 wallet reads a second, and exits 0 with every threshold passed',
    async () => {
      if (run.code === null) return K6_MISSING
      summary = JSON.parse(await readFile(summaryFile, 'utf8')) as K6Summary
      const failed = Object.entries(summary.metrics).flatMap(([name, metric]) =>
        Object.entries(metric.thresholds ?? {})
          .filter(([, result]) => !result.ok)
          .map(([expression]) => `${name} ${expression}`),
      )
      if (failed.length) return `k6 exited ${run.code}; thresholds failed: ${failed.join(', ')}`
      return run.code === 0 ? null : `k6 exited ${run.code}: ${run.stderr.trim().split('\n').pop()}`
    },
  )
  for (const line of run.stdout.split('\n').filter(Boolean)) console.log(`  ${line}`)

  await check(
    '4. state: at least 1,900 of the 2,000 planned state polls answered 200 or 304, with p95 under 200 ms and under 1% failed',
    async () => {
      const answered = value('state_answers', 'count')
      const p95 = value('http_req_duration{route:state}', 'p(95)')
      const failed = value('http_req_failed', 'rate')
      return answered >= 1_900 && p95 < 200 && failed < 0.01
        ? null
        : `${answered} answered, p95 ${p95} ms, ${failed * 100}% failed`
    },
  )

  await check(
    '5. 304: at least 90% of the polls that carried an ETag answered 304, each with the ETag it carried',
    async () => {
      const notModified = value('state_not_modified', 'passes')
      const carried = notModified + value('state_not_modified', 'fails')
      const tagged = checked('a 304 carries the ETag it was asked with')
      if (!carried || notModified / carried < 0.9) return `${notModified} of the ${carried} answered 304`
      return tagged?.passes === notModified && tagged.fails === 0
        ? null
        : `the ETag check: ${JSON.stringify(tagged)} for ${notModified} 304s`
    },
  )

  await check(
    '6. wallet: at least 475 of the 500 planned wallet reads answered 200, with p95 under 400 ms',
    async () => {
      const answered = value('wallet_answers', 'count')
      const p95 = value('http_req_duration{route:wallet}', 'p(95)')
      return answered >= 475 && p95 < 400 ? null : `${answered} answered, p95 ${p95} ms`
    },
  )

  await check(
    '7. liveness under load: polls before the start read Public scheduled and inactive, polls after it read Public active, and no poll read a group active by neither its flag nor a reached start',
    async () => {
      const waiting = value('scheduled_waiting_reads', 'count')
      const open = value('scheduled_open_reads', 'count')
      const early = value('early_open', 'count')
      return waiting > 0 && open > 0 && early === 0
        ? null
        : `${waiting} read Public waiting, ${open} read it open by its start, ${early} read a group early`
    },
  )

  await check(
    '8. degraded: no answer read degraded, and every /health read k6 made during the run was ok with no problem',
    async () => {
      const degraded = value('degraded_answers', 'count')
      const healthy = checked('/health answered 200 and ok')
      const problems = value('health_problems', 'max')
      return degraded === 0 && healthy && healthy.passes > 0 && healthy.fails === 0 && problems === 0
        ? null
        : `${degraded} degraded, /health ${JSON.stringify(healthy)}, at most ${problems} problems`
    },
  )

  await check(
    "9. origin counts: /health counts, over the last minute, exactly the run's state answers plus the setup's read, its 304s and its wallet answers, all on one collection, which is the busiest, and no refusal",
    async () => {
      const { requests } = await healthOf()
      const state = value('state_answers', 'count') + 1
      const counted = {
        windowS: 60,
        state,
        notModified: value('state_not_modified', 'passes'),
        wallet: value('wallet_answers', 'count'),
        refused: 0,
        collections: 1,
        busiest: state,
      }
      return JSON.stringify(requests) === JSON.stringify(counted)
        ? null
        : `/health ${JSON.stringify(requests)}, k6 ${JSON.stringify(counted)}`
    },
  )

  await check(
    '10. stop: the ticker stops, close() ends the server and its port refuses a connection',
    async () => {
      await stopTicker()
      const block = await chain.getBlockNumber({ cacheTime: 0 })
      await wait(1_500)
      const later = await chain.getBlockNumber({ cacheTime: 0 })
      if (later !== block) return `blocks ${block} then ${later}: the ticker still mines`
      await server.close()
      freshness = null
      try {
        await fetch(`${server.url}/health`, { signal: AbortSignal.timeout(2_000) })
        return 'the port still answers'
      } catch {
        return null
      }
    },
  )
}

async function cleanup(): Promise<void> {
  k6?.kill('SIGKILL')
  await stopTicker()
  await freshness?.close()
  if (folder) await rm(folder, { recursive: true, force: true })
}

await runChecks(main, cleanup)
