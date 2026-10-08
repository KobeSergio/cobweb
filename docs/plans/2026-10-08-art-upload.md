# Layer and Asset Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload layer images, assets and placeholders from the browser to object storage by presigned URL, record them as `uploads` rows, and serve them back to the Art screens.

**Architecture:** A server-only storage module (`apps/web/src/lib/storage`) wraps the S3 SDK with content-hash keys and pure admission rules. Three server actions admit, confirm and delete uploads; one route handler redirects to signed GET URLs. In the browser, `createUploader` replaces the simulated `startUpload` behind the existing `UploadQueue` (hash, admit, XHR PUT with progress, thumbnail, confirm), and the folder-upload and assets hooks use it. Local development runs against Supabase's S3-compatible endpoint; production against an AWS bucket with the same code.

**Tech Stack:** Next 16 server actions and route handlers, `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, Web Crypto SHA-256, canvas thumbnails, XMLHttpRequest for upload progress, Vitest 5 (Node environment; the uploader is tested through injected dependencies), local Supabase storage.

**Spec:** [../specs/2026-10-08-art-upload.md](../specs/2026-10-08-art-upload.md)

## Global Constraints

- Keys are `<collection id>/<folder>/<sha256>.<ext>` with folders `layers`, `assets`, `placeholders`, `thumbnails`; the database refuses anything else (`uploads.storage_key` check) and `record_upload` pins the first segment to the collection.
- Admission limits: `layer_image` PNG, square, at most 2048 on a side, 10 MB, equal to the project canvas when set; `asset` and `placeholder` PNG, JPG or WebP to 20 MB, GIF to 10 MB, MP4 to 50 MB; `thumbnail` WebP to 1 MB and 256 on a side; 5 GB per project (5,368,709,120 bytes).
- Every server action: `getVerifiedUser`, an ownership read of `collections` under RLS, a refusal when `art_locked_at` is set with "The art is locked and cannot change.", then the database checks again through `record_upload` and RLS.
- Presigned PUTs are bound to `ContentType` and `ContentLength`; they expire after 15 minutes. Signed GETs expire after one hour. The bucket is private.
- `ART_S3_*` variables are server-only (never `NEXT_PUBLIC_`), never printed, never sent to the browser.
- Single PUT per file; pause aborts, resume and retry restart from zero. Failure copy: "The upload stopped. Retry to upload it again."
- `UploadQueue` keeps its public shape. The simulated `startUpload` is deleted.
- Prettier: no semicolons, single quotes, 110 columns. No em or en dashes. Creator-facing strings follow the existing checks' wording.

## Review Focus

Inputs the spec implies but no task's tests exercise. Each is pinned to the task that owns it.

1. A presigned PUT used after its 15 minutes, or a confirm for an object that never arrived: the bucket refuses the expired PUT, and `confirmUpload` refuses a key whose HEAD is missing or differs in size or type, so a stale client cannot record a row for nothing. Pinned by the HEAD comparison in Task 3 step 3 and the wrong-length check in `verify:storage` (Task 2); the final reviewer reads the confirm path for a way around it.
2. Two tabs admitting the same new file at once: both get a PUT URL for the same key and PUT the same bytes; the second `confirmUpload` hits the unique index `(collection_id, content_hash, kind)` and must return the existing row rather than an error. Pinned by the 23505 check in `verify:storage` (Task 3 step 4) and the reuse branch in Task 3 step 3.
3. A file whose declared hash does not match its bytes: the server never reads the bytes, so `content_hash` is client-declared and the key follows it. The cost is a wrong dedupe within one creator's own project, nothing across projects (the key is pinned to the collection). Documented in the actions file (Task 3 step 3); the render pipeline, which reads the file, is where a hash check belongs.
4. A file name with path separators or 300 characters: `fileName` is stored only as `file_name` and never used in the key; a long name is refused with a sentence, not a Postgres error (Task 3 step 1, `admissionInputProblem`).
5. The route handler for `variant=thumb` on an MP4 (no thumbnail row): falls back to the original key instead of 404 (Task 3 step 3; checked on the single-asset screen in the browser walk, Task 6 step 1).

---

### Task 1: Storage configuration, keys and admission rules

**Files:**

- Modify: `apps/web/package.json` (dependencies), `apps/web/.env.example`, `supabase/config.toml`
- Create: `apps/web/src/lib/storage/config.ts`, `apps/web/src/lib/storage/keys.ts`, `apps/web/src/lib/storage/admission.ts`
- Test: `apps/web/src/lib/storage/keys.test.ts`, `apps/web/src/lib/storage/admission.test.ts`

**Interfaces:**

- Produces: `UploadKind = 'layer_image' | 'asset' | 'placeholder' | 'thumbnail'`; `storageKey(collectionId: string, kind: UploadKind, contentHash: string, mime: string): string`; `extensionFor(mime: string): string` (`png | jpg | webp | gif | mp4`); `mediaTypeFor(mime: string): 'image' | 'gif' | 'video'`; `FileFacts = { mime: string; bytes: number; width: number | null; height: number | null }`; `Canvas = { width: number; height: number } | null`; `admissionProblem(kind: UploadKind, file: FileFacts, canvas: Canvas): string | null`; `PROJECT_CAP_BYTES = 5_368_709_120`; `capProblem(usedBytes: number, newBytes: number): string | null`; `storageConfig()` and `s3()` in `config.ts` (server only).

- [ ] **Step 1: Dependencies, env example, bucket**

```bash
pnpm --filter @cobweb/web add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Append to `apps/web/.env.example`:

```
# Object storage for layer images, assets and placeholders (server only; never NEXT_PUBLIC_).
# Local: run `supabase status -o env` and copy STORAGE_S3_URL, S3_PROTOCOL_REGION,
# S3_PROTOCOL_ACCESS_KEY_ID and S3_PROTOCOL_ACCESS_KEY_SECRET; the bucket is "art" and path style is on.
# Production: leave ART_S3_ENDPOINT unset for AWS, set the bucket's region and an IAM key scoped to it.
ART_S3_ENDPOINT=
ART_S3_REGION=
ART_S3_BUCKET=art
ART_S3_ACCESS_KEY_ID=
ART_S3_SECRET_ACCESS_KEY=
ART_S3_FORCE_PATH_STYLE=1
```

In `supabase/config.toml`, under the `[storage]` section's commented bucket example, add:

```toml
# Layer images, assets and placeholders (docs/specs/2026-10-08-art-upload.md). Private; the app
# serves files through signed URLs.
[storage.buckets.art]
public = false
file_size_limit = "50MiB"
allowed_mime_types = ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4"]
```

Fill `apps/web/.env.local` with the local values from `supabase status -o env` (the file is git-ignored). Run `supabase stop && supabase start` so the bucket exists; `supabase status` should list it without errors.

- [ ] **Step 2: Failing tests for keys and admission**

`apps/web/src/lib/storage/keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { extensionFor, mediaTypeFor, storageKey } from './keys'

const cid = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
const hash = 'a'.repeat(64)

describe('storageKey', () => {
  it('builds <collection>/<folder>/<hash>.<ext> for every kind', () => {
    expect(storageKey(cid, 'layer_image', hash, 'image/png')).toBe(`${cid}/layers/${hash}.png`)
    expect(storageKey(cid, 'asset', hash, 'image/jpeg')).toBe(`${cid}/assets/${hash}.jpg`)
    expect(storageKey(cid, 'placeholder', hash, 'video/mp4')).toBe(`${cid}/placeholders/${hash}.mp4`)
    expect(storageKey(cid, 'thumbnail', hash, 'image/webp')).toBe(`${cid}/thumbnails/${hash}.webp`)
  })
  it('refuses a hash that is not 64 lowercase hex', () => {
    expect(() => storageKey(cid, 'asset', 'ABC', 'image/png')).toThrow(/hash/)
  })
})

describe('mime mapping', () => {
  it('maps the five accepted types and nothing else', () => {
    expect(extensionFor('image/png')).toBe('png')
    expect(extensionFor('image/jpeg')).toBe('jpg')
    expect(extensionFor('image/webp')).toBe('webp')
    expect(extensionFor('image/gif')).toBe('gif')
    expect(extensionFor('video/mp4')).toBe('mp4')
    expect(() => extensionFor('text/plain')).toThrow(/type/)
    expect(mediaTypeFor('image/gif')).toBe('gif')
    expect(mediaTypeFor('video/mp4')).toBe('video')
    expect(mediaTypeFor('image/webp')).toBe('image')
  })
})
```

`apps/web/src/lib/storage/admission.ts` test, `admission.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { admissionProblem, capProblem, PROJECT_CAP_BYTES } from './admission'

const MB = 1024 * 1024
const png = (bytes: number, width: number, height: number) => ({ mime: 'image/png', bytes, width, height })

describe('admissionProblem', () => {
  it('accepts a square PNG layer image within the limits and the canvas', () => {
    expect(admissionProblem('layer_image', png(5 * MB, 1000, 1000), null)).toBeNull()
    expect(admissionProblem('layer_image', png(5 * MB, 1000, 1000), { width: 1000, height: 1000 })).toBeNull()
  })
  it('refuses layer images that are not PNG, too big, not square, over 2048 or off canvas', () => {
    expect(admissionProblem('layer_image', { ...png(1, 100, 100), mime: 'image/jpeg' }, null)).toBe('Not a PNG file.')
    expect(admissionProblem('layer_image', png(11 * MB, 100, 100), null)).toBe('11 MB is over the 10 MB limit.')
    expect(admissionProblem('layer_image', png(1, 1000, 900), null)).toBe('Must be square: 1000 x 900.')
    expect(admissionProblem('layer_image', png(1, 4096, 4096), null)).toBe('At most 2048 x 2048: 4096 x 4096.')
    expect(admissionProblem('layer_image', png(1, 1000, 1000), { width: 800, height: 800 })).toBe(
      'Every layer image must be 800 x 800 in this project.',
    )
    expect(admissionProblem('layer_image', { mime: 'image/png', bytes: 1, width: null, height: null }, null)).toBe(
      'This image could not be read. It may be damaged.',
    )
  })
  it('applies the asset rules by type', () => {
    expect(admissionProblem('asset', { mime: 'image/jpeg', bytes: 20 * MB, width: 10, height: 20 }, null)).toBeNull()
    expect(admissionProblem('asset', { mime: 'image/webp', bytes: 21 * MB, width: 10, height: 20 }, null)).toBe(
      '21 MB is over the 20 MB limit.',
    )
    expect(admissionProblem('asset', { mime: 'image/gif', bytes: 11 * MB, width: 10, height: 20 }, null)).toBe(
      '11 MB is over the 10 MB limit for a GIF.',
    )
    expect(admissionProblem('asset', { mime: 'video/mp4', bytes: 50 * MB, width: null, height: null }, null)).toBeNull()
    expect(admissionProblem('asset', { mime: 'video/mp4', bytes: 51 * MB, width: null, height: null }, null)).toBe(
      '51 MB is over the 50 MB limit for an MP4 video.',
    )
    expect(admissionProblem('asset', { mime: 'text/plain', bytes: 1, width: null, height: null }, null)).toBe(
      'Not a PNG, JPG, WebP, GIF or MP4 file.',
    )
    expect(admissionProblem('placeholder', { mime: 'image/gif', bytes: 1 * MB, width: 10, height: 10 }, null)).toBeNull()
  })
  it('limits thumbnails to small WebP files', () => {
    expect(admissionProblem('thumbnail', { mime: 'image/webp', bytes: 200_000, width: 256, height: 180 }, null)).toBeNull()
    expect(admissionProblem('thumbnail', { mime: 'image/png', bytes: 1, width: 10, height: 10 }, null)).toBe('Not a WebP file.')
    expect(admissionProblem('thumbnail', { mime: 'image/webp', bytes: 1, width: 300, height: 10 }, null)).toBe(
      'At most 256 x 256: 300 x 10.',
    )
  })
})

describe('capProblem', () => {
  it('allows up to the cap and refuses past it', () => {
    expect(capProblem(PROJECT_CAP_BYTES - 10, 10)).toBeNull()
    expect(capProblem(PROJECT_CAP_BYTES - 10, 11)).toBe(
      'This project has reached its 5 GB of files. Delete some files to upload more.',
    )
  })
})
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm --filter @cobweb/web test -- storage`
Expected: FAIL, `Cannot find module './keys'` and `'./admission'`.

- [ ] **Step 4: Implement keys and admission**

`apps/web/src/lib/storage/keys.ts`:

```ts
/**
 * Object keys for a project's files: `<collection id>/<folder>/<sha256>.<ext>`. The database's
 * `uploads.storage_key` check enforces this exact shape, and `record_upload` pins the first
 * segment to the collection, so a key can never point outside its project.
 */

export type UploadKind = 'layer_image' | 'asset' | 'placeholder' | 'thumbnail'

const FOLDER: Record<UploadKind, string> = {
  layer_image: 'layers',
  asset: 'assets',
  placeholder: 'placeholders',
  thumbnail: 'thumbnails',
}

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
}

export const ACCEPTED_MIME = Object.keys(EXTENSION)

export function extensionFor(mime: string): string {
  const ext = EXTENSION[mime]
  if (!ext) throw new Error(`Unsupported file type: ${mime}`)
  return ext
}

export function mediaTypeFor(mime: string): 'image' | 'gif' | 'video' {
  if (mime === 'video/mp4') return 'video'
  if (mime === 'image/gif') return 'gif'
  return 'image'
}

export function storageKey(collectionId: string, kind: UploadKind, contentHash: string, mime: string): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error('A content hash is 64 lowercase hex characters.')
  return `${collectionId}/${FOLDER[kind]}/${contentHash}.${extensionFor(mime)}`
}
```

`apps/web/src/lib/storage/admission.ts`:

```ts
import type { UploadKind } from './keys'

/**
 * Whether a file may be stored for a project, in the creator's words or null. The browser runs
 * this before it starts an upload; the server runs it again before signing one. The database
 * repeats the structural parts (square layer images, size ceiling) in `uploads` checks.
 */

export type FileFacts = { mime: string; bytes: number; width: number | null; height: number | null }
export type Canvas = { width: number; height: number } | null

const MB = 1024 * 1024
/** 5 GB of files per project (MASTER_PLAN, Art: storage limits). */
export const PROJECT_CAP_BYTES = 5 * 1024 * MB

const mb = (bytes: number) => `${Math.ceil(bytes / MB)} MB`

function sizeProblem(bytes: number, limit: number, what = ''): string | null {
  return bytes > limit ? `${mb(bytes)} is over the ${mb(limit)} limit${what}.` : null
}

export function admissionProblem(kind: UploadKind, file: FileFacts, canvas: Canvas): string | null {
  const { mime, bytes, width, height } = file
  if (kind === 'layer_image') {
    if (mime !== 'image/png') return 'Not a PNG file.'
    const size = sizeProblem(bytes, 10 * MB)
    if (size) return size
    if (width === null || height === null) return 'This image could not be read. It may be damaged.'
    if (width !== height) return `Must be square: ${width} x ${height}.`
    if (width > 2048) return `At most 2048 x 2048: ${width} x ${height}.`
    if (canvas && (width !== canvas.width || height !== canvas.height))
      return `Every layer image must be ${canvas.width} x ${canvas.height} in this project.`
    return null
  }
  if (kind === 'thumbnail') {
    if (mime !== 'image/webp') return 'Not a WebP file.'
    const size = sizeProblem(bytes, 1 * MB)
    if (size) return size
    if (width === null || height === null) return 'This image could not be read. It may be damaged.'
    if (width > 256 || height > 256) return `At most 256 x 256: ${width} x ${height}.`
    return null
  }
  // asset and placeholder
  if (mime === 'video/mp4') return sizeProblem(bytes, 50 * MB, ' for an MP4 video')
  if (mime === 'image/gif') return sizeProblem(bytes, 10 * MB, ' for a GIF')
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') {
    const size = sizeProblem(bytes, 20 * MB)
    if (size) return size
    if (width === null || height === null) return 'This image could not be read. It may be damaged.'
    return null
  }
  return 'Not a PNG, JPG, WebP, GIF or MP4 file.'
}

export function capProblem(usedBytes: number, newBytes: number): string | null {
  return usedBytes + newBytes > PROJECT_CAP_BYTES
    ? 'This project has reached its 5 GB of files. Delete some files to upload more.'
    : null
}
```

`apps/web/src/lib/storage/config.ts`:

```ts
import 'server-only'
import { S3Client } from '@aws-sdk/client-s3'

/** The `ART_S3_*` variables, read once. Throws a plain sentence when one is missing. */
export function storageConfig() {
  const bucket = process.env.ART_S3_BUCKET
  const region = process.env.ART_S3_REGION
  const accessKeyId = process.env.ART_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.ART_S3_SECRET_ACCESS_KEY
  if (!bucket || !region || !accessKeyId || !secretAccessKey)
    throw new Error('Object storage is not configured: set the ART_S3_* variables.')
  return {
    bucket,
    region,
    endpoint: process.env.ART_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.ART_S3_FORCE_PATH_STYLE === '1',
    credentials: { accessKeyId, secretAccessKey },
  }
}

let client: S3Client | null = null

/** One S3 client for the server process. */
export function s3(): S3Client {
  if (client) return client
  const { region, endpoint, forcePathStyle, credentials } = storageConfig()
  client = new S3Client({ region, endpoint, forcePathStyle, credentials })
  return client
}
```

- [ ] **Step 5: Run, expect pass; typecheck and lint**

Run: `pnpm --filter @cobweb/web test -- storage && pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: PASS; no type or lint errors. If `server-only` is not installed, it ships with Next; import it as shown.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/.env.example supabase/config.toml apps/web/src/lib/storage
git commit -m "Add the storage configuration, key shape and admission rules for uploads"
```

### Task 2: Object operations and the storage check script

**Files:**

- Create: `apps/web/src/lib/storage/objects.ts`, `apps/web/scripts/verify-storage.ts`
- Modify: `apps/web/package.json` (script `verify:storage`)

**Interfaces:**

- Consumes: `s3()`, `storageConfig()` from Task 1.
- Produces: `presignPut(key, mime, bytes, expiresSeconds = 900): Promise<string>`, `presignGet(key, expiresSeconds = 3600): Promise<string>`, `headObject(key): Promise<{ bytes: number; mime: string | null } | null>`, `deleteObjects(keys: string[]): Promise<void>`; the script `pnpm --filter @cobweb/web verify:storage`.

- [ ] **Step 1: The check script (fails until objects.ts exists)**

`apps/web/scripts/verify-storage.ts`:

```ts
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
import { storageKey } from '../src/lib/storage/keys'

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
    const [, name, value] = line.match(/^([A-Z_]+)=(.*)$/) ?? []
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
const { deleteObjects, headObject, presignGet, presignPut } = await import('../src/lib/storage/objects')

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
```

Add to `apps/web/package.json` scripts: `"verify:storage": "node --conditions=react-server scripts/verify-storage.ts"`.

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web verify:storage`
Expected: fails to import `../src/lib/storage/objects`.

- [ ] **Step 3: Implement objects.ts**

```ts
import 'server-only'
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3, storageConfig } from './config'

/** A PUT URL bound to the declared type and length, valid 15 minutes by default. */
export async function presignPut(key: string, mime: string, bytes: number, expiresSeconds = 900): Promise<string> {
  const { bucket } = storageConfig()
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime, ContentLength: bytes })
  return getSignedUrl(s3(), command, { expiresIn: expiresSeconds })
}

/** A GET URL for one object, valid an hour by default. */
export async function presignGet(key: string, expiresSeconds = 3600): Promise<string> {
  const { bucket } = storageConfig()
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresSeconds })
}

/** Size and type of a stored object, or null when there is none. */
export async function headObject(key: string): Promise<{ bytes: number; mime: string | null } | null> {
  const { bucket } = storageConfig()
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { bytes: Number(head.ContentLength ?? 0), mime: head.ContentType ?? null }
  } catch (e) {
    if ((e as { name?: string }).name === 'NotFound' || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
      return null
    throw e
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const { bucket } = storageConfig()
  await s3().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }))
}
```

`server-only` throws when imported without the `react-server` export condition (its `index.js` is a bare `throw`; `empty.js` is served under that condition), which is why the package script passes `--conditions=react-server`.

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @cobweb/web verify:storage`
Expected: 5 passed, 0 failed. If the wrong-length PUT is accepted, the local storage server does not enforce `ContentLength` on presigned PUTs; change that check to report `INFO` instead of `FAIL` with a note, since AWS does enforce it, and keep the server-side HEAD comparison in Task 3 as the real guard.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/storage/objects.ts apps/web/scripts/verify-storage.ts apps/web/package.json
git commit -m "Add presigned object operations and the storage check script"
```

### Task 3: Server actions and the route handler

**Files:**

- Create: `apps/web/src/app/actions/uploads.ts`, `apps/web/src/app/api/uploads/[id]/route.ts`, `apps/web/src/lib/storage/uploads-service.ts`
- Test: `apps/web/src/lib/storage/uploads-service.test.ts`
- Modify: `apps/web/scripts/verify-storage.ts` (record, route signing, cap, dedupe)

**Interfaces:**

- Consumes: Tasks 1 and 2; `getVerifiedUser` from `@/lib/auth` (the app has no separate session-only helper; the spec's `getSessionUser` means this), `createClient` from `@/lib/supabase/server`, `record_upload` RPC, `uploads` rows.
- Produces (types in `uploads-service.ts`, a pure module the browser also imports): `UploadRecord = { id: string; kind: UploadKind; fileName: string; mime: string; mediaType: 'image' | 'gif' | 'video'; bytes: number; width: number | null; height: number | null; url: string; thumbnailUrl: string | null }`; `AdmitInput`; `AdmitResult = { existing: true; upload: UploadRecord } | { existing: false; key: string; putUrl: string; thumbnail: { key: string; putUrl: string } | null }`; `ConfirmInput = AdmitInput & { key: string; thumbnailKey: string | null }`; actions `admitUpload(input): Promise<AdmitResult | { error: string }>`, `confirmUpload(input): Promise<{ upload: UploadRecord } | { error: string }>`, `deleteUpload(uploadId): Promise<{ ok: true } | { error: string }>`; pure helpers in `uploads-service.ts`: `toRecord(row)`, `servedUrl(id, variant?)`, `admissionInputProblem(input)` (shape checks: file name 1 to 255, hash 64 hex, kind in the three client kinds).

- [ ] **Step 1: Failing unit tests for the pure helpers**

`apps/web/src/lib/storage/uploads-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { admissionInputProblem, servedUrl, toRecord } from './uploads-service'

const row = {
  id: 'b4f2c9b1-0b3f-4d2a-8f6e-5a1b2c3d4e5f',
  kind: 'layer_image' as const,
  file_name: 'starry.png',
  mime: 'image/png',
  media_type: 'image' as const,
  bytes: 1234,
  width: 1000,
  height: 1000,
  content_hash: 'c'.repeat(64),
}

describe('uploads service helpers', () => {
  it('turns a row into the record the screens use, with served URLs', () => {
    expect(toRecord(row, true)).toEqual({
      id: row.id,
      kind: 'layer_image',
      fileName: 'starry.png',
      mime: 'image/png',
      mediaType: 'image',
      bytes: 1234,
      width: 1000,
      height: 1000,
      url: `/api/uploads/${row.id}`,
      thumbnailUrl: `/api/uploads/${row.id}?variant=thumb`,
    })
    expect(toRecord({ ...row, mime: 'video/mp4', media_type: 'video', width: null, height: null }, false).thumbnailUrl).toBeNull()
    expect(servedUrl(row.id)).toBe(`/api/uploads/${row.id}`)
  })
  it('refuses malformed admission input with a sentence', () => {
    const good = { collectionId: row.id, kind: 'asset' as const, fileName: 'a.png', mime: 'image/png', bytes: 1, width: 1, height: 1, contentHash: 'a'.repeat(64), thumbnail: null }
    expect(admissionInputProblem(good)).toBeNull()
    expect(admissionInputProblem({ ...good, fileName: '' })).toBe('The file needs a name.')
    expect(admissionInputProblem({ ...good, fileName: 'x'.repeat(256) })).toBe('The file name is too long (255 characters at most).')
    expect(admissionInputProblem({ ...good, contentHash: 'nope' })).toBe('The file could not be hashed. Try again.')
    expect(admissionInputProblem({ ...good, kind: 'thumbnail' as never })).toBe('Thumbnails are uploaded with their image, not on their own.')
    expect(admissionInputProblem({ ...good, collectionId: 'zzz' })).toBe('This collection could not be found.')
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web test -- uploads-service`
Expected: FAIL, `Cannot find module './uploads-service'`.

- [ ] **Step 3: Implement the service, the actions and the route**

`apps/web/src/lib/storage/uploads-service.ts` (pure; shared by the actions, the route and the check script):

```ts
import type { UploadKind } from './keys'

export type UploadRecord = {
  id: string
  kind: UploadKind
  fileName: string
  mime: string
  mediaType: 'image' | 'gif' | 'video'
  bytes: number
  width: number | null
  height: number | null
  /** Served through the app, which checks the session and redirects to a signed URL. */
  url: string
  thumbnailUrl: string | null
}

export type UploadRow = {
  id: string
  kind: UploadKind
  file_name: string
  mime: string
  media_type: 'image' | 'gif' | 'video'
  bytes: number
  width: number | null
  height: number | null
  content_hash: string
}

export type ThumbnailInput = { mime: 'image/webp'; bytes: number; width: number; height: number; contentHash: string }

export type AdmitResult =
  | { existing: true; upload: UploadRecord }
  | { existing: false; key: string; putUrl: string; thumbnail: { key: string; putUrl: string } | null }

export type AdmitInput = {
  collectionId: string
  kind: 'layer_image' | 'asset' | 'placeholder'
  fileName: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  contentHash: string
  thumbnail: ThumbnailInput | null
}

export type ConfirmInput = AdmitInput & { key: string; thumbnailKey: string | null }

export function servedUrl(id: string, variant?: 'thumb'): string {
  return variant ? `/api/uploads/${id}?variant=thumb` : `/api/uploads/${id}`
}

export function toRecord(row: UploadRow, hasThumbnail: boolean): UploadRecord {
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.file_name,
    mime: row.mime,
    mediaType: row.media_type,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    url: servedUrl(row.id),
    thumbnailUrl: hasThumbnail ? servedUrl(row.id, 'thumb') : null,
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/

/** Shape problems the admission rules do not cover, in the creator's words or null. */
export function admissionInputProblem(input: AdmitInput): string | null {
  if (!UUID.test(input.collectionId)) return 'This collection could not be found.'
  if ((input.kind as string) === 'thumbnail') return 'Thumbnails are uploaded with their image, not on their own.'
  if (!['layer_image', 'asset', 'placeholder'].includes(input.kind)) return 'This kind of file is not accepted.'
  if (!input.fileName.trim()) return 'The file needs a name.'
  if (input.fileName.length > 255) return 'The file name is too long (255 characters at most).'
  if (!HASH.test(input.contentHash)) return 'The file could not be hashed. Try again.'
  if (input.thumbnail && !HASH.test(input.thumbnail.contentHash)) return 'The file could not be hashed. Try again.'
  return null
}
```

`apps/web/src/app/actions/uploads.ts`:

```ts
'use server'

import { getVerifiedUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { admissionProblem, capProblem } from '@/lib/storage/admission'
import { mediaTypeFor, storageKey } from '@/lib/storage/keys'
import { deleteObjects, headObject, presignPut } from '@/lib/storage/objects'
import {
  admissionInputProblem,
  toRecord,
  type AdmitInput,
  type AdmitResult,
  type ConfirmInput,
  type UploadRecord,
  type UploadRow,
} from '@/lib/storage/uploads-service'

const SIGNED_OUT = 'Your session has ended. Sign in again to continue.'
const NOT_FOUND = 'This collection could not be found.'
const LOCKED = 'The art is locked and cannot change.'
const ROW_COLUMNS = 'id, kind, file_name, mime, media_type, bytes, width, height, content_hash'

/** The collection, only if the signed-in creator owns it and its art is not locked. */
async function ownedUnlocked(collectionId: string) {
  const user = await getVerifiedUser()
  if (!user) return { error: SIGNED_OUT }
  const supabase = await createClient()
  const { data } = await supabase
    .from('collections')
    .select('id, owner_id, art_locked_at, canvas_width, canvas_height')
    .eq('id', collectionId)
    .maybeSingle()
  if (!data || data.owner_id !== user.id) return { error: NOT_FOUND }
  if (data.art_locked_at) return { error: LOCKED }
  const canvas = data.canvas_width && data.canvas_height ? { width: data.canvas_width, height: data.canvas_height } : null
  return { supabase, canvas }
}

async function thumbnailRowFor(supabase: Awaited<ReturnType<typeof createClient>>, collectionId: string, hash: string) {
  const { data } = await supabase
    .from('uploads')
    .select('id')
    .eq('collection_id', collectionId)
    .eq('kind', 'thumbnail')
    .eq('storage_key', storageKey(collectionId, 'thumbnail', hash, 'image/webp'))
    .maybeSingle()
  return data
}

export async function admitUpload(input: AdmitInput): Promise<AdmitResult | { error: string }> {
  const shape = admissionInputProblem(input)
  if (shape) return { error: shape }
  const ctx = await ownedUnlocked(input.collectionId)
  if ('error' in ctx) return { error: ctx.error }
  const { supabase, canvas } = ctx

  const problem = admissionProblem(input.kind, input, canvas)
  if (problem) return { error: problem }
  if (input.thumbnail) {
    const thumb = admissionProblem('thumbnail', input.thumbnail, null)
    if (thumb) return { error: `Thumbnail: ${thumb}` }
  }

  const { data: existing } = await supabase
    .from('uploads')
    .select(ROW_COLUMNS)
    .eq('collection_id', input.collectionId)
    .eq('content_hash', input.contentHash)
    .eq('kind', input.kind)
    .maybeSingle()
  if (existing) {
    const thumb = await thumbnailRowFor(supabase, input.collectionId, input.contentHash)
    return { existing: true, upload: toRecord(existing as UploadRow, !!thumb) }
  }

  const { data: used } = await supabase.from('uploads').select('bytes').eq('collection_id', input.collectionId)
  const usedBytes = (used ?? []).reduce((sum, row) => sum + Number(row.bytes), 0)
  const cap = capProblem(usedBytes, input.bytes + (input.thumbnail?.bytes ?? 0))
  if (cap) return { error: cap }

  const key = storageKey(input.collectionId, input.kind, input.contentHash, input.mime)
  const putUrl = await presignPut(key, input.mime, input.bytes)
  let thumbnail: { key: string; putUrl: string } | null = null
  if (input.thumbnail) {
    // The thumbnail is named after the original's hash so the two pair without a join.
    const thumbKey = storageKey(input.collectionId, 'thumbnail', input.contentHash, 'image/webp')
    thumbnail = { key: thumbKey, putUrl: await presignPut(thumbKey, 'image/webp', input.thumbnail.bytes) }
  }
  return { existing: false, key, putUrl, thumbnail }
}

const INCOMPLETE = 'The upload did not arrive in full. Try again.'

/**
 * Records an upload after its PUT. The server checks what it can see (the object exists with the
 * declared size and type); the content hash is the client's word, which only affects dedupe inside
 * this creator's own project. A row is written only through `record_upload`.
 */
export async function confirmUpload(input: ConfirmInput): Promise<{ upload: UploadRecord } | { error: string }> {
  const shape = admissionInputProblem(input)
  if (shape) return { error: shape }
  const ctx = await ownedUnlocked(input.collectionId)
  if ('error' in ctx) return { error: ctx.error }
  const { supabase, canvas } = ctx
  const problem = admissionProblem(input.kind, input, canvas)
  if (problem) return { error: problem }

  const expectedKey = storageKey(input.collectionId, input.kind, input.contentHash, input.mime)
  if (input.key !== expectedKey) return { error: INCOMPLETE }
  const head = await headObject(input.key)
  if (!head || head.bytes !== input.bytes || head.mime !== input.mime) return { error: INCOMPLETE }
  let thumbHead: { bytes: number; mime: string | null } | null = null
  if (input.thumbnail && input.thumbnailKey) {
    if (input.thumbnailKey !== storageKey(input.collectionId, 'thumbnail', input.contentHash, 'image/webp'))
      return { error: INCOMPLETE }
    thumbHead = await headObject(input.thumbnailKey)
    if (!thumbHead || thumbHead.bytes !== input.thumbnail.bytes) return { error: INCOMPLETE }
  }

  const record = (kind: AdmitInput['kind'] | 'thumbnail', key: string, mime: string, bytes: number, width: number | null, height: number | null, hash: string) =>
    supabase.rpc('record_upload', {
      p_collection_id: input.collectionId,
      p_kind: kind,
      p_storage_key: key,
      p_content_hash: hash,
      p_mime: mime,
      p_media_type: mediaTypeFor(mime),
      p_bytes: bytes,
      p_width: width,
      p_height: height,
      p_file_name: input.fileName,
    })

  const main = await record(input.kind, input.key, input.mime, input.bytes, input.width, input.height, input.contentHash)
  let id = main.data as string | null
  if (main.error) {
    // Two tabs admitted the same file: the first one's row wins and this one reuses it.
    if (main.error.code !== '23505') return { error: main.error.message.includes('locked') ? LOCKED : INCOMPLETE }
    const { data } = await supabase
      .from('uploads')
      .select('id')
      .eq('collection_id', input.collectionId)
      .eq('content_hash', input.contentHash)
      .eq('kind', input.kind)
      .maybeSingle()
    id = data?.id ?? null
  }
  if (!id) return { error: INCOMPLETE }
  // The first layer image fixes the project's canvas; later ones were checked against it above.
  if (input.kind === 'layer_image' && !canvas && input.width && input.height)
    await supabase.from('collections').update({ canvas_width: input.width, canvas_height: input.height }).eq('id', input.collectionId)

  let hasThumbnail = false
  if (input.thumbnail && input.thumbnailKey && thumbHead) {
    const thumb = await record('thumbnail', input.thumbnailKey, 'image/webp', input.thumbnail.bytes, input.thumbnail.width, input.thumbnail.height, input.thumbnail.contentHash)
    hasThumbnail = !thumb.error || thumb.error.code === '23505'
  }
  const { data: row } = await supabase.from('uploads').select(ROW_COLUMNS).eq('id', id).single()
  return { upload: toRecord(row as UploadRow, hasThumbnail) }
}

export async function deleteUpload(uploadId: string): Promise<{ ok: true } | { error: string }> {
  const user = await getVerifiedUser()
  if (!user) return { error: SIGNED_OUT }
  const supabase = await createClient()
  const { data: row } = await supabase
    .from('uploads')
    .select('id, collection_id, kind, storage_key, content_hash')
    .eq('id', uploadId)
    .maybeSingle()
  if (!row) return { error: 'This file could not be found.' }
  const thumb = await thumbnailRowFor(supabase, row.collection_id, row.content_hash)
  const { error } = await supabase.from('uploads').delete().eq('id', row.id)
  if (error) {
    if (error.code === '23503') return { error: 'This image is used by a trait. Remove the trait first.' }
    if (error.code === '42501') return { error: LOCKED }
    return { error: 'The file could not be deleted. Try again.' }
  }
  const keys = [row.storage_key]
  if (thumb) {
    await supabase.from('uploads').delete().eq('id', thumb.id)
    keys.push(storageKey(row.collection_id, 'thumbnail', row.content_hash, 'image/webp'))
  }
  try {
    await deleteObjects(keys)
  } catch {
    // The rows are gone; a later sweep collects orphaned objects.
  }
  return { ok: true }
}
```

`apps/web/src/app/api/uploads/[id]/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { getVerifiedUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { storageKey } from '@/lib/storage/keys'
import { presignGet } from '@/lib/storage/objects'

/**
 * Serves a creator's stored file: checks the session, reads the row under RLS (so another
 * creator's file is a 404, not a 403), and redirects to a signed URL good for an hour. With
 * `?variant=thumb` it serves the browser-made thumbnail when there is one, else the original.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 })
  const user = await getVerifiedUser()
  if (!user) return new NextResponse(null, { status: 404 })
  const supabase = await createClient()
  const { data: row } = await supabase
    .from('uploads')
    .select('id, collection_id, kind, storage_key, content_hash, mime')
    .eq('id', id)
    .maybeSingle()
  if (!row) return new NextResponse(null, { status: 404 })

  let key = row.storage_key
  if (request.nextUrl.searchParams.get('variant') === 'thumb' && row.kind !== 'thumbnail') {
    const { data: thumb } = await supabase
      .from('uploads')
      .select('storage_key')
      .eq('collection_id', row.collection_id)
      .eq('kind', 'thumbnail')
      .eq('storage_key', storageKey(row.collection_id, 'thumbnail', row.content_hash, 'image/webp'))
      .maybeSingle()
    if (thumb) key = thumb.storage_key
  }
  const url = await presignGet(key, 3600)
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=3000' } })
}
```

- [ ] **Step 4: Extend the storage check script**

Add these imports to `verify-storage.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { capProblem, PROJECT_CAP_BYTES } from '../src/lib/storage/admission'
```

and, after the endpoint check, the Supabase clients:

```ts
const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, serviceKey, clientOptions)
```

Then replace the `// ROWS` line with the block below. The sign-in is the same SIWE flow `verify-local.ts` uses, repeated here rather than shared: the two scripts are standalone by design (each discovers its own configuration and refuses non-local hosts), and lifting 1,800 lines of invariants into a shared module for 30 lines of sign-in is not worth the risk to that script.

```ts
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
  p_kind: 'layer_image',
  p_storage_key: storage_key,
  p_content_hash: hash,
  p_mime: 'image/png',
  p_media_type: 'image',
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
await check('uploads: the same hash recorded twice is a 23505, which confirmUpload turns into reuse', async () => {
  if (!collectionId || !recorded) return 'no row'
  const { error } = await creator.rpc('record_upload', recordInput(collectionId, recorded))
  return error?.code === '23505' ? null : `expected 23505, got ${error?.code ?? 'success'}`
})
await check('uploads: the cap refuses a file once the project holds 5 GB', async () => {
  if (!collectionId) return 'no collection'
  // Rows that sum past the cap, written by the service role: nothing near 5 GB is uploaded.
  const big = 50 * 1024 * 1024
  const rows = Array.from({ length: Math.ceil(PROJECT_CAP_BYTES / big) }, (_, i) => {
    const fakeHash = i.toString(16).padStart(64, '0')
    return {
      collection_id: collectionId,
      kind: 'asset',
      storage_key: `${collectionId}/assets/${fakeHash}.mp4`,
      content_hash: fakeHash,
      mime: 'video/mp4',
      media_type: 'video',
      bytes: big,
      file_name: `big-${i}.mp4`,
    }
  })
  const { error } = await admin.from('uploads').insert(rows)
  if (error) return `setup: ${error.code} ${error.message}`
  const { data: used } = await admin.from('uploads').select('bytes').eq('collection_id', collectionId)
  const usedBytes = (used ?? []).reduce((sum, row) => sum + Number(row.bytes), 0)
  return capProblem(usedBytes, 1) ? null : `cap not reached at ${usedBytes} bytes`
})
await check('cleanup: the run leaves no user, rows or object behind', async () => {
  if (recorded) await deleteObjects([recorded])
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
```

Deleting the auth user cascades to its profile, the collection and the upload rows. The cap check exercises the same `capProblem` the action calls, over the rows the action would sum.

- [ ] **Step 5: Run everything**

Run: `pnpm --filter @cobweb/web test -- uploads-service && pnpm --filter @cobweb/web verify:storage && pnpm --filter @cobweb/web verify:local && pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: unit tests pass; verify:storage ends `11 passed, 0 failed` (or 10 with the length check as INFO); verify:local still passes; typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/actions/uploads.ts apps/web/src/app/api apps/web/src/lib/storage apps/web/scripts
git commit -m "Add the upload admission, confirmation and delete actions and the serving route"
```

### Task 4: The browser uploader

**Files:**

- Create: `apps/web/src/components/art/uploads/hash.ts`, `apps/web/src/components/art/uploads/thumbnail.ts`, `apps/web/src/components/art/uploads/uploader.ts`, `apps/web/src/components/art/uploads/create-uploader.ts`
- Delete (with `git mv` into `uploader.ts`, then rewrite): `apps/web/src/components/art/uploads/resumable-upload.ts`
- Modify: `apps/web/src/components/art/uploads/upload-queue.ts`, `apps/web/src/components/art/layers/folder-upload/use-folder-upload.ts:6,31`, `apps/web/src/components/art/assets-screen.tsx:27,50`
- Test: `apps/web/src/components/art/uploads/hash.test.ts`, `apps/web/src/components/art/uploads/thumbnail.test.ts`, `apps/web/src/components/art/uploads/uploader.test.ts`

**Interfaces:**

- Consumes: `AdmitInput`, `AdmitResult`, `ConfirmInput`, `UploadRecord` from `@/lib/storage/uploads-service` (pure module); `admissionProblem` from `@/lib/storage/admission`; `admitUpload`, `confirmUpload` from `@/app/actions/uploads` (only in `create-uploader.ts`).
- Produces: `sha256Hex(blob: Blob): Promise<string>`; `fitWithin(width, height, side): { width; height }`; `inspectFile(file: File): Promise<Inspected>`; `Inspected = { width: number | null; height: number | null; thumbnail: { blob: Blob; width: number; height: number } | null }`; `Put = (url, body: Blob, mime, onProgress: (sent: number) => void, signal: AbortSignal) => Promise<void>`; `UploaderDeps = { admit; confirm; hash; inspect; put }`; `UploaderOptions = { collectionId: string; kind: 'layer_image' | 'asset' | 'placeholder' }`; `uploaderWith(options, deps): StartUpload` (pure core); `createUploader(options): StartUpload` (browser wiring); `STOPPED = 'The upload stopped. Retry to upload it again.'`; `UploadProgress` gains `uploadId?: string` and `record?: UploadRecord`; `QueueItem` gains the same two fields; `UploadQueue` constructor is `(concurrency: number, start: StartUpload)` with no default; `useUploadQueue(concurrency: number, start: StartUpload)`.

Deviation from spec section 8, decided at plan time: `createUploader` takes `{ collectionId, kind }` and no `canvas`. The folder hook already refuses images that differ in size from the first one, and the server checks every layer image against the collection's canvas columns, which it owns. A client-side canvas check would be a third copy that the queue (built once per screen) could not keep current. Cost if wrong: a mismatched image fails at `admitUpload` instead of before the first byte, with the same sentence.

- [ ] **Step 1: Failing tests for the hash and the thumbnail geometry**

`apps/web/src/components/art/uploads/hash.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './hash'

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
  it('is lowercase hex of 64 characters for an empty blob', async () => {
    expect(await sha256Hex(new Blob([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})
```

`apps/web/src/components/art/uploads/thumbnail.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fitWithin, THUMBNAIL_SIDE } from './thumbnail'

describe('fitWithin', () => {
  it('scales the long side to 256 and keeps the ratio', () => {
    expect(fitWithin(2048, 2048, THUMBNAIL_SIDE)).toEqual({ width: 256, height: 256 })
    expect(fitWithin(1000, 500, THUMBNAIL_SIDE)).toEqual({ width: 256, height: 128 })
    expect(fitWithin(300, 900, THUMBNAIL_SIDE)).toEqual({ width: 85, height: 256 })
  })
  it('never enlarges a small image and never returns 0', () => {
    expect(fitWithin(100, 40, THUMBNAIL_SIDE)).toEqual({ width: 100, height: 40 })
    expect(fitWithin(5000, 1, THUMBNAIL_SIDE)).toEqual({ width: 256, height: 1 })
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web test -- uploads/hash uploads/thumbnail`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement hash.ts and thumbnail.ts**

`hash.ts`:

```ts
/** SHA-256 of a blob as 64 lowercase hex characters, the content hash behind every storage key. */
export async function sha256Hex(blob: Blob, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
```

`thumbnail.ts`:

```ts
/**
 * Reads an image's pixel size and draws its 256 px WebP thumbnail in the browser, so the Layers
 * and Assets screens never load a full-size file for a grid. Videos and unreadable files report
 * nulls; the server then stores no thumbnail row and the route falls back to the original.
 */

export type Inspected = {
  width: number | null
  height: number | null
  thumbnail: { blob: Blob; width: number; height: number } | null
}

export const THUMBNAIL_SIDE = 256
const THUMBNAIL_MAX_BYTES = 1024 * 1024

/** The size an image gets when its long side is scaled down to `side`; small images stay as they are. */
export function fitWithin(width: number, height: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const NOTHING: Inspected = { width: null, height: null, thumbnail: null }

export async function inspectFile(file: File): Promise<Inspected> {
  if (!file.type.startsWith('image/')) return NOTHING
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return NOTHING
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, THUMBNAIL_SIDE)
    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) return { width: bitmap.width, height: bitmap.height, thumbnail: null }
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
    const usable = blob.type === 'image/webp' && blob.size <= THUMBNAIL_MAX_BYTES
    return { width: bitmap.width, height: bitmap.height, thumbnail: usable ? { blob, ...size } : null }
  } catch {
    return { width: bitmap.width, height: bitmap.height, thumbnail: null }
  } finally {
    bitmap.close()
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @cobweb/web test -- uploads/hash uploads/thumbnail`
Expected: PASS (4 tests).

- [ ] **Step 5: Failing tests for the uploader state machine**

`apps/web/src/components/art/uploads/uploader.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AdmitInput, ConfirmInput, UploadRecord } from '@/lib/storage/uploads-service'
import { STOPPED, uploaderWith, type Put, type UploaderDeps, type UploadProgress } from './uploader'

const cid = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
const FILE_HASH = 'a'.repeat(64)
const THUMB_HASH = 'b'.repeat(64)
const key = `${cid}/layers/${FILE_HASH}.png`
const thumbKey = `${cid}/thumbnails/${FILE_HASH}.webp`
const record: UploadRecord = {
  id: 'b4f2c9b1-0b3f-4d2a-8f6e-5a1b2c3d4e5f',
  kind: 'layer_image',
  fileName: 'starry.png',
  mime: 'image/png',
  mediaType: 'image',
  bytes: 1000,
  width: 1000,
  height: 1000,
  url: '/api/uploads/b4f2c9b1-0b3f-4d2a-8f6e-5a1b2c3d4e5f',
  thumbnailUrl: '/api/uploads/b4f2c9b1-0b3f-4d2a-8f6e-5a1b2c3d4e5f?variant=thumb',
}

type FakePut = { url: string; body: Blob; signal: AbortSignal; progress: (sent: number) => void; resolve: () => void; reject: (e: Error) => void }

function harness(overrides: Partial<UploaderDeps> = {}) {
  const puts: FakePut[] = []
  const admitCalls: AdmitInput[] = []
  const confirmCalls: ConfirmInput[] = []
  const put: Put = (url, body, _mime, onProgress, signal) =>
    new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      puts.push({ url, body, signal, progress: onProgress, resolve, reject })
    })
  const deps: UploaderDeps = {
    hash: async (blob) => (blob.type === 'image/webp' ? THUMB_HASH : FILE_HASH),
    inspect: async () => ({
      width: 1000,
      height: 1000,
      thumbnail: { blob: new Blob(['thumb'], { type: 'image/webp' }), width: 256, height: 256 },
    }),
    admit: async (input) => {
      admitCalls.push(input)
      return { existing: false, key, putUrl: 'https://bucket/file', thumbnail: { key: thumbKey, putUrl: 'https://bucket/thumb' } }
    },
    confirm: async (input) => {
      confirmCalls.push(input)
      return { upload: record }
    },
    put,
    ...overrides,
  }
  const start = uploaderWith({ collectionId: cid, kind: 'layer_image' }, deps)
  const file = new File([new Uint8Array(1000)], 'starry.png', { type: 'image/png' })
  const seen: UploadProgress[] = []
  const handle = start(file)
  handle.progress$.subscribe((p) => seen.push(p))
  const latest = () => seen[seen.length - 1]!
  return { puts, admitCalls, confirmCalls, handle, seen, latest }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
async function until(condition: () => boolean) {
  for (let i = 0; i < 50 && !condition(); i++) await tick()
  if (!condition()) throw new Error('the condition never held')
}

describe('uploaderWith', () => {
  it('hashes, admits, PUTs the file then the thumbnail with progress, confirms with the keys', async () => {
    const h = harness()
    await until(() => h.puts.length === 1)
    expect(h.admitCalls[0]).toMatchObject({ collectionId: cid, kind: 'layer_image', fileName: 'starry.png', mime: 'image/png', bytes: 1000, width: 1000, height: 1000, contentHash: FILE_HASH })
    expect(h.admitCalls[0]!.thumbnail).toMatchObject({ mime: 'image/webp', bytes: 5, width: 256, height: 256, contentHash: THUMB_HASH })
    h.puts[0]!.progress(400)
    expect(h.latest()).toMatchObject({ state: 'uploading', sentBytes: 400, totalBytes: 1000 })
    h.puts[0]!.resolve()
    await until(() => h.puts.length === 2)
    expect(h.puts[1]!.url).toBe('https://bucket/thumb')
    h.puts[1]!.resolve()
    await until(() => h.latest().state === 'done')
    expect(h.confirmCalls[0]).toMatchObject({ key, thumbnailKey: thumbKey, contentHash: FILE_HASH })
    expect(h.latest()).toMatchObject({ state: 'done', sentBytes: 1000, url: record.url, uploadId: record.id, record })
  })

  it('is done at once when the project already has the file', async () => {
    const h = harness({ admit: async () => ({ existing: true, upload: record }) })
    await until(() => h.latest().state === 'done')
    expect(h.puts).toHaveLength(0)
    expect(h.latest()).toMatchObject({ sentBytes: 1000, uploadId: record.id })
  })

  it('fails with the stopped sentence when the PUT breaks, and retry starts over from zero', async () => {
    const h = harness()
    await until(() => h.puts.length === 1)
    h.puts[0]!.progress(700)
    h.puts[0]!.reject(new Error('network'))
    await until(() => h.latest().state === 'failed')
    expect(h.latest()).toMatchObject({ sentBytes: 0, error: STOPPED })
    h.handle.retry()
    await until(() => h.puts.length === 2)
    expect(h.puts[1]!.url).toBe('https://bucket/file')
    expect(h.latest()).toMatchObject({ state: 'uploading', sentBytes: 0 })
    expect(h.admitCalls).toHaveLength(2)
  })

  it('pause aborts the PUT and resume starts it again from zero', async () => {
    const h = harness()
    await until(() => h.puts.length === 1)
    h.puts[0]!.progress(500)
    h.handle.pause()
    expect(h.puts[0]!.signal.aborted).toBe(true)
    await tick()
    expect(h.latest().state).toBe('paused')
    h.handle.resume()
    await until(() => h.puts.length === 2)
    expect(h.latest()).toMatchObject({ state: 'uploading', sentBytes: 0 })
  })

  it('fails with the server sentence when confirm refuses', async () => {
    const h = harness({ confirm: async () => ({ error: 'The upload did not arrive in full. Try again.' }) })
    await until(() => h.puts.length === 1)
    h.puts[0]!.resolve()
    await until(() => h.puts.length === 2)
    h.puts[1]!.resolve()
    await until(() => h.latest().state === 'failed')
    expect(h.latest().error).toBe('The upload did not arrive in full. Try again.')
  })

  it('refuses a file the rules refuse before asking the server', async () => {
    const h = harness({ inspect: async () => ({ width: 1000, height: 900, thumbnail: null }) })
    await until(() => h.latest().state === 'failed')
    expect(h.latest().error).toBe('Must be square: 1000 x 900.')
    expect(h.admitCalls).toHaveLength(0)
  })

  it('emits nothing after cancel', async () => {
    const h = harness()
    await until(() => h.puts.length === 1)
    const count = h.seen.length
    h.handle.cancel()
    h.puts[0]!.progress(900)
    h.puts[0]!.resolve()
    await tick()
    expect(h.seen).toHaveLength(count)
  })
})
```

- [ ] **Step 6: Run, expect failure**

Run: `pnpm --filter @cobweb/web test -- uploads/uploader`
Expected: FAIL, `Cannot find module './uploader'`.

- [ ] **Step 7: Move the types and write the uploader core**

```bash
git mv apps/web/src/components/art/uploads/resumable-upload.ts apps/web/src/components/art/uploads/uploader.ts
```

Replace the whole content of `uploader.ts` with:

```ts
import { admissionProblem } from '@/lib/storage/admission'
import type { AdmitInput, AdmitResult, ConfirmInput, UploadRecord } from '@/lib/storage/uploads-service'
import type { Inspected } from './thumbnail'

/**
 * One file's upload: progress as a stream, and pause, resume and retry.
 *
 * A file goes up in one PUT to a presigned URL (docs/specs/2026-10-08-art-upload.md, section 8):
 * hash and inspect, ask the server to admit it, PUT the file and its thumbnail, then ask the server
 * to confirm and record it. Pause aborts the PUT; resume and retry start the PUT again from zero.
 * The hash and thumbnail are computed once per file and reused across retries.
 *
 * `uploaderWith` takes its dependencies so the state machine can be tested without a browser;
 * `createUploader` (create-uploader.ts) wires the real ones.
 */

export type UploadState = 'uploading' | 'paused' | 'done' | 'failed'

export type UploadProgress = {
  state: UploadState
  /** Bytes of the file sent so far. Back to 0 whenever the PUT restarts. */
  sentBytes: number
  totalBytes: number
  /** Why it failed, in words the creator can act on. */
  error?: string
  /** Where the stored file is served from, once done. */
  url?: string
  /** The `uploads` row, once done. */
  uploadId?: string
  record?: UploadRecord
}

/** A minimal observable: `subscribe` returns the unsubscribe. */
export type Observable<T> = { subscribe(listener: (value: T) => void): () => void }

export type UploadHandle = {
  progress$: Observable<UploadProgress>
  pause(): void
  resume(): void
  retry(): void
  /** Stops for good and frees what the upload holds. */
  cancel(): void
}

export type StartUpload = (file: File) => UploadHandle

export type Put = (
  url: string,
  body: Blob,
  mime: string,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
) => Promise<void>

export type UploaderDeps = {
  admit: (input: AdmitInput) => Promise<AdmitResult | { error: string }>
  confirm: (input: ConfirmInput) => Promise<{ upload: UploadRecord } | { error: string }>
  hash: (blob: Blob) => Promise<string>
  inspect: (file: File) => Promise<Inspected>
  put: Put
}

export type UploaderOptions = { collectionId: string; kind: 'layer_image' | 'asset' | 'placeholder' }

export const STOPPED = 'The upload stopped. Retry to upload it again.'

type Prepared = { input: AdmitInput; thumbnailBlob: Blob | null }

export function uploaderWith(options: UploaderOptions, deps: UploaderDeps): StartUpload {
  const { collectionId, kind } = options
  return (file) => {
    const listeners = new Set<(value: UploadProgress) => void>()
    let progress: UploadProgress = { state: 'uploading', sentBytes: 0, totalBytes: file.size }
    let controller: AbortController | null = null
    // Each run has a number; a pause, cancel or restart raises it, and the old run's results are dropped.
    let generation = 0
    let prepared: Promise<Prepared> | null = null

    const emit = (patch: Partial<UploadProgress>) => {
      progress = { ...progress, ...patch }
      for (const listener of listeners) listener(progress)
    }

    const prepare = () =>
      (prepared ??= (async () => {
        const seen = await deps.inspect(file)
        const contentHash = await deps.hash(file)
        const thumbnail = seen.thumbnail
          ? {
              mime: 'image/webp' as const,
              bytes: seen.thumbnail.blob.size,
              width: seen.thumbnail.width,
              height: seen.thumbnail.height,
              contentHash: await deps.hash(seen.thumbnail.blob),
            }
          : null
        const input: AdmitInput = {
          collectionId,
          kind,
          fileName: file.name,
          mime: file.type,
          bytes: file.size,
          width: seen.width,
          height: seen.height,
          contentHash,
          thumbnail,
        }
        return { input, thumbnailBlob: seen.thumbnail?.blob ?? null }
      })())

    const run = async () => {
      const mine = ++generation
      const live = () => mine === generation
      controller = new AbortController()
      const { signal } = controller
      emit({ state: 'uploading', sentBytes: 0, error: undefined })
      try {
        const { input, thumbnailBlob } = await prepare()
        if (!live()) return
        const problem = admissionProblem(kind, input, null)
        if (problem) return emit({ state: 'failed', error: problem })
        const admitted = await deps.admit(input)
        if (!live()) return
        if ('error' in admitted) return emit({ state: 'failed', error: admitted.error })
        if (admitted.existing) return finish(admitted.upload)
        await deps.put(
          admitted.putUrl,
          file,
          input.mime,
          (sent) => {
            if (live()) emit({ sentBytes: Math.min(sent, file.size) })
          },
          signal,
        )
        if (!live()) return
        if (admitted.thumbnail && thumbnailBlob)
          await deps.put(admitted.thumbnail.putUrl, thumbnailBlob, 'image/webp', () => {}, signal)
        if (!live()) return
        const confirmed = await deps.confirm({
          ...input,
          key: admitted.key,
          thumbnailKey: admitted.thumbnail?.key ?? null,
        })
        if (!live()) return
        if ('error' in confirmed) return emit({ state: 'failed', sentBytes: 0, error: confirmed.error })
        finish(confirmed.upload)
      } catch {
        // A paused or cancelled run was aborted on purpose and has already said so.
        if (live()) emit({ state: 'failed', sentBytes: 0, error: STOPPED })
      }
    }

    const finish = (record: UploadRecord) =>
      emit({ state: 'done', sentBytes: file.size, url: record.url, uploadId: record.id, record })

    const stop = () => {
      generation++
      controller?.abort()
      controller = null
    }

    void run()

    return {
      progress$: {
        subscribe(listener) {
          listeners.add(listener)
          listener(progress)
          return () => listeners.delete(listener)
        },
      },
      pause() {
        if (progress.state !== 'uploading') return
        stop()
        emit({ state: 'paused', sentBytes: 0 })
      },
      resume() {
        if (progress.state === 'paused') void run()
      },
      retry() {
        if (progress.state === 'failed') void run()
      },
      cancel() {
        stop()
        listeners.clear()
      },
    }
  }
}
```

`create-uploader.ts`:

```ts
'use client'

import { admitUpload, confirmUpload } from '@/app/actions/uploads'
import { sha256Hex } from './hash'
import { inspectFile } from './thumbnail'
import { uploaderWith, type Put, type StartUpload, type UploaderOptions } from './uploader'

/** A PUT by XMLHttpRequest, because fetch reports no upload progress. Aborts with the signal. */
export const xhrPut: Put = (url, body, mime, onProgress, signal) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', mime)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded)
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT failed with ${xhr.status}`))
    xhr.onerror = () => reject(new Error('PUT failed'))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort())
    xhr.send(body)
  })

/** The uploader the screens use: server actions, Web Crypto, canvas thumbnails and XHR. */
export function createUploader(options: UploaderOptions): StartUpload {
  return uploaderWith(options, { admit: admitUpload, confirm: confirmUpload, hash: sha256Hex, inspect: inspectFile, put: xhrPut })
}
```

- [ ] **Step 8: Thread the uploader through the queue and its two callers**

In `upload-queue.ts`:

- Change the import to `import type { StartUpload, UploadHandle, UploadRecord, UploadState } from './uploader'` (re-export `UploadRecord` from `uploader.ts` with `export type { UploadRecord }` so the queue needs one import).
- `QueueItem` gains `uploadId?: string` and `record?: UploadRecord` after `url?: string`.
- Constructor becomes `constructor(private readonly concurrency: number, private readonly start: StartUpload) {}`.
- The class comment's "(the resumable upload seam)" becomes "(see `uploader.ts`)".
- `useUploadQueue` becomes:

```ts
/** A queue for the life of the screen, and its items. Uploads stop when the screen unmounts. */
export function useUploadQueue(concurrency: number, start: StartUpload) {
  const [queue] = useState(() => new UploadQueue(concurrency, start))
  useEffect(() => () => queue.dispose(), [queue])
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => EMPTY)
  return { queue, items }
}
```

In `use-folder-upload.ts`: add `import { createUploader } from '../../uploads/create-uploader'` and replace line 31 with

```ts
  const uploader = useMemo(() => createUploader({ collectionId, kind: 'layer_image' }), [collectionId])
  const { queue, items } = useUploadQueue(4, uploader)
```

In `assets-screen.tsx`: add `import { createUploader } from './uploads/create-uploader'` and replace line 50 with

```ts
  const uploader = useMemo(() => createUploader({ collectionId: collection.id, kind: 'asset' }), [collection.id])
  const { queue, items: uploads } = useUploadQueue(3, uploader)
```

Then sweep the words that described the simulation. Run `grep -rn "resumable\|simulat\|where it stopped" apps/web/src/components/art` and fix each hit: "resumable queue" and "resumable upload queue" become "upload queue"; the assets-screen comment sentence "Uploads are simulated until storage exists (the seam is `uploads/resumable-upload.ts`)." is deleted; `use-assets.ts:77` reads "Where accepted files go to be uploaded (the upload queue), and how a removed one is dropped."; `folder-upload.tsx:28` and `use-folder-upload.ts:26` say "upload queue". Leave `Seam:` comments about Phase 3 tables for Task 5.

- [ ] **Step 9: Run the tests, typecheck and lint**

Run: `pnpm --filter @cobweb/web test && pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`
Expected: the 7 uploader tests pass with the rest; no type or lint errors. `createImageBitmap` and `OffscreenCanvas` are DOM types already in the web app's `lib`.

- [ ] **Step 10: Commit**

```bash
git add -A apps/web/src/components/art
git commit -m "Replace the simulated upload with a presigned PUT uploader behind the queue"
```

### Task 5: The hooks on real uploads

**Files:**

- Modify: `packages/dna/src/types.ts:8-22` (Trait), `apps/web/src/lib/demo/types.ts:49-58` (UploadedAsset), `apps/web/src/components/art/layers/folder-upload/to-layers.ts:8,60-67`, `apps/web/src/components/art/layers/folder-upload/use-folder-upload.ts:119-140`, `apps/web/src/components/art/assets/types.ts:8-21`, `apps/web/src/components/art/assets/use-assets.ts`, `apps/web/src/components/art/assets-screen.tsx:50-56`
- Create: `apps/web/src/components/art/assets/stored.ts`
- Test: `apps/web/src/components/art/layers/folder-upload/to-layers.test.ts`, `apps/web/src/components/art/assets/stored.test.ts`

**Interfaces:**

- Consumes: `QueueItem` (with `record`) from `upload-queue.ts`; `UploadRecord`; `deleteUpload` from `@/app/actions/uploads` (only in `assets-screen.tsx`).
- Produces: `Trait.uploadId?: string`; `UploadedAsset.uploadId?: string`; `UploadedImage = { url: string; name: string; uploadId: string }`; `AssetItem.uploadId: string | null`; `AssetUploads = { add; remove; deleteStored: (uploadId: string) => Promise<{ ok: true } | { error: string }> }`; `adoptRecords(items: AssetItem[], queue: readonly QueueItem[]): { items: AssetItem[]; revoke: string[] } | null`; `useAssetItems(initial, announce, uploads, queueItems: readonly QueueItem[])`.

- [ ] **Step 1: Failing tests**

`to-layers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DetectedProject } from './folder-tree'
import { mergeUpload } from './to-layers'

const file = new File([new Uint8Array(4)], 'starry.png', { type: 'image/png' })
const detected: DetectedProject = {
  projectName: 'Owls',
  structureErrors: [],
  skipped: 0,
  collections: [
    {
      name: 'Owls',
      folder: 'Owls',
      layers: [
        {
          name: 'Eyes',
          folder: 'Owls/Eyes',
          traits: [
            { key: 'k-starry', name: 'Starry', file, path: '/Owls/Eyes/starry.png' },
            { key: 'k-sleepy', name: 'Sleepy', file, path: '/Owls/Eyes/sleepy.png' },
          ],
        },
      ],
    },
  ],
}

describe('mergeUpload', () => {
  it('gives each trait the stored URL and the upload id, and leaves out traits that did not upload', () => {
    const images = new Map([
      ['k-starry', { url: '/api/uploads/u1', name: 'Starry', uploadId: 'u1' }],
    ])
    const result = mergeUpload({ canvas: null, seed: 0, staleNote: null }, detected, images)
    const traits = result.layers.flatMap((layer) => layer.traits)
    expect(traits).toHaveLength(1)
    expect(traits[0]).toMatchObject({ name: 'Starry', imageUrl: '/api/uploads/u1', uploadId: 'u1', weight: 100 })
  })
})
```

`stored.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { QueueItem } from '../uploads/upload-queue'
import type { AssetItem } from './types'
import { adoptRecords } from './stored'

const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })
const item = (key: string, uploadId: string | null = null): AssetItem => ({
  key,
  fileName: `${key}.png`,
  url: `blob:${key}`,
  mediaType: 'image',
  quantity: 1,
  attributes: [],
  bytes: 10,
  owned: true,
  uploadId,
})
const queued = (id: string, state: QueueItem['state'], uploadId?: string): QueueItem => ({
  id,
  file,
  label: `${id}.png`,
  state,
  sentBytes: 10,
  totalBytes: 10,
  ...(uploadId
    ? {
        uploadId,
        url: `/api/uploads/${uploadId}`,
        record: {
          id: uploadId, kind: 'asset', fileName: `${id}.png`, mime: 'image/png', mediaType: 'image',
          bytes: 12, width: 1, height: 1, url: `/api/uploads/${uploadId}`, thumbnailUrl: `/api/uploads/${uploadId}?variant=thumb`,
        },
      }
    : {}),
})

describe('adoptRecords', () => {
  it('switches a finished item to its served URL and upload id, and lists its object URL to revoke', () => {
    const result = adoptRecords([item('a'), item('b')], [queued('a', 'done', 'u-a'), queued('b', 'uploading')])
    expect(result).not.toBeNull()
    expect(result!.items[0]).toMatchObject({ url: '/api/uploads/u-a', uploadId: 'u-a', bytes: 12, owned: false })
    expect(result!.items[1]).toMatchObject({ url: 'blob:b', uploadId: null, owned: true })
    expect(result!.revoke).toEqual(['blob:a'])
  })
  it('returns null when nothing new finished, so the screen does not re-render', () => {
    expect(adoptRecords([item('a', 'u-a')], [queued('a', 'done', 'u-a')])).toBeNull()
    expect(adoptRecords([item('a')], [queued('a', 'failed')])).toBeNull()
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web test -- to-layers stored`
Expected: FAIL: `stored` module not found; `to-layers` fails on `uploadId` (type error at runtime shows as a missing property in `toMatchObject`).

- [ ] **Step 3: Implement**

`packages/dna/src/types.ts`, in `Trait` after `imageUrl`:

```ts
  /** The `uploads` row behind `imageUrl`, once the image is stored. Sample traits have none. */
  uploadId?: string
```

`apps/web/src/lib/demo/types.ts`, in `UploadedAsset` after `imageUrl`:

```ts
  /** The `uploads` row behind the file. Sample data has none; sample mode never uploads. */
  uploadId?: string
```

`to-layers.ts`: `export type UploadedImage = { url: string; name: string; uploadId: string }` and, in the trait literal, add `uploadId: images.get(trait.key)!.uploadId,` after `imageUrl`.

`use-folder-upload.ts`, `finish()`:

```ts
  /** Hands the uploaded layers to the Art screens; the Layers screen then replaces this upload. */
  const finish = useCallback(() => {
    if (!detected) return
    const names = new Map(
      detected.collections.flatMap((c) =>
        c.layers.flatMap((layer) => layer.traits.map((t) => [t.key, t.name])),
      ),
    )
    const images = new Map<string, UploadedImage>()
    for (const item of items) {
      if (item.state !== 'done' || !item.record) continue
      images.set(item.id, {
        url: item.record.url,
        name: names.get(item.id) ?? traitNameFromFile(item.file.name),
        uploadId: item.record.id,
      })
    }
    // The traits now point at the stored files, so the previews can go.
    release()
    update((project) => ({
      ...project,
      ...mergeUpload(project, detected, images, activeCollectionId),
      canvas: project.canvas ?? canvas,
    }))
  }, [detected, items, release, update, activeCollectionId, canvas])
```

Remove `checks` from that dependency list only if it is no longer read inside; it is not.

`assets/types.ts`, in `AssetItem` after `owned`:

```ts
  /** The `uploads` row once the file is stored; null while uploading and for sample data. */
  uploadId: string | null
```

`assets/stored.ts`:

```ts
import type { QueueItem } from '../uploads/upload-queue'
import type { AssetItem } from './types'

/**
 * Moves finished uploads into the asset list: the item takes the served URL, the upload id and
 * the stored size, and gives up its object URL (returned for the caller to revoke). Null when no
 * item changed, so the screen keeps its state.
 */
export function adoptRecords(
  items: AssetItem[],
  queue: readonly QueueItem[],
): { items: AssetItem[]; revoke: string[] } | null {
  const finished = new Map(
    queue.filter((entry) => entry.state === 'done' && entry.record).map((entry) => [entry.id, entry.record!]),
  )
  const revoke: string[] = []
  let changed = false
  const next = items.map((item) => {
    const record = item.uploadId ? undefined : finished.get(item.key)
    if (!record) return item
    changed = true
    if (item.owned) revoke.push(item.url)
    return { ...item, url: record.url, uploadId: record.id, bytes: record.bytes, owned: false }
  })
  return changed ? { items: next, revoke } : null
}
```

`use-assets.ts`:

- `fromSample` adds `uploadId: asset.uploadId ?? null`; `fromChecked` and `fromMedia` add `uploadId: null`.
- `AssetUploads` becomes:

```ts
/** Where accepted files go to be uploaded (the upload queue), how a removed one is dropped, and how a stored one is deleted. */
export type AssetUploads = {
  add: (entries: { id: string; file: File; label: string }[]) => void
  remove: (id: string) => void
  deleteStored: (uploadId: string) => Promise<{ ok: true } | { error: string }>
}
```

- The hook signature gains a fourth parameter `queueItems: readonly QueueItem[]` (import the type from `'../uploads/upload-queue'`) and, after the `revoke` effect, adopts finished uploads:

```ts
  useEffect(() => {
    setItems((current) => {
      const change = adoptRecords(current, queueItems)
      if (!change) return current
      // Revoking twice (StrictMode runs updaters twice) is harmless.
      for (const url of change.revoke) URL.revokeObjectURL(url)
      return change.items
    })
  }, [queueItems])
```

- `removeMany` deletes stored rows after dropping the queue entries:

```ts
      for (const item of gone) {
        uploads.remove(item.key)
        if (item.uploadId)
          void uploads.deleteStored(item.uploadId).then((result) => {
            if ('error' in result) announce(result.error)
          })
      }
```

- `replace` does the same for every previous item in its `for (const item of latest.current)` loop.
- The doc comment's "Seam: replace with the uploads table (Phase 3)..." paragraph becomes: "Finished uploads are adopted from `queueItems`: the item switches to its served URL and upload id, and removing it deletes the row and the object. The next sub-project saves the list itself as token rows."

`assets-screen.tsx`:

```ts
  const sink = useMemo<AssetUploads>(
    () => ({
      add: (entries) => queue.add(entries),
      remove: (id) => queue.remove(id),
      deleteStored: deleteUpload,
    }),
    [queue],
  )
  const files = useAssetItems(assets, announce, sink, uploads)
```

with `import { deleteUpload } from '@/app/actions/uploads'`.

- [ ] **Step 4: Run everything**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green at the root (the dna package's tests are unaffected by an optional field; the web tests include the two new files).

- [ ] **Step 5: Commit**

```bash
git add -A packages/dna/src/types.ts apps/web/src
git commit -m "Carry stored URLs and upload ids through the folder upload and the asset list"
```

### Task 6: Browser check and documentation

**Files:**

- Modify: `docs/MASTER_PLAN.md:178`, `docs/specs/2026-10-03-creator-flow-ui.md` (section 5, after the table), `docs/specs/2026-10-08-art-upload.md` (section 12 ticks), `CLAUDE.md` (Commands)

- [ ] **Step 1: Browser walk (run by the controller with the browser, not by the implementer)**

With `supabase start` and `pnpm --filter @cobweb/web dev` running and `.env.local` holding the local `ART_S3_*` values: sign in, create a generative collection, open its Layers screen and drop a folder of three square PNGs. Check:

- every trait image loads from `/api/uploads/<id>` (network tab shows a 302 then the bucket URL);
- `select kind, storage_key from uploads where collection_id = '<id>' order by kind` lists three `layer_image` rows under `<id>/layers/` and three `thumbnail` rows under `<id>/thumbnails/`;
- dropping the same folder on a second fresh collection still uploads (different collection), and dropping it again on the first one makes no new PUTs (the admit step returns `existing`);
- on a single-asset collection, add a JPG, replace it with a GIF, then an MP4; each shows from `/api/uploads/`, and removing it deletes the row and the object (`uploads` row gone, HEAD on the key 404s in `verify:storage` style or the Studio storage view);
- signed in as a second wallet, `GET /api/uploads/<first creator's id>` returns 404.

Record the outcome in the plan ledger. Anything that fails is a finding for a fix dispatch.

- [ ] **Step 2: Documentation**

`docs/MASTER_PLAN.md` line 178 becomes:

```
**Status:** in progress. The DNA engine (first sub-project) landed on 7 October 2026; see its spec. The art tables (second sub-project) landed on 8 October 2026; see [specs/2026-10-08-art-tables.md](specs/2026-10-08-art-tables.md). Layer and asset upload (third sub-project) landed on 8 October 2026; see [specs/2026-10-08-art-upload.md](specs/2026-10-08-art-upload.md). Next: wiring the Art screens to the art tables.
```

`docs/specs/2026-10-03-creator-flow-ui.md`, after the section 5 table's "Fields that must exist" list, add a bullet:

```
- `UploadedAsset.uploadId` and `Trait.uploadId`: the `uploads` row behind the file, set by the upload sub-project (specs/2026-10-08-art-upload.md). Sample data has none.
```

`CLAUDE.md` Commands block, after the `verify:local` line:

```
pnpm --filter @cobweb/web verify:storage  # presigned PUT, HEAD, signed GET, delete and the 5 GB cap against local storage
```

Tick every box in section 12 of `docs/specs/2026-10-08-art-upload.md` that the browser walk and the test runs proved; leave unticked any that did not pass and say why in the ledger.

- [ ] **Step 3: Commit**

```bash
git add docs CLAUDE.md
git commit -m "Record the upload sub-project as landed and point to the next one"
```
