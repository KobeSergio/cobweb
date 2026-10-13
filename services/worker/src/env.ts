/**
 * The worker's configuration (docs/specs/2026-10-12-render-worker.md, section 10, as changed by
 * docs/specs/2026-10-13-render-worker-vercel.md, section 10) and the production wiring of the ports.
 * Every value comes from the record passed in: the process environment, locally and on Vercel. None of
 * the names starts with NEXT_PUBLIC_, none is read by a browser, and no value is ever logged. The queue
 * is passed in, because its client belongs to the caller (on Vercel, the SDK's `send`).
 */
import { S3Client } from '@aws-sdk/client-s3'
import type { S3ClientConfig } from '@aws-sdk/client-s3'
import type { Env } from '@cobweb/shared'
import type { RenderQueue } from '@cobweb/shared/render-queue'
import { createClient } from '@supabase/supabase-js'
import { FILEBASE_ENDPOINT, filebasePinner } from './adapters/filebase.ts'
import { s3Store } from './adapters/s3-store.ts'
import { supabaseJobs } from './adapters/supabase-jobs.ts'
import type { WorkerClient } from './adapters/supabase-jobs.ts'
import { viemChain } from './adapters/viem-chain.ts'
import { consoleLog } from './log.ts'
import type { Log } from './log.ts'
import { PRODUCTION_RETRY } from './steps.ts'
import type { Deps } from './steps.ts'

/** The fixed names. `RPC_URL_<chainId>` and `FACTORY_ADDRESS_<chainId>` are read per chain. */
export const WORKER_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ART_S3_ENDPOINT',
  'ART_S3_REGION',
  'ART_S3_BUCKET',
  'ART_S3_ACCESS_KEY_ID',
  'ART_S3_SECRET_ACCESS_KEY',
  'ART_S3_FORCE_PATH_STYLE',
  'RENDER_S3_BUCKET',
  'FILEBASE_S3_ENDPOINT',
  'FILEBASE_BUCKET',
  'FILEBASE_ACCESS_KEY_ID',
  'FILEBASE_SECRET_ACCESS_KEY',
] as const

/** A required value. The error names the variable and never a value. */
export function need(env: Env, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is not set.`)
  return value
}

// The SDK's default checksums add headers that Supabase Storage and Filebase do not all accept; the
// web app's storage client turns them off the same way (apps/web/src/lib/storage/config.ts).
const CHECKSUMS = {
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
} as const

/**
 * The storage client's options: R2 in production (endpoint `https://<account id>.r2.cloudflarestorage.com`,
 * region `auto`, path style on), Supabase Storage locally. With no access key the SDK's default
 * credential chain applies.
 */
export function artS3Options(env: Env): S3ClientConfig {
  const accessKeyId = env.ART_S3_ACCESS_KEY_ID
  const secretAccessKey = env.ART_S3_SECRET_ACCESS_KEY
  return {
    region: need(env, 'ART_S3_REGION'),
    ...(env.ART_S3_ENDPOINT ? { endpoint: env.ART_S3_ENDPOINT } : {}),
    forcePathStyle: env.ART_S3_FORCE_PATH_STYLE === '1',
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    ...CHECKSUMS,
  }
}

export function filebaseS3Options(env: Env): S3ClientConfig {
  return {
    region: 'us-east-1',
    endpoint: env.FILEBASE_S3_ENDPOINT || FILEBASE_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: need(env, 'FILEBASE_ACCESS_KEY_ID'),
      secretAccessKey: need(env, 'FILEBASE_SECRET_ACCESS_KEY'),
    },
    ...CHECKSUMS,
  }
}

/** The service-role client the worker owns. No session is kept. */
export function workerClient(env: Env): WorkerClient {
  return createClient(need(env, 'SUPABASE_URL'), need(env, 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Which route the ports are for: the queue consumer renders; the sweep only ever uses "jobs". */
export type DepsKind = 'render' | 'jobs'

export type DepsOptions = { queue: RenderQueue; log?: Log; kind?: DepsKind }

/** A port a route does not use: it fails loudly, by name, if it is ever called. */
class NotAvailable extends Error {
  constructor(what: string) {
    super(`${what} is not available in this function.`)
    this.name = 'NotAvailable'
  }
}

/**
 * Every port on its production adapter, around the queue the caller passes. Building it opens no
 * connection. For "jobs" (the sweep) only the jobs, queue and log ports are built, from the Supabase
 * URL and service key; storage, the pinning service and the chain are ports that throw.
 */
export function productionDeps(env: Env, options: DepsOptions): Deps {
  const { queue, log = consoleLog, kind = 'render' } = options
  // For rendering, checked before any client is built. The upload sweep deletes every object in the
  // art bucket that no upload row records, so a collage written there would be swept away.
  if (kind === 'render' && need(env, 'RENDER_S3_BUCKET') === need(env, 'ART_S3_BUCKET'))
    throw new Error('RENDER_S3_BUCKET must not be the art bucket.')
  const jobs = supabaseJobs(workerClient(env), { log })
  if (kind === 'jobs') {
    const unused = (what: string) => () => Promise.reject(new NotAvailable(what))
    return {
      jobs,
      queue,
      log,
      store: { load: unused('Storage'), putCollage: unused('Storage') },
      pinner: { pin: unused('The pinning service') },
      chain: { jobPayment: unused('The chain') },
      retry: PRODUCTION_RETRY,
    }
  }
  // Both buckets sit behind one client: R2 in production and Supabase Storage locally each serve both
  // from one endpoint with one key pair.
  const storage = new S3Client(artS3Options(env))
  return {
    jobs,
    store: s3Store(
      { client: storage, bucket: need(env, 'ART_S3_BUCKET') },
      { client: storage, bucket: need(env, 'RENDER_S3_BUCKET') },
    ),
    pinner: filebasePinner(new S3Client(filebaseS3Options(env)), need(env, 'FILEBASE_BUCKET')),
    chain: viemChain(env),
    queue,
    log,
    retry: PRODUCTION_RETRY,
  }
}
