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
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(endpoint)) {
  console.error(`Refusing to run: ART_S3_ENDPOINT is "${endpoint}", not a local Supabase storage endpoint.`)
  process.exit(2)
}

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

await check('storage: a presigned PUT stores the object', async () => {
  const url = await presignPut(key, 'image/png', PNG.byteLength)
  const res = await fetch(url, { method: 'PUT', body: PNG, headers: { 'Content-Type': 'image/png' } })
  return res.ok ? null : `PUT ${res.status} ${await res.text()}`
})
await check('storage: a PUT with a different length is refused', async () => {
  const url = await presignPut(key, 'image/png', PNG.byteLength + 5)
  const res = await fetch(url, { method: 'PUT', body: PNG, headers: { 'Content-Type': 'image/png' } })
  return res.ok ? 'accepted a body of the wrong length' : null
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

// ROWS (Task 3 appends the uploads checks here)

console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
