/**
 * The worker's configuration (docs/specs/2026-10-12-render-worker.md, section 10) and the
 * production wiring of the ports. Every value comes from the record passed in (the process
 * environment locally; the environment plus the Secrets Manager secret on Lambda). None of the
 * names starts with NEXT_PUBLIC_, none is read by a browser, and no value is ever logged.
 */
import { S3Client } from '@aws-sdk/client-s3'
import type { S3ClientConfig } from '@aws-sdk/client-s3'
import { SQSClient } from '@aws-sdk/client-sqs'
import type { Env } from '@cobweb/shared'
import { createClient } from '@supabase/supabase-js'
import { FILEBASE_ENDPOINT, filebasePinner } from './adapters/filebase.ts'
import { s3Store } from './adapters/s3-store.ts'
import { sqsRenderQueue } from './adapters/sqs.ts'
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
  'RENDER_QUEUE_URL',
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
 * The art bucket's client options. With no access key the SDK's default credentials apply, which on
 * Lambda is the function's role; locally the keys of Supabase Storage are set.
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

/** Which entry point the ports are for. The dead-letter and sweep functions only ever use "jobs". */
export type DepsKind = 'render' | 'jobs'

/** A port a function does not use: it fails loudly, by name, if it is ever called. */
class NotAvailable extends Error {
  constructor(what: string) {
    super(`${what} is not available in this function.`)
    this.name = 'NotAvailable'
  }
}

/**
 * Every port on its production adapter. Building it opens no connection. For "jobs" (the dead-letter
 * and sweep functions) only the jobs, queue and log ports are built, from the Supabase URL and
 * service key and the queue URL; storage, the pinning service and the chain are ports that throw,
 * so those functions never need, and never get, the render function's keys.
 */
export function productionDeps(env: Env, log: Log = consoleLog, kind: DepsKind = 'render'): Deps {
  // For the render function, checked before any client is built. The upload sweep deletes every object in
  // the art bucket that no upload row records, so a collage written there would be swept away.
  if (kind === 'render' && need(env, 'RENDER_S3_BUCKET') === need(env, 'ART_S3_BUCKET'))
    throw new Error('RENDER_S3_BUCKET must not be the art bucket.')
  const jobs = supabaseJobs(workerClient(env), { log })
  const queue = sqsRenderQueue(new SQSClient({}), need(env, 'RENDER_QUEUE_URL'))
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
  const art = new S3Client(artS3Options(env))
  // With an endpoint set (Supabase Storage, locally) both buckets live behind the art client. On
  // AWS the render bucket is the stack's own, reached with the function's role in its own region.
  const render = env.ART_S3_ENDPOINT ? art : new S3Client({ ...CHECKSUMS })
  return {
    jobs,
    store: s3Store(
      { client: art, bucket: need(env, 'ART_S3_BUCKET') },
      { client: render, bucket: need(env, 'RENDER_S3_BUCKET') },
    ),
    pinner: filebasePinner(new S3Client(filebaseS3Options(env)), need(env, 'FILEBASE_BUCKET')),
    chain: viemChain(env),
    queue,
    log,
    retry: PRODUCTION_RETRY,
  }
}
