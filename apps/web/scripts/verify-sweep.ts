// Checks the sweep against LOCAL Supabase storage: a recorded object and an unrecorded one under a
// scratch collection; the sweep script, run as a child process on that collection's prefix, lists
// only the unrecorded one in a dry run, keeps it while it is younger than the minimum age, deletes
// it with a minimum age of 0, and never touches the recorded one. Also checks the script refuses a
// remote Supabase. Then the daily cron's two ports (docs/specs/2026-10-17-production-hardening.md,
// section 14, point 8) on the same collection's prefix: the art bucket's, and the mint-page bucket's
// against the collection's page, and 80 day-old objects under that prefix, 40 of them recorded: more
// objects than one read can name under the API gateway's 8 KB request line (68 keys of this shape),
// judged by the script and the art port. Anything unset is discovered with `supabase status -o env`.
// Never prints a key. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.
//
//   pnpm --filter @cobweb/web verify:sweep

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { storageKey } from '../src/lib/storage/keys.ts'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(here, '../../..')

let statusCache: Record<string, string> | null = null
function supabaseStatus(): Record<string, string> {
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

function config(envName: string, statusNames: string[], fallback?: string): string {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const status = supabaseStatus()
  for (const name of statusNames) if (status[name]) return status[name]
  if (fallback !== undefined) return fallback
  throw new Error(`${envName} is unset and \`supabase status\` did not report ${statusNames.join(' or ')}`)
}

process.env.ART_S3_ENDPOINT = config('ART_S3_ENDPOINT', ['STORAGE_S3_URL'])
process.env.ART_S3_REGION = config('ART_S3_REGION', ['S3_PROTOCOL_REGION'], 'local')
process.env.ART_S3_BUCKET = config('ART_S3_BUCKET', [], 'art')
process.env.ART_S3_ACCESS_KEY_ID = config('ART_S3_ACCESS_KEY_ID', ['S3_PROTOCOL_ACCESS_KEY_ID'])
process.env.ART_S3_SECRET_ACCESS_KEY = config('ART_S3_SECRET_ACCESS_KEY', ['S3_PROTOCOL_ACCESS_KEY_SECRET'])
process.env.ART_S3_FORCE_PATH_STYLE = '1'
const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
process.env.NEXT_PUBLIC_SUPABASE_URL = url
process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey
for (const endpoint of [url, process.env.ART_S3_ENDPOINT])
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(endpoint).hostname)) {
    console.error(`Refusing to run: ${endpoint} is not local.`)
    process.exit(2)
  }

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, serviceKey, clientOptions)
const { deleteObjects, headObject, presignPut } = await import('../src/lib/storage/objects.ts')
const { sweepOrphans, UPLOAD_SWEEP_MIN_AGE_MS } = await import('../src/lib/storage/sweep.ts')
const { uploadSweepDeps } = await import('../src/lib/storage/upload-sweep-deps.ts')
const { mintPageBucket } = await import('../src/lib/storage/config.ts')
const { mintPageKey } = await import('../src/lib/mint/media.ts')

let passed = 0
const failed: string[] = []
async function check(name: string, fn: () => Promise<string | null>) {
  let problem: string | null
  try {
    problem = await fn()
  } catch (e) {
    problem = `threw ${e instanceof Error ? e.message : String(e)}`
  }
  if (problem === null) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed.push(name)
    console.log(`FAIL ${name}: ${problem}`)
  }
}

/** Runs the sweep script as `pnpm sweep:uploads` would, with these options and this environment. */
function sweep(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const run = spawnSync('node', ['--conditions=react-server', 'scripts/sweep-uploads.ts', ...args], {
    cwd: appRoot,
    encoding: 'utf8',
    env,
  })
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

// A 1 x 1 transparent PNG, and a second file that differs by one byte.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const OTHER = Buffer.concat([PNG, Buffer.from([0])])
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function put(key: string, body: Buffer, bucket?: string): Promise<void> {
  const res = await fetch(await presignPut(key, 'image/png', body.byteLength, 900, { bucket }), {
    method: 'PUT',
    body: new Uint8Array(body),
    headers: { 'Content-Type': 'image/png' },
  })
  if (!res.ok) throw new Error(`PUT ${res.status}`)
}

type Hex = `0x${string}`
const account = privateKeyToAccount(generatePrivateKey())
const creator = createClient(url, publishableKey, clientOptions)
let userId: string | null = null
let collectionId: string | null = null
let recordedKey = ''
let orphanKey = ''

await check('setup: a creator, a collection, a recorded object and an unrecorded one', async () => {
  const message = createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: 'localhost:3000',
    nonce: generateSiweNonce(),
    uri: 'http://localhost:3000',
    version: '1',
    statement: 'Sign in to Cobweb.',
    issuedAt: new Date(),
  })
  const signature: Hex = await account.signMessage({ message })
  const { data, error } = await creator.auth.signInWithWeb3({ chain: 'ethereum', message, signature })
  userId = data?.user?.id ?? null
  if (error || !userId) return `sign-in failed: ${error?.message ?? 'no user'}`
  const col = await creator
    .from('collections')
    .insert({ name: `Sweep ${Date.now()}`, symbol: 'SWP', project_type: 'one_of_one' })
    .select('id')
    .single()
  collectionId = (col.data as { id: string } | null)?.id ?? null
  if (col.error || !collectionId) return `collection: ${col.error?.message ?? 'no row'}`
  recordedKey = storageKey(collectionId, 'asset', sha(PNG), 'image/png')
  orphanKey = storageKey(collectionId, 'asset', sha(OTHER), 'image/png')
  await put(recordedKey, PNG)
  await put(orphanKey, OTHER)
  // As the upload action records it: through the service role, for the collection's owner.
  const recorded = await admin.rpc('record_upload', {
    p_owner_id: userId,
    p_collection_id: collectionId,
    p_kind: 'asset',
    p_storage_key: recordedKey,
    p_content_hash: sha(PNG),
    p_mime: 'image/png',
    p_media_type: 'image',
    p_bytes: PNG.byteLength,
    p_width: 1,
    p_height: 1,
    p_file_name: 'dot.png',
  })
  return recorded.error ? `record_upload: ${recorded.error.message}` : null
})

await check('sweep --dry-run: lists only the unrecorded object and deletes nothing', async () => {
  const { status, out } = sweep(['--dry-run', '--min-age-hours', '0', '--prefix', `${collectionId}/`])
  if (status !== 0) return `exit ${status}: ${out}`
  if (!out.includes(`Would delete ${orphanKey}`) || out.includes(`Would delete ${recordedKey}`)) return out
  return (await headObject(orphanKey)) ? null : 'the dry run deleted the object'
})

await check('sweep: an unrecorded object younger than a day stays', async () => {
  const { status, out } = sweep(['--prefix', `${collectionId}/`])
  if (status !== 0) return `exit ${status}: ${out}`
  if (!out.includes('0 unrecorded objects deleted.')) return out
  return (await headObject(orphanKey)) ? null : 'a recent object was deleted'
})

await check('sweep: past the minimum age the unrecorded object goes and the recorded one stays', async () => {
  const { status, out } = sweep(['--min-age-hours', '0', '--prefix', `${collectionId}/`])
  if (status !== 0) return `exit ${status}: ${out}`
  if (!out.includes(`Deleted ${orphanKey}`) || !out.includes('1 unrecorded objects deleted.')) return out
  if ((await headObject(orphanKey)) !== null) return 'the unrecorded object is still there'
  return (await headObject(recordedKey)) ? null : 'the recorded object was deleted'
})

await check('sweep: refuses a remote Supabase without --allow-remote', async () => {
  const { status, out } = sweep(['--dry-run'], {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  })
  return status === 2 && out.includes('Refusing to run') ? null : `exit ${status}: ${out}`
})

await check('sweep: refuses a remote bucket next to a local database', async () => {
  const { status, out } = sweep(['--dry-run'], {
    ...process.env,
    ART_S3_ENDPOINT: 'https://example.supabase.co/storage/v1/s3',
  })
  return status === 2 && out.includes('Refusing to run') ? null : `exit ${status}: ${out}`
})

await check('sweep: --allow-remote takes nothing from the local stack', async () => {
  const env = { ...process.env }
  delete env.SUPABASE_SERVICE_ROLE_KEY
  const { status, out } = sweep(['--dry-run', '--allow-remote'], env)
  return status === 2 && out.includes('SUPABASE_SERVICE_ROLE_KEY is unset') && !out.includes(serviceKey)
    ? null
    : `exit ${status}: ${out.replace(serviceKey, '[key]')}`
})

/** The cron's sweep of one port on this run's collection alone, past a minimum age of 0. */
const swept = (port: 'art' | 'media') =>
  sweepOrphans(uploadSweepDeps()[port], {
    prefix: `${collectionId}/`,
    minAgeMs: 0,
    now: Date.now(),
    dryRun: false,
  })

let lateKey = ''
await check(
  "upload sweep: the cron's art port deletes an unrecorded object and keeps the recorded one",
  async () => {
    lateKey = storageKey(collectionId!, 'placeholder', sha(Buffer.from('late')), 'image/png')
    await put(lateKey, OTHER)
    const report = await swept('art')
    if (report.deleted !== 1 || report.orphaned[0] !== lateKey) return `report ${JSON.stringify(report)}`
    if ((await headObject(lateKey)) !== null) return 'the unrecorded object is still there'
    return (await headObject(recordedKey)) ? null : 'the recorded object was deleted'
  },
)

/** More objects than one read can name under the gateway's 8 KB request line (68 keys of this shape). */
const BULK = 80
const bulkKeys: string[] = []
await check(
  "upload sweep: 80 day-old objects under one prefix, 40 recorded, are judged without a gateway refusal by the script's dry run and the cron's art port, which deletes the 40 unrecorded alone",
  async () => {
    const recordedBulk: string[] = []
    for (let n = 0; n < BULK; n++) {
      const body = Buffer.concat([PNG, Buffer.from(`bulk ${n}`)])
      const key = storageKey(collectionId!, 'asset', sha(body), 'image/png')
      bulkKeys.push(key)
      await put(key, body)
      if (n % 2) continue
      // As the upload action records it: through the service role, for the collection's owner.
      const recorded = await admin.rpc('record_upload', {
        p_owner_id: userId,
        p_collection_id: collectionId,
        p_kind: 'asset',
        p_storage_key: key,
        p_content_hash: sha(body),
        p_mime: 'image/png',
        p_media_type: 'image',
        p_bytes: body.byteLength,
        p_width: 1,
        p_height: 1,
        p_file_name: `bulk-${n}.png`,
      })
      if (recorded.error) return `record_upload: ${recorded.error.message}`
      recordedBulk.push(key)
    }
    const unrecorded = bulkKeys.filter((key) => !recordedBulk.includes(key))
    const problems: string[] = []
    const dry = sweep(['--dry-run', '--min-age-hours', '0', '--prefix', `${collectionId}/`])
    if (dry.status !== 0)
      problems.push(
        `script exit ${dry.status}: ${dry.out.split('\n').find((line) => line.startsWith('The sweep stopped'))}`,
      )
    else if (
      unrecorded.some((key) => !dry.out.includes(`Would delete ${key}`)) ||
      recordedBulk.some((key) => dry.out.includes(key))
    )
      problems.push('the script listed other objects than the unrecorded ones')
    try {
      // A day and a minute later, as the cron judges them.
      const report = await sweepOrphans(uploadSweepDeps().art, {
        prefix: `${collectionId}/`,
        minAgeMs: UPLOAD_SWEEP_MIN_AGE_MS,
        now: Date.now() + UPLOAD_SWEEP_MIN_AGE_MS + 60_000,
        dryRun: false,
      })
      const orphaned = new Set(report.orphaned)
      if (
        report.old < BULK ||
        unrecorded.some((key) => !orphaned.has(key)) ||
        recordedBulk.some((key) => orphaned.has(key)) ||
        report.deleted !== report.orphaned.length
      )
        problems.push(`port report ${JSON.stringify({ ...report, orphaned: report.orphaned.length })}`)
      for (const key of unrecorded) if ((await headObject(key)) !== null) problems.push(`kept ${key}`)
      for (const key of [recordedKey, ...recordedBulk])
        if ((await headObject(key)) === null) problems.push(`deleted ${key}`)
    } catch (e) {
      problems.push(`port threw ${e instanceof Error ? e.message : String(e)}`)
    }
    return problems.length ? problems.join('; ') : null
  },
)

const mediaBucket = mintPageBucket()
let savedMedia = ''
let unsavedMedia = ''
await check(
  "media sweep: the cron's mint page port deletes a file no page names and keeps the one the page names",
  async () => {
    savedMedia = mintPageKey(collectionId!, sha(PNG), 'image/png')
    unsavedMedia = mintPageKey(collectionId!, sha(OTHER), 'image/png')
    await put(savedMedia, PNG, mediaBucket)
    await put(unsavedMedia, OTHER, mediaBucket)
    const page = await creator
      .from('mint_pages')
      .insert({ collection_id: collectionId, banner_key: savedMedia })
    if (page.error) return `page: ${page.error.message}`
    const report = await swept('media')
    if (report.deleted !== 1 || report.orphaned[0] !== unsavedMedia) return `report ${JSON.stringify(report)}`
    if ((await headObject(unsavedMedia, { bucket: mediaBucket })) !== null)
      return 'the unsaved file is still there'
    return (await headObject(savedMedia, { bucket: mediaBucket })) ? null : 'the saved file was deleted'
  },
)

await check('cleanup: the run leaves no object, row or user behind', async () => {
  await deleteObjects([recordedKey, orphanKey, lateKey, ...bulkKeys].filter(Boolean))
  await deleteObjects([savedMedia, unsavedMedia].filter(Boolean), { bucket: mediaBucket })
  if (collectionId) {
    const { error } = await admin.from('collections').delete().eq('id', collectionId)
    if (error) return `collection: ${error.message}`
  }
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return error.message
  }
  return null
})

console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
