// The local render dependencies that verify:render and render:local share
// (docs/specs/2026-10-14-render-screen-wiring.md, section 12), so the two cannot drift: the local
// Supabase, storage and Anvil settings (from the environment, `supabase status -o env` and
// apps/web/.env.local), the refusal of any endpoint that is not local, the service and storage clients,
// and the worker's ports on the production adapters for the database, storage and the chain, around a
// pinner and a queue the caller picks. Never prints a key.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { S3Client } from '@aws-sdk/client-s3'
import { isLocalUrl } from '@cobweb/shared'
import { artS3Options, consoleLog, s3Store, supabaseJobs, viemChain } from '@cobweb/worker'
import type { Chain, Deps, Log, Pinner } from '@cobweb/worker'
import type { MemoryQueue } from '@cobweb/worker/local'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAddress, type Address } from 'viem'
import type { Database } from '../src/lib/database.types.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '../../..')

/** Reads RPC_URL_31337 and FACTORY_ADDRESS_31337 from apps/web/.env.local when the environment does not set them. */
export function loadChainEnv(): void {
  const envFile = resolve(here, '../.env.local')
  if (!existsSync(envFile)) return
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const [, name, value] = line.match(/^(RPC_URL_31337|FACTORY_ADDRESS_31337)=(.*)$/) ?? []
    if (name && value && process.env[name] === undefined) process.env[name] = value.trim()
  }
}

let statusCache: Record<string, string> | null = null

/** `supabase status -o env` from the repo root, read once. */
export function supabaseStatus(): Record<string, string> {
  if (statusCache) return statusCache
  const out = execFileSync('supabase', ['status', '-o', 'env'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  statusCache = {}
  for (const line of out.split('\n')) {
    const [, name, value] = line.match(/^([A-Z0-9_]+)=(.*)$/) ?? []
    if (name && value !== undefined) statusCache[name] = value.replace(/^"(.*)"$/, '$1')
  }
  return statusCache
}

/** A setting from the environment, else from the local status under one of `statusNames`, else `fallback`. */
export function config(envName: string, statusNames: string[], fallback?: string): string {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const status = supabaseStatus()
  for (const name of statusNames) if (status[name]) return status[name]
  if (fallback !== undefined) return fallback
  throw new Error(`${envName} is unset and \`supabase status\` did not report ${statusNames.join(' or ')}`)
}

export type StorageEnv = Record<
  | 'ART_S3_ENDPOINT'
  | 'ART_S3_REGION'
  | 'ART_S3_ACCESS_KEY_ID'
  | 'ART_S3_SECRET_ACCESS_KEY'
  | 'ART_S3_FORCE_PATH_STYLE',
  string
>

export type LocalConfig = {
  url: string
  publishableKey: string
  serviceKey: string
  storage: StorageEnv
  artBucket: string
  renderBucket: string
  rpc: string
  factory: Address
}

/**
 * Every local setting, or an explanation on stderr and exit code 2. Refuses any endpoint that is not
 * local. Also fills the environment the web app's storage module and the worker's chain adapter read
 * (ART_S3_*, RENDER_S3_BUCKET, RPC_URL_31337, FACTORY_ADDRESS_31337) when it is not set already.
 */
export function localConfig(): LocalConfig {
  loadChainEnv()
  const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
  const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
  const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
  const storage: StorageEnv = {
    ART_S3_ENDPOINT: config('ART_S3_ENDPOINT', ['STORAGE_S3_URL']),
    ART_S3_REGION: config('ART_S3_REGION', ['S3_PROTOCOL_REGION'], 'local'),
    ART_S3_ACCESS_KEY_ID: config('ART_S3_ACCESS_KEY_ID', ['S3_PROTOCOL_ACCESS_KEY_ID']),
    ART_S3_SECRET_ACCESS_KEY: config('ART_S3_SECRET_ACCESS_KEY', ['S3_PROTOCOL_ACCESS_KEY_SECRET']),
    ART_S3_FORCE_PATH_STYLE: '1',
  }
  const artBucket = config('ART_S3_BUCKET', [], 'art')
  const renderBucket = config('RENDER_S3_BUCKET', [], 'render')
  const rpc = process.env.RPC_URL_31337
  const factoryEnv = process.env.FACTORY_ADDRESS_31337
  if (!rpc || !factoryEnv) {
    console.error(
      'Set RPC_URL_31337 and FACTORY_ADDRESS_31337: run `pnpm --filter @cobweb/web chain:local` and copy its two lines into apps/web/.env.local.',
    )
    process.exit(2)
  }
  for (const endpoint of [url, rpc, storage.ART_S3_ENDPOINT])
    if (!isLocalUrl(endpoint)) {
      // The host only: a hosted RPC URL carries its key in the path.
      let host = 'an unreadable address'
      try {
        host = new URL(endpoint).host
      } catch {
        // Keep the placeholder.
      }
      console.error(`Refusing to run: ${host} is not local (expected localhost or 127.0.0.1).`)
      process.exit(2)
    }
  for (const [name, value] of Object.entries(storage)) process.env[name] ??= value
  process.env.ART_S3_BUCKET ??= artBucket
  process.env.RENDER_S3_BUCKET ??= renderBucket
  return {
    url,
    publishableKey,
    serviceKey,
    storage,
    artBucket,
    renderBucket,
    rpc,
    factory: getAddress(factoryEnv),
  }
}

export type LocalClient = SupabaseClient<Database>
export const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}

/** The service-role client, as the worker's. */
export function adminClient(settings: LocalConfig): LocalClient {
  return createClient<Database>(settings.url, settings.serviceKey, clientOptions)
}

/** The storage client both local buckets sit behind, as the worker's. */
export function storageClient(settings: LocalConfig): S3Client {
  return new S3Client(artS3Options(settings.storage))
}

export type LocalDeps = Deps & { queue: MemoryQueue }

/**
 * The worker's ports on the production adapters for the database (the service client), storage (both
 * local buckets) and the chain (Anvil, read from the process environment), around the queue and the
 * pinner given. `chain` and `log` can be replaced, as verify:render does to count chain reads and keep
 * the log for a failure.
 */
export function localDeps(
  settings: LocalConfig,
  parts: { admin: LocalClient; s3: S3Client; queue: MemoryQueue; pinner: Pinner; chain?: Chain; log?: Log },
): LocalDeps {
  return {
    jobs: supabaseJobs(parts.admin),
    store: s3Store(
      { client: parts.s3, bucket: settings.artBucket },
      { client: parts.s3, bucket: settings.renderBucket },
    ),
    chain: parts.chain ?? viemChain(process.env),
    pinner: parts.pinner,
    queue: parts.queue,
    log: parts.log ?? consoleLog,
  }
}
