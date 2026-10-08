// Checks the object storage path against LOCAL Supabase storage: presign, PUT, HEAD, signed GET,
// delete, then the uploads rows and the 5 GB cap. Anything unset in the environment is discovered
// with `supabase status -o env` from the repo root, as verify-local.ts does. Refuses non-local
// endpoints. Never prints a key.
//
//   pnpm --filter @cobweb/web verify:storage
//
// Runs under `node --conditions=react-server` so the `server-only` marker the storage module
// imports resolves to its empty build instead of throwing.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { capProblem, PROJECT_CAP_BYTES } from '../src/lib/storage/admission.ts'
import { storageKey } from '../src/lib/storage/keys.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

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

// The storage module reads ART_S3_* from the environment; fill them from the local status first.
process.env.ART_S3_ENDPOINT = config('ART_S3_ENDPOINT', ['STORAGE_S3_URL'])
process.env.ART_S3_REGION = config('ART_S3_REGION', ['S3_PROTOCOL_REGION'], 'local')
process.env.ART_S3_BUCKET = config('ART_S3_BUCKET', [], 'art')
process.env.ART_S3_ACCESS_KEY_ID = config('ART_S3_ACCESS_KEY_ID', ['S3_PROTOCOL_ACCESS_KEY_ID'])
process.env.ART_S3_SECRET_ACCESS_KEY = config('ART_S3_SECRET_ACCESS_KEY', ['S3_PROTOCOL_ACCESS_KEY_SECRET'])
process.env.ART_S3_FORCE_PATH_STYLE = '1'
const endpoint = process.env.ART_S3_ENDPOINT
if (!['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname)) {
  console.error(`Refusing to run: ART_S3_ENDPOINT is "${endpoint}", not a local Supabase storage endpoint.`)
  process.exit(2)
}

const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, serviceKey, clientOptions)

// Imported after the environment is set, so the storage client sees the local values.
const { deleteObjects, headObject, presignGet, presignPut } = await import('../src/lib/storage/objects.ts')

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

// A 1 x 1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const hash = createHash('sha256').update(PNG).digest('hex')
const scratch = '00000000-0000-4000-8000-000000000001'
const key = storageKey(scratch, 'layer_image', hash, 'image/png')

let firstPutOk = false
await check('storage: a presigned PUT stores the object', async () => {
  const url = await presignPut(key, 'image/png', PNG.byteLength)
  const res = await fetch(url, { method: 'PUT', body: PNG, headers: { 'Content-Type': 'image/png' } })
  if (!res.ok) return `PUT ${res.status} ${await res.text()}`
  firstPutOk = true
  return null
})
await check('storage: a PUT with a different length is refused', async () => {
  if (!firstPutOk) return 'first PUT did not succeed'
  const url = await presignPut(key, 'image/png', PNG.byteLength + 5)
  const res = await fetch(url, { method: 'PUT', body: PNG, headers: { 'Content-Type': 'image/png' } })
  if (res.ok) return 'accepted a body of the wrong length'
  return res.status === 400 || res.status === 403 ? null : `refused with ${res.status}, expected 400 or 403`
})
await check('storage: HEAD reports the size and type', async () => {
  const head = await headObject(key)
  if (!head) return 'missing'
  return head.bytes === PNG.byteLength && head.mime === 'image/png' ? null : JSON.stringify(head)
})
await check('storage: a signed GET returns the bytes', async () => {
  const res = await fetch(await presignGet(key, 60))
  if (!res.ok) return `GET ${res.status}`
  const body = Buffer.from(await res.arrayBuffer())
  return body.equals(PNG) ? null : 'bytes differ'
})
await check('storage: delete removes the object', async () => {
  await deleteObjects([key])
  return (await headObject(key)) === null ? null : 'still there'
})

// Rows: record_upload as the actions call it, the duplicate that the action turns into reuse, and
// the project cap, with a throwaway wallet that is deleted at the end.
type Hex = `0x${string}`
const account = privateKeyToAccount(generatePrivateKey())
const creator = createClient(url, publishableKey, clientOptions)
let userId: string | null = null
let collectionId: string | null = null

await check('sign-in: a creator signs in with a wallet', async () => {
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
  return error || !userId ? `sign-in failed: ${error?.message ?? 'no user'}` : null
})
await check('collections: the creator makes a collection for this run', async () => {
  const { data, error } = await creator
    .from('collections')
    .insert({ name: `Storage ${Date.now()}`, symbol: 'STO', project_type: 'generative' })
    .select('id')
    .single()
  collectionId = (data as { id: string } | null)?.id ?? null
  return error || !collectionId ? `insert failed: ${error?.message ?? 'no row'}` : null
})

const recordInput = (cid: string, storage_key: string) => ({
  p_collection_id: cid,
  p_kind: 'layer_image' as const,
  p_storage_key: storage_key,
  p_content_hash: hash,
  p_mime: 'image/png',
  p_media_type: 'image' as const,
  p_bytes: PNG.byteLength,
  p_width: 1,
  p_height: 1,
  p_file_name: 'dot.png',
})

let recorded: string | null = null
await check('uploads: record_upload stores a row for a stored object', async () => {
  if (!collectionId) return 'no collection'
  recorded = storageKey(collectionId, 'layer_image', hash, 'image/png')
  const put = await fetch(await presignPut(recorded, 'image/png', PNG.byteLength), {
    method: 'PUT',
    body: PNG,
    headers: { 'Content-Type': 'image/png' },
  })
  if (!put.ok) return `PUT ${put.status}`
  const { data, error } = await creator.rpc('record_upload', recordInput(collectionId, recorded))
  return error ? `${error.code} ${error.message}` : data ? null : 'no id'
})
await check(
  'uploads: the same hash recorded twice is a 23505, which confirmUpload turns into reuse',
  async () => {
    if (!collectionId || !recorded) return 'no row'
    const { error } = await creator.rpc('record_upload', recordInput(collectionId, recorded))
    return error?.code === '23505' ? null : `expected 23505, got ${error?.code ?? 'success'}`
  },
)
await check('uploads: a layer image of another size is refused with the canvas sentence', async () => {
  if (!collectionId) return 'no collection'
  const otherHash = 'b'.repeat(64)
  const { error } = await creator.rpc('record_upload', {
    ...recordInput(collectionId, storageKey(collectionId, 'layer_image', otherHash, 'image/png')),
    p_content_hash: otherHash,
    p_width: 2,
    p_height: 2,
  })
  const want = 'Every layer image must be 1 x 1 in this project.'
  return error?.code === '23514' && error.message === want
    ? null
    : `expected 23514 "${want}", got ${error?.code ?? 'success'} ${error?.message ?? ''}`
})
await check('uploads: the cap refuses a file once the project holds 5 GB', async () => {
  if (!collectionId) return 'no collection'
  // Rows that sum past the cap, written by the service role: nothing near 5 GB is uploaded.
  const big = 50 * 1024 * 1024
  const rows = Array.from({ length: Math.ceil(PROJECT_CAP_BYTES / big) }, (_, i) => {
    const fakeHash = i.toString(16).padStart(64, '0')
    return {
      collection_id: collectionId as string,
      kind: 'asset' as const,
      storage_key: `${collectionId}/assets/${fakeHash}.mp4`,
      content_hash: fakeHash,
      mime: 'video/mp4',
      media_type: 'video' as const,
      bytes: big,
      file_name: `big-${i}.mp4`,
    }
  })
  const { error } = await admin.from('uploads').insert(rows)
  if (error) return `setup: ${error.code} ${error.message}`
  const { data: used } = await admin.from('uploads').select('bytes').eq('collection_id', collectionId)
  const usedBytes = (used ?? []).reduce((sum, row) => sum + Number(row.bytes), 0)
  if (!capProblem(usedBytes, 1)) return `cap not reached at ${usedBytes} bytes`
  const smallHash = 'd'.repeat(64)
  const { error: refused } = await creator.rpc('record_upload', {
    ...recordInput(collectionId as string, `${collectionId}/assets/${smallHash}.png`),
    p_kind: 'asset' as const,
    p_content_hash: smallHash,
  })
  const want = 'This project has reached its 5 GB of files. Delete some files to upload more.'
  return refused?.code === '23514' && refused.message === want
    ? null
    : `record_upload expected 23514 "${want}", got ${refused?.code ?? 'success'} ${refused?.message ?? ''}`
})
await check('cleanup: the run leaves no user, rows or object behind', async () => {
  if (recorded) await deleteObjects([recorded])
  // collections.owner_id is on delete restrict, so the collection (and its uploads) go first.
  if (collectionId) {
    const { error } = await admin.from('collections').delete().eq('id', collectionId)
    if (error) return `collection: ${error.message}`
  }
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return error.message
  }
  if (recorded && (await headObject(recorded)) !== null) return 'object remains'
  if (collectionId) {
    const { data } = await admin.from('uploads').select('id').eq('collection_id', collectionId)
    if (data && data.length > 0) return `${data.length} upload rows remain`
  }
  return null
})

console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
