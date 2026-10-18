// Deletes objects in the art bucket that were uploaded but never recorded: older than a day (by
// default) with no uploads.storage_key row (docs/specs/2026-10-09-lock-and-pay.md, section 9). The
// project's 5 GB cap counts recorded rows only, so these would otherwise take storage for good.
// Uses the service role and the storage credentials. Refuses anything but local endpoints unless
// --allow-remote is passed, so it can be scheduled later with care. With --allow-remote nothing is
// discovered from the local stack: the Supabase URL, the service key and every ART_S3_* variable must
// be in the environment, and the database and the bucket must both be remote. It prints the keys of
// unrecorded objects it deletes (or would delete); keys of recorded objects are never printed, and
// neither are secrets.
//
//   pnpm --filter @cobweb/web sweep:uploads --dry-run
//   options: --dry-run, --min-age-hours <n> (default 24), --prefix <key prefix>, --allow-remote
//
// Runs under `node --conditions=react-server` so the `server-only` marker the storage module
// imports resolves to its empty build. Locally, anything unset comes from `supabase status -o env`.

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { parseSweepArgs, sweepOrphans, type SweepArgs, type SweepReport } from '../src/lib/storage/sweep.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

let options: SweepArgs
try {
  options = parseSweepArgs(process.argv.slice(2))
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(2)
}

let statusCache: Record<string, string> | null = null
function supabaseStatus(): Record<string, string> {
  if (statusCache) return statusCache
  statusCache = {}
  try {
    const out = execFileSync('supabase', ['status', '-o', 'env'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const line of out.split('\n')) {
      const [, name, value] = line.match(/^([A-Z0-9_]+)=(.*)$/) ?? []
      if (name && value !== undefined) statusCache[name] = value.replace(/^"(.*)"$/, '$1')
    }
  } catch {
    // No local Supabase: everything must come from the environment.
  }
  return statusCache
}

function config(envName: string, statusNames: string[], fallback?: string): string {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const status = supabaseStatus()
  for (const name of statusNames) if (status[name]) return status[name]
  if (fallback !== undefined) return fallback
  throw new Error(`${envName} is unset and \`supabase status\` did not report ${statusNames.join(' or ')}`)
}

const local = (value: string | undefined) => {
  try {
    return !!value && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(value).hostname)
  } catch {
    return false
  }
}

function fromEnvOnly(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Refusing to run: ${name} is unset. With --allow-remote it must come from the environment.`)
    process.exit(2)
  }
  return value
}

let url: string
let serviceKey: string
if (options.allowRemote) {
  for (const name of [
    'ART_S3_ENDPOINT',
    'ART_S3_REGION',
    'ART_S3_BUCKET',
    'ART_S3_ACCESS_KEY_ID',
    'ART_S3_SECRET_ACCESS_KEY',
  ])
    fromEnvOnly(name)
  url = fromEnvOnly('NEXT_PUBLIC_SUPABASE_URL')
  serviceKey = fromEnvOnly('SUPABASE_SERVICE_ROLE_KEY')
} else {
  // The storage module reads ART_S3_* from the environment; fill them from the local status first.
  process.env.ART_S3_ENDPOINT = config('ART_S3_ENDPOINT', ['STORAGE_S3_URL'])
  process.env.ART_S3_REGION = config('ART_S3_REGION', ['S3_PROTOCOL_REGION'], 'local')
  process.env.ART_S3_BUCKET = config('ART_S3_BUCKET', [], 'art')
  process.env.ART_S3_ACCESS_KEY_ID = config('ART_S3_ACCESS_KEY_ID', ['S3_PROTOCOL_ACCESS_KEY_ID'])
  process.env.ART_S3_SECRET_ACCESS_KEY = config('ART_S3_SECRET_ACCESS_KEY', ['S3_PROTOCOL_ACCESS_KEY_SECRET'])
  process.env.ART_S3_FORCE_PATH_STYLE = '1'
  url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
  serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
}
const dbLocal = local(url)
const bucketLocal = local(process.env.ART_S3_ENDPOINT)
if (dbLocal !== bucketLocal) {
  console.error('Refusing to run: the database and the bucket must both be local or both be remote.')
  process.exit(2)
}
if (!options.allowRemote && !dbLocal) {
  console.error(
    `Refusing to run: ${url} and the storage endpoint must both be local. Pass --allow-remote to sweep a remote project, with care.`,
  )
  process.exit(2)
}
if (options.allowRemote && dbLocal) {
  console.error('Refusing to run: --allow-remote is for a remote project, but these are local.')
  process.exit(2)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
// Imported after the environment is set, so the storage client sees these values.
const { deleteObjects, listObjectPages } = await import('../src/lib/storage/objects.ts')

/**
 * Keys per uploads lookup. The lookup is a GET whose query string names each key: 50 keys of the longest shape make
 * about 6,400 characters, under the API gateway's 8 KB request line, which refuses a longer one with 414.
 */
const RECORDED_CHUNK = 50

let totals: SweepReport | null = null
const summary = (report: SweepReport) =>
  `${report.listed} objects listed, ${report.old} older than ${options.minAgeHours} hours, ${report.recorded} of those recorded.`

try {
  const report = await sweepOrphans(
    {
      list: listObjectPages,
      recorded: async (keys) => {
        const found = new Set<string>()
        for (let at = 0; at < keys.length; at += RECORDED_CHUNK) {
          const { data, error } = await admin
            .from('uploads')
            .select('storage_key')
            .in('storage_key', keys.slice(at, at + RECORDED_CHUNK))
          if (error) throw new Error(`The uploads could not be read: ${error.message}`)
          for (const row of data as { storage_key: string }[]) found.add(row.storage_key)
        }
        return found
      },
      remove: deleteObjects,
    },
    {
      prefix: options.prefix,
      minAgeMs: options.minAgeHours * 3_600_000,
      now: Date.now(),
      dryRun: options.dryRun,
      onPage: (page, running) => {
        totals = running
        console.log(`Page: ${page.listed} listed, ${page.old} old, ${page.orphaned.length} unrecorded.`)
        for (const key of page.orphaned) console.log(`${options.dryRun ? 'Would delete' : 'Deleted'} ${key}`)
      },
    },
  )
  console.log(summary(report))
  console.log(
    options.dryRun
      ? `${report.orphaned.length} unrecorded objects would be deleted (dry run).`
      : `${report.deleted} unrecorded objects deleted.`,
  )
} catch (e) {
  console.error(`The sweep stopped: ${e instanceof Error ? e.message : String(e)}`)
  const partial = totals as SweepReport | null
  if (partial) console.error(`Before it stopped: ${summary(partial)} ${partial.deleted} deleted.`)
  process.exit(1)
}
