// Checks the Content-Security-Policy on a production build (docs/specs/2026-10-17-production-hardening.md, section
// 10): `next start` on port 3210 with CSP_MODE=enforce and VERCEL unset, then with CSP_MODE=report-only, reading
// the headers and every script of a JavaScript type in the HTML of the sign-in page, the sample mint page, the
// dashboard's redirect and the not-found page, an API route and a static file, and posting both report formats to
// the report endpoint. Ten PASS lines. Needs a production build made in sample mode and nothing else: no database,
// no chain.
//
//   NEXT_PUBLIC_DEMO_DATA=1 pnpm --filter @cobweb/web build
//   pnpm --filter @cobweb/web verify:csp
//
// The server's freshness origin is NEXT_PUBLIC_FRESHNESS_URL (from the environment or apps/web/.env.local), else
// http://127.0.0.1:3100, which the run sets. Runs under `node --conditions=react-server --import
// ./scripts/resolve-ts.mjs`. Never prints a key.

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAUNCH_CHAINS } from '@cobweb/shared'
import { CSP_REPORT_PATH, FRAME_POLICY } from '../src/lib/security/csp.ts'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3210
const BASE = `http://127.0.0.1:${PORT}`
const DEFAULT_FRESHNESS = 'http://127.0.0.1:3100'
const RELAY = 'wss://relay.walletconnect.org'
const START_TIMEOUT_MS = 60_000
/** A client's own policy and nonce, which the proxy drops before Next reads either (Review Focus 3). */
const CLIENT_CHOSEN: Record<string, string> = {
  'content-security-policy': "script-src 'nonce-Y2hvc2Vu'",
  'x-nonce': 'Y2hvc2Vu',
}

let passed = 0
const failed: string[] = []

/** A check returns null on success, or a description of what happened instead. */
async function check(name: string, fn: () => Promise<string | null>): Promise<void> {
  let problem: string | null
  try {
    problem = await fn()
  } catch (e) {
    problem = `threw ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
  }
  if (problem === null) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed.push(name)
    console.log(`FAIL ${name}: ${problem}`)
  }
}

/** The app's local settings, as `next start` loads them: the environment first, then apps/web/.env.local. */
function setting(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  const file = resolve(appRoot, '.env.local')
  if (!existsSync(file)) return undefined
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [, key, value] = line.match(/^([A-Z0-9_]+)=(.*)$/) ?? []
    if (key === name && value) return value.trim().replace(/^"(.*)"$/, '$1')
  }
  return undefined
}

const origin = (url: string | undefined) => (url ? new URL(url).origin : null)
const freshnessUrl = setting('NEXT_PUBLIC_FRESHNESS_URL') || DEFAULT_FRESHNESS
const supabaseOrigin = origin(setting('NEXT_PUBLIC_SUPABASE_URL'))

/** Whether something already listens on the port. */
function portBusy(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer()
    probe.once('error', () => done(true))
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(false)))
  })
}

type Server = { child: ChildProcess; output: string[] }
let server: Server | null = null

/** Whether the child has ended, by its own exit or by a signal. */
const ended = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null

/** `next start` on port 3210 in the given mode, VERCEL unset; resolves once / answers. */
async function startServer(mode: 'enforce' | 'report-only'): Promise<Server> {
  const next = createRequire(import.meta.url).resolve('next/dist/bin/next')
  const env: NodeJS.ProcessEnv = { ...process.env, CSP_MODE: mode, NEXT_PUBLIC_FRESHNESS_URL: freshnessUrl }
  delete env.VERCEL
  const child = spawn(process.execPath, [next, 'start', '--port', String(PORT), '--hostname', '127.0.0.1'], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output: string[] = []
  const collect = (chunk: Buffer) => output.push(...chunk.toString('utf8').split('\n').filter(Boolean))
  child.stdout!.on('data', collect)
  child.stderr!.on('data', collect)
  const started: Server = { child, output }
  server = started
  const until = Date.now() + START_TIMEOUT_MS
  while (Date.now() < until) {
    if (ended(child)) throw new Error(`next start ended with ${child.signalCode ?? child.exitCode}`)
    try {
      if ((await fetch(`${BASE}/`, { redirect: 'manual' })).status > 0) return started
    } catch {
      // Not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 250))
  }
  throw new Error(`next start did not answer within ${START_TIMEOUT_MS / 1000} s`)
}

/** Stops the server and waits for it to exit. */
async function stopServer(): Promise<void> {
  const running = server
  server = null
  if (!running || ended(running.child)) return
  const exited = new Promise<void>((done) => running.child.once('exit', () => done()))
  running.child.kill('SIGTERM')
  await Promise.race([exited, new Promise((wait) => setTimeout(wait, 10_000))])
  if (!ended(running.child)) running.child.kill('SIGKILL')
}

type Page = { status: number; headers: Headers; html: string }

async function get(path: string, headers: Record<string, string> = {}): Promise<Page> {
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual', headers })
  return { status: response.status, headers: response.headers, html: await response.text() }
}

/** The policy's directives by name. */
function directives(policy: string | null): Map<string, string[]> {
  return new Map(
    (policy ?? '')
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name = '', ...values] = entry.split(/\s+/)
        return [name, values]
      }),
  )
}

/** The nonce of a policy's script-src beside 'strict-dynamic', or null. */
function nonceOf(policy: string | null): string | null {
  const script = directives(policy).get('script-src') ?? []
  if (!script.includes("'strict-dynamic'")) return null
  const source = script.find((value) => value.startsWith("'nonce-"))
  return source ? source.slice("'nonce-".length, -1) : null
}

/** Every `<script>` of a JavaScript type: no type, a JavaScript MIME type or a module, with its nonce. */
function scriptsOf(html: string): { nonce: string | null }[] {
  return [...html.matchAll(/<script\b([^>]*)>/gi)].flatMap((match) => {
    const attributes = match[1] ?? ''
    const type = attributes.match(/\btype="([^"]*)"/i)?.[1]?.toLowerCase()
    if (type && type !== 'module' && !type.includes('javascript')) return []
    return [{ nonce: attributes.match(/\bnonce="([^"]*)"/i)?.[1] ?? null }]
  })
}

/** Null when the page has scripts and every one carries `nonce`. */
function scriptsOn(page: Page, nonce: string | null): string | null {
  const scripts = scriptsOf(page.html)
  if (!scripts.length) return 'no script in the HTML'
  const off = scripts.filter((script) => script.nonce !== nonce)
  return off.length ? `${off.length} of ${scripts.length} scripts without the response's nonce` : null
}

/** Null when the page carries the enforced page policy with a nonce its every script carries. */
function pagePolicyOn(page: Page): string | null {
  const policy = page.headers.get('content-security-policy')
  const nonce = nonceOf(policy)
  if (!nonce) return `no nonce beside 'strict-dynamic': ${policy?.slice(0, 120)}`
  return scriptsOn(page, nonce)
}

/** The server's lines since `from` that parse as a violation's JSON line. */
function violationLines(from: number): Record<string, unknown>[] {
  return (server?.output.slice(from) ?? []).flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      return typeof parsed === 'object' && parsed !== null && 'csp' in parsed ? [parsed] : []
    } catch {
      return []
    }
  })
}

async function post(body: string, type: string): Promise<number> {
  const response = await fetch(`${BASE}${CSP_REPORT_PATH}`, {
    method: 'POST',
    body,
    headers: { 'content-type': type },
  })
  return response.status
}

async function main(): Promise<void> {
  if (!existsSync(resolve(appRoot, '.next/BUILD_ID')))
    throw new Error('No production build: run NEXT_PUBLIC_DEMO_DATA=1 pnpm --filter @cobweb/web build first.')
  if (await portBusy(PORT)) throw new Error(`Port ${PORT} is in use.`)

  await check(
    'setup: the build answers on 3210 in sample mode, /night-owls rendering the sample page',
    async () => {
      await startServer('enforce')
      const page = await get('/night-owls')
      if (page.status !== 200) return `/night-owls answered ${page.status}`
      return page.html.includes('Night Owls')
        ? null
        : 'the sample collection is not on the page (build in sample mode)'
    },
  )

  let firstNonce: string | null = null
  await check(
    "sign-in page: / carries Content-Security-Policy with a nonce beside 'strict-dynamic' in script-src, no 'unsafe-eval' and no nonce in style-src, and every script carries that nonce",
    async () => {
      const page = await get('/')
      if (page.status !== 200) return `/ answered ${page.status}`
      const policy = directives(page.headers.get('content-security-policy'))
      if (policy.get('script-src')?.includes("'unsafe-eval'")) return "script-src carries 'unsafe-eval'"
      if (policy.get('style-src')?.some((source) => source.startsWith("'nonce-")))
        return 'style-src carries a nonce'
      firstNonce = nonceOf(page.headers.get('content-security-policy'))
      return pagePolicyOn(page)
    },
  )

  await check('per request: a second / carries another nonce, which its scripts carry', async () => {
    const page = await get('/')
    const nonce = nonceOf(page.headers.get('content-security-policy'))
    if (!nonce || nonce === firstNonce) return `the nonce ${nonce === firstNonce ? 'repeated' : 'is missing'}`
    return scriptsOn(page, nonce)
  })

  await check(
    "mint page: /night-owls renders per request with every script on its response's nonce, and connect-src lists each launch chain's RPC origin, the build's Supabase and freshness origins and the WalletConnect relay",
    async () => {
      const first = await get('/night-owls')
      const second = await get('/night-owls')
      const nonces = [first, second].map((page) => nonceOf(page.headers.get('content-security-policy')))
      if (!nonces[0] || nonces[0] === nonces[1])
        return `nonces ${nonces.join(' and ')}: not rendered per request`
      const scripts = pagePolicyOn(first) ?? pagePolicyOn(second)
      if (scripts) return scripts
      const connect = directives(first.headers.get('content-security-policy')).get('connect-src') ?? []
      const wanted = [
        ...LAUNCH_CHAINS.map((chain) => new URL(chain.viem.rpcUrls.default.http[0]!).origin),
        supabaseOrigin,
        new URL(freshnessUrl).origin,
        RELAY,
      ]
      const missing = wanted.filter((source) => !source || !connect.includes(source))
      return missing.length ? `connect-src lacks ${missing.join(', ')}` : null
    },
  )

  await check(
    'dashboard: /collections without a session answers its redirect to / with the page policy',
    async () => {
      const page = await get('/collections')
      const location = page.headers.get('location')
      if (page.status < 300 || page.status > 308 || !location || new URL(location, BASE).pathname !== '/')
        return `answered ${page.status} to ${location}`
      return nonceOf(page.headers.get('content-security-policy'))
        ? null
        : 'the redirect carries no page policy'
    },
  )

  await check('not found: /no/such/page answers 404 with the page policy and nonced scripts', async () => {
    const page = await get('/no/such/page')
    if (page.status !== 404) return `answered ${page.status}`
    return pagePolicyOn(page)
  })

  await check(
    "API and static: /api/uploads/<a random id> answers 404 with frame-ancestors 'none' alone, and /icon.svg carries X-Frame-Options DENY and no policy",
    async () => {
      const api = await get(`/api/uploads/${randomUUID()}`)
      if (api.status !== 404) return `the upload route answered ${api.status}`
      if (api.headers.get('content-security-policy') !== FRAME_POLICY)
        return `the upload route's policy: ${api.headers.get('content-security-policy')}`
      if (api.headers.get('content-security-policy-report-only')) return 'the upload route reports a policy'
      const icon = await get('/icon.svg')
      if (icon.status !== 200) return `/icon.svg answered ${icon.status}`
      if (icon.headers.get('x-frame-options') !== 'DENY')
        return `/icon.svg X-Frame-Options ${icon.headers.get('x-frame-options')}`
      return icon.headers.get('content-security-policy') ||
        icon.headers.get('content-security-policy-report-only')
        ? '/icon.svg carries a policy'
        : null
    },
  )

  await check(
    "report-only: started again with CSP_MODE=report-only, / asked with a client's own policy and nonce carries X-Frame-Options DENY and no enforced policy, and the full policy as Content-Security-Policy-Report-Only, its scripts on that policy's nonce, reporting through report-uri /api/csp-report with no report-to and no Reporting-Endpoints on this http server",
    async () => {
      await stopServer()
      await startServer('report-only')
      // In this mode the proxy sets no enforced policy on the request, so a client's own would be the one
      // Next reads its nonce from if the proxy kept it.
      const page = await get('/', CLIENT_CHOSEN)
      // Next copies the proxy's response headers into the request it renders, so an enforced framing policy would
      // hide the nonce: the framing block is X-Frame-Options in this mode.
      if (page.headers.get('content-security-policy') !== null)
        return `enforced policy: ${page.headers.get('content-security-policy')}`
      if (page.headers.get('x-frame-options') !== 'DENY')
        return `X-Frame-Options ${page.headers.get('x-frame-options')}`
      const reportOnly = page.headers.get('content-security-policy-report-only')
      const nonce = nonceOf(reportOnly)
      if (!nonce) return `no nonce in the report-only policy: ${reportOnly?.slice(0, 120)}`
      // The report origin is the one Next reads for the request, http://localhost:3210 for a local `next start`:
      // on http the policy names no report-to and the response no Reporting-Endpoints, which Chrome reads only on
      // https (and with report-to named it sends no report-uri report), so the browser reports through report-uri.
      const reporting = directives(reportOnly)
      if (reporting.get('report-uri')?.join(' ') !== CSP_REPORT_PATH)
        return `report-uri: ${reporting.get('report-uri')?.join(' ')}`
      if (reporting.has('report-to')) return `report-to on http: ${reporting.get('report-to')?.join(' ')}`
      if (page.headers.get('reporting-endpoints') !== null)
        return `Reporting-Endpoints on http: ${page.headers.get('reporting-endpoints')}`
      return scriptsOn(page, nonce)
    },
  )

  await check(
    'reports: a report-uri body and a Reporting API body each answer 204 and log one line with the directive, the blocked origin and the path; 17 KB answers 413 and another type 415',
    async () => {
      const from = server?.output.length ?? 0
      const legacy = JSON.stringify({
        'csp-report': {
          'document-uri': `${BASE}/night-owls?ref=verify`,
          'effective-directive': 'script-src-elem',
          'blocked-uri': 'https://evil.example/x.js?key=secret',
          disposition: 'enforce',
        },
      })
      const reporting = JSON.stringify([
        {
          type: 'csp-violation',
          body: {
            documentURL: `${BASE}/collections?tab=verify`,
            effectiveDirective: 'connect-src',
            blockedURL: 'wss://relay.evil.example/socket?key=secret',
            disposition: 'report',
          },
        },
      ])
      const statuses = [
        await post(legacy, 'application/csp-report'),
        await post(reporting, 'application/reports+json'),
      ]
      if (statuses.some((status) => status !== 204)) return `answered ${statuses.join(' and ')}`
      const wanted = [
        { directive: 'script-src-elem', blocked: 'https://evil.example', page: '/night-owls' },
        { directive: 'connect-src', blocked: 'wss://relay.evil.example', page: '/collections' },
      ]
      let lines: Record<string, unknown>[] = []
      for (let wait = 0; wait < 40 && lines.length < 2; wait++) {
        await new Promise((done) => setTimeout(done, 50))
        lines = violationLines(from)
      }
      for (const want of wanted)
        if (
          lines.filter((line) => Object.entries(want).every(([key, value]) => line[key] === value)).length !==
          1
        )
          return `no single line for ${want.directive}: ${JSON.stringify(lines)}`
      if (server?.output.slice(from).some((line) => line.includes('secret'))) return 'a line carries a query'
      const large = JSON.stringify({ 'csp-report': { 'blocked-uri': 'a'.repeat(17 * 1024) } })
      const tooLarge = await post(large, 'application/csp-report')
      const wrongType = await post(legacy, 'application/json')
      return tooLarge === 413 && wrongType === 415
        ? null
        : `17 KB answered ${tooLarge}, another type ${wrongType}`
    },
  )

  await check('stop: the server stops and port 3210 is free', async () => {
    await stopServer()
    return (await portBusy(PORT)) ? `port ${PORT} is still in use` : null
  })
}

try {
  await main()
} catch (e) {
  failed.push('run')
  console.log(`FAIL run: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
} finally {
  await stopServer()
}

console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
