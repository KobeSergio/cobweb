// Checks the layer sources' lifecycle against LOCAL Supabase and local storage (docs/specs/2026-10-17-production-
// hardening.md, section 10): a creator with four collections recorded as deployed through
// collection_record_deploy, as verify:local's section 9j records one, each with originals and thumbnails stored
// in the art bucket, their deploys and renders moved back with the service role; collections_sources_due, the
// sweep through the app's own port (its due list kept to this run's collections), a dry run, a sweep, a second
// run, a resumed run, the refusal and the guards. Nine PASS lines. Needs Supabase and its buckets, nothing else.
//
//   pnpm --filter @cobweb/web verify:sources
//
// Anything unset is discovered with `supabase status -o env`. Never prints a key. Runs under `node
// --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { Database } from '../src/lib/database.types.ts'

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

// The storage module and the service client read these as they are called; set them first.
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
    console.error(`Refusing to run: ${new URL(endpoint).host} is not local.`)
    process.exit(2)
  }

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
type Client = SupabaseClient<Database>
const admin: Client = createClient<Database>(url, serviceKey, clientOptions)
const anon: Client = createClient<Database>(url, publishableKey, clientOptions)
const { deleteObjects, listObjectPages, presignPut } = await import('../src/lib/storage/objects.ts')
const { SOURCE_FOLDERS, sweepSources } = await import('../src/lib/storage/source-sweep.ts')
const { sourceSweepDeps } = await import('../src/lib/storage/source-sweep-deps.ts')
type SourceSweepDeps = import('../src/lib/storage/source-sweep.ts').SourceSweepDeps

let passed = 0
const failed: string[] = []
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

const NOT_DUE = "This collection's art files are not due for deletion."
const GUARD = "This collection's art files were deleted 90 days after its deploy, so its art cannot change."
const DAY_MS = 86_400_000
const run = randomBytes(3).toString('hex')
const HEX64 = () => randomBytes(32).toString('hex')
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString()
// A 1 x 1 transparent PNG, stored as each original and, under a thumbnail's type, as each thumbnail.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const CID = (letter: string) => `bafybei${letter.repeat(52)}`

async function put(key: string, mime: string): Promise<void> {
  const response = await fetch(await presignPut(key, mime, PNG.byteLength), {
    method: 'PUT',
    body: new Uint8Array(PNG),
    headers: { 'Content-Type': mime },
  })
  if (!response.ok) throw new Error(`PUT ${key}: ${response.status}`)
}

/** Every key the art bucket holds under a prefix. */
async function keysUnder(prefix: string): Promise<string[]> {
  const keys: string[] = []
  for await (const page of listObjectPages(prefix)) keys.push(...page.map((entry) => entry.key))
  return keys
}

/** A collection's stored originals (its three source folders) and thumbnails, counted. */
async function stored(cid: string): Promise<{ originals: number; thumbnails: number }> {
  let originals = 0
  for (const folder of SOURCE_FOLDERS) originals += (await keysUnder(`${cid}/${folder}/`)).length
  return { originals, thumbnails: (await keysUnder(`${cid}/thumbnails/`)).length }
}

const markOf = async (cid: string) =>
  (await admin.from('collections').select('art_sources_deleted_at').eq('id', cid).single()).data
    ?.art_sources_deleted_at ?? null

type Fixture = { cid: string; originals: string[] }
type UploadKind = Database['public']['Enums']['upload_kind']
let userId: string | null = null
let creator: Client | null = null
type Tag = 'A' | 'B' | 'C' | 'D'
const fixtures: Record<Tag, Fixture | null> = { A: null, B: null, C: null, D: null }
const jobIds: string[] = []
const cids = () => Object.values(fixtures).flatMap((fixture) => (fixture ? [fixture.cid] : []))

async function signIn(): Promise<Client> {
  const account = privateKeyToAccount(generatePrivateKey())
  const client = createClient<Database>(url, publishableKey, clientOptions)
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
  const { data, error } = await client.auth.signInWithWeb3({
    chain: 'ethereum',
    message,
    signature: await account.signMessage({ message }),
  })
  if (error || !data.user) throw new Error(`sign-in: ${error?.message ?? 'no user'}`)
  userId = data.user.id
  creator = client
  return client
}

/** Fails with the step's words and the database's code and message. */
function must(step: string, error: { code?: string; message: string } | null): void {
  if (error) throw new Error(`${step}: ${error.code ?? '?'} ${error.message}`)
}

/**
 * A collection recorded as deployed on Base (a chain no local indexer serves), its two layer images, an asset and a
 * placeholder stored with a thumbnail each and recorded, rendered to done (a real job, or for a deferred one its
 * placeholder alone), then its deploy and its render moved back by the given days.
 */
async function deployedFixture(
  creator: Client,
  tag: Tag,
  options: { deferred: boolean; deployedDaysAgo: number; renderedDaysAgo: number },
): Promise<Fixture> {
  const made = await creator
    .from('collections')
    .insert({ name: `Sources ${run} ${tag}`, symbol: 'SRC', project_type: 'generative' })
    .select('id')
    .single()
  must(`${tag} collection`, made.error)
  const cid = made.data!.id
  fixtures[tag] = { cid, originals: [] }
  must(
    `${tag} supply`,
    (
      await creator
        .from('collections')
        .update({ max_supply: 3, art_deferred: options.deferred })
        .eq('id', cid)
    ).error,
  )
  must(
    `${tag} link`,
    (
      await creator.rpc('reserve_slug', {
        p_collection_id: cid,
        p_slug: `sources-${run}-${tag.toLowerCase()}`,
      })
    ).error,
  )
  const files: { kind: 'layer_image' | 'asset' | 'placeholder'; folder: string }[] = [
    { kind: 'layer_image', folder: 'layers' },
    { kind: 'layer_image', folder: 'layers' },
    { kind: 'asset', folder: 'assets' },
    { kind: 'placeholder', folder: 'placeholders' },
  ]
  let placeholderId: string | null = null
  for (const file of files) {
    const hash = createHash('sha256').update(`${cid}:${fixtures[tag].originals.length}`).digest('hex')
    const key = `${cid}/${file.folder}/${hash}.png`
    const thumbnail = `${cid}/thumbnails/${hash}.webp`
    await put(key, 'image/png')
    await put(thumbnail, 'image/webp')
    const rows = await admin
      .from('uploads')
      .insert([
        { ...uploadRow(cid, file.kind, key, hash, 'image/png'), file_name: `${file.folder}.png` },
        { ...uploadRow(cid, 'thumbnail', thumbnail, hash, 'image/webp'), file_name: `${file.folder}.webp` },
      ])
      .select('id, kind')
    must(`${tag} uploads`, rows.error)
    if (file.kind === 'placeholder') placeholderId = rows.data!.find((row) => row.kind === 'placeholder')!.id
    fixtures[tag].originals.push(key)
  }
  const job = await admin
    .from('render_jobs')
    .insert({
      collection_id: cid,
      kind: options.deferred ? 'placeholder' : 'real',
      state: 'done',
      token_count: 3,
      fee_per_token_wei: 0,
      quote_total_wei: 0,
      metadata_cid: CID('e'),
      base_uri: `ipfs://${CID('e')}/`,
      placeholder_upload_id: options.deferred ? placeholderId : null,
      finished_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  must(`${tag} render job`, job.error)
  jobIds.push(job.data!.id)
  if (!options.deferred)
    must(
      `${tag} lock`,
      (await admin.from('collections').update({ art_locked_at: new Date().toISOString() }).eq('id', cid))
        .error,
    )
  const n = parseInt(createHash('sha256').update(cid).digest('hex').slice(0, 8), 16)
  must(
    `${tag} deploy`,
    (
      await admin.rpc('collection_record_deploy', {
        p_collection_id: cid,
        p_owner: userId!,
        p_chain_id: 8453,
        p_factory: `0x${'5f'.repeat(20)}`,
        p_deployer: `0x${'de'.repeat(20)}`,
        p_salt: `0x${HEX64()}`,
        p_code_hash: `0x${HEX64()}`,
        p_args: { name: 'Sources', symbol: 'SRC', maxSupply: '3', groupSupplies: ['3'], groupPrices: ['0'] },
        p_contract_address: `0x${n.toString(16).padStart(40, '0')}`,
        p_tx_hash: `0x${HEX64()}`,
        p_base_uri: `ipfs://${CID('e')}/`,
        p_payout_address: `0x${'de'.repeat(20)}`,
        p_royalty_bps: 500,
        p_royalty_receiver: `0x${'de'.repeat(20)}`,
        p_public_max_per_wallet: 3,
        p_mint_fee_flat_wei: 0,
        p_mint_fee_bps: 0,
        p_airdrop_fee_per_token_wei: 0,
        p_groups: [{ name: 'Public', price_wei: '0', max_supply: 3 }],
      })
    ).error,
  )
  must(
    `${tag} deploy time`,
    (
      await admin
        .from('deployments')
        .update({ deployed_at: daysAgo(options.deployedDaysAgo) })
        .eq('collection_id', cid)
    ).error,
  )
  must(
    `${tag} render time`,
    (
      await admin
        .from('render_jobs')
        .update({ finished_at: daysAgo(options.renderedDaysAgo) })
        .eq('id', job.data!.id)
    ).error,
  )
  return fixtures[tag]
}

const uploadRow = (cid: string, kind: UploadKind, key: string, hash: string, mime: string) => ({
  collection_id: cid,
  kind,
  storage_key: key,
  content_hash: hash,
  mime,
  media_type: 'image' as const,
  bytes: PNG.byteLength,
  width: 1,
  height: 1,
})

/** The app's own port, its due list kept to this run's collections, so no other collection is ever swept. */
function runDeps(): SourceSweepDeps {
  const port = sourceSweepDeps()
  return {
    ...port,
    due: async (limit) =>
      (await port.due(1000)).filter((entry) => cids().includes(entry.collectionId)).slice(0, limit),
  }
}

async function main(): Promise<void> {
  await check(
    'setup: a creator with four collections recorded as deployed, each with recorded originals and thumbnails in the art bucket: A deployed and finally rendered 91 days ago, B deployed 91 days ago and rendered 10 days ago, C deployed 91 days ago with only its placeholder rendered, D deployed 10 days ago and finally rendered 91 days ago',
    async () => {
      const creator = await signIn()
      await deployedFixture(creator, 'A', { deferred: false, deployedDaysAgo: 91, renderedDaysAgo: 91 })
      await deployedFixture(creator, 'B', { deferred: false, deployedDaysAgo: 91, renderedDaysAgo: 10 })
      await deployedFixture(creator, 'C', { deferred: true, deployedDaysAgo: 91, renderedDaysAgo: 91 })
      await deployedFixture(creator, 'D', { deferred: false, deployedDaysAgo: 10, renderedDaysAgo: 91 })
      for (const fixture of Object.values(fixtures)) {
        const { originals, thumbnails } = await stored(fixture!.cid)
        if (originals !== 4 || thumbnails !== 4)
          return `${fixture!.cid} stores ${originals} and ${thumbnails}`
      }
      const deployed = await admin.from('collections').select('status').in('id', cids())
      return deployed.data?.every((row) => row.status === 'deployed')
        ? null
        : 'not every collection is deployed'
    },
  )
  const { A, B, C, D } = fixtures as Record<Tag, Fixture>
  const owner = creator!

  await check(
    "due: collections_sources_due lists A alone with its originals' count and size (not B, rendered 10 days ago, C, never finally rendered, or D, deployed 10 days ago); neither a signed-out caller nor the creator can call it or collection_sources_deleted",
    async () => {
      const due = await admin.rpc('collections_sources_due', { p_limit: 1000 })
      must('due', due.error)
      const listed = (due.data as { collectionId: string; objects: number; bytes: number }[]).filter(
        (entry) => cids().includes(entry.collectionId),
      )
      const [only] = listed
      if (listed.length !== 1 || only!.collectionId !== A.cid || only!.objects !== 4)
        return `listed ${JSON.stringify(listed)}`
      if (only!.bytes !== 4 * PNG.byteLength) return `A's size ${only!.bytes}`
      for (const [who, client] of [
        ['signed out', anon],
        ['creator', owner],
      ] as const) {
        const calls = [
          await client.rpc('collections_sources_due', { p_limit: 5 }),
          await client.rpc('collection_sources_deleted', { p_collection_id: A.cid }),
        ]
        for (const call of calls)
          if (call.error?.code !== '42501')
            return `${who}: ${call.error?.code ?? 'answered'} ${call.error?.message ?? ''}`
      }
      return (await markOf(A.cid)) === null ? null : 'a refused call marked A'
    },
  )

  await check("dry run: the sweep reports A's originals and deletes nothing", async () => {
    const lines: string[] = []
    const report = await sweepSources(runDeps(), { dryRun: true, log: (line) => lines.push(line) })
    if (
      JSON.stringify(report) !== JSON.stringify({ dryRun: true, due: 1, deleted: 0, marked: 0, failed: [] })
    )
      return `report ${JSON.stringify(report)}`
    if (!lines[0]?.startsWith(`Source sweep (dry run): ${A.cid} has 4 original files`))
      return `logged ${lines[0]}`
    const left = await stored(A.cid)
    return left.originals === 4 && (await markOf(A.cid)) === null ? null : `stored ${JSON.stringify(left)}`
  })

  await check(
    "sweep: A's layers, assets and placeholders are deleted, its thumbnails stay, it is marked, and B's, C's and D's objects are untouched",
    async () => {
      const report = await sweepSources(runDeps(), { dryRun: false, log: () => {} })
      if (
        JSON.stringify(report) !==
        JSON.stringify({ dryRun: false, due: 1, deleted: 4, marked: 1, failed: [] })
      )
        return `report ${JSON.stringify(report)}`
      const a = await stored(A.cid)
      if (a.originals !== 0 || a.thumbnails !== 4) return `A stores ${JSON.stringify(a)}`
      if ((await markOf(A.cid)) === null) return 'A is not marked'
      for (const other of [B, C, D]) {
        const left = await stored(other.cid)
        if (left.originals !== 4 || left.thumbnails !== 4)
          return `${other.cid} stores ${JSON.stringify(left)}`
        if ((await markOf(other.cid)) !== null) return `${other.cid} is marked`
      }
      const rows = await admin
        .from('uploads')
        .select('id', { count: 'exact', head: true })
        .eq('collection_id', A.cid)
      return rows.count === 8 ? null : `A has ${rows.count} upload rows`
    },
  )

  await check('again: a second run finds nothing due and deletes nothing', async () => {
    const report = await sweepSources(runDeps(), { dryRun: false, log: () => {} })
    return JSON.stringify(report) ===
      JSON.stringify({ dryRun: false, due: 0, deleted: 0, marked: 0, failed: [] })
      ? null
      : `report ${JSON.stringify(report)}`
  })

  await check(
    "resume: with A's mark cleared and one original put back, a run deletes it, says so with that file's size alone, and marks A again",
    async () => {
      must(
        'clear',
        (await admin.from('collections').update({ art_sources_deleted_at: null }).eq('id', A.cid)).error,
      )
      await put(A.originals[0]!, 'image/png')
      const lines: string[] = []
      const report = await sweepSources(runDeps(), { dryRun: false, log: (line) => lines.push(line) })
      if (
        JSON.stringify(report) !==
        JSON.stringify({ dryRun: false, due: 1, deleted: 1, marked: 1, failed: [] })
      )
        return `report ${JSON.stringify(report)}`
      // The size the listing gave the file deleted, not the four originals' recorded total.
      const deleted = `Source sweep: deleted 1 original files (${PNG.byteLength} B) of ${A.cid}.`
      if (lines.join('\n') !== deleted) return `logged ${lines.join(' | ')}`
      return (await stored(A.cid)).originals === 0 && (await markOf(A.cid)) !== null
        ? null
        : 'A was not swept again'
    },
  )

  await check('not due: collection_sources_deleted on B is refused with its sentence', async () => {
    const { error } = await admin.rpc('collection_sources_deleted', { p_collection_id: B.cid })
    if (error?.code !== '23514' || error.message !== NOT_DUE)
      return `${error?.code ?? 'answered'} ${error?.message ?? ''}`
    return (await markOf(B.cid)) === null ? null : 'B was marked'
  })

  await check(
    "guards: a new uploads row and a new render job for A are refused with the guard's sentence",
    async () => {
      const hash = HEX64()
      const upload = await admin
        .from('uploads')
        .insert({
          ...uploadRow(A.cid, 'layer_image', `${A.cid}/layers/${hash}.png`, hash, 'image/png'),
          file_name: 'late.png',
        })
        .select('id')
      const job = await admin
        .from('render_jobs')
        .insert({
          collection_id: A.cid,
          kind: 'real',
          token_count: 1,
          fee_per_token_wei: 0,
          quote_total_wei: 0,
        })
        .select('id')
      for (const row of job.data ?? []) jobIds.push(row.id)
      for (const [what, error] of [
        ['upload', upload.error],
        ['render job', job.error],
      ] as const)
        if (error?.code !== '23514' || error.message !== GUARD)
          return `${what}: ${error?.code ?? 'written'} ${error?.message ?? ''}`
      return null
    },
  )
}

async function cleanup(): Promise<void> {
  await check('cleanup: the run leaves no object, row or user', async () => {
    const problems: string[] = []
    for (const cid of cids()) {
      const keys = await keysUnder(`${cid}/`)
      if (keys.length) await deleteObjects(keys)
    }
    if (jobIds.length) {
      const { error } = await admin.from('render_jobs').delete().in('id', jobIds)
      if (error) problems.push(`jobs: ${error.message}`)
    }
    if (cids().length) {
      const { error } = await admin.from('collections').delete().in('id', cids())
      if (error) problems.push(`collections: ${error.message}`)
    }
    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) problems.push(`user: ${error.message}`)
    }
    for (const cid of cids()) {
      if ((await keysUnder(`${cid}/`)).length) problems.push(`${cid} still stores objects`)
      const rows = (table: 'deployments' | 'uploads' | 'render_jobs' | 'mint_groups') =>
        admin.from(table).select('*', { count: 'exact', head: true }).eq('collection_id', cid)
      const left = await Promise.all([
        admin.from('collections').select('*', { count: 'exact', head: true }).eq('id', cid),
        rows('deployments'),
        rows('uploads'),
        rows('render_jobs'),
        rows('mint_groups'),
      ])
      const total = left.reduce((sum, { count }) => sum + (count ?? 0), 0)
      if (total) problems.push(`${total} row(s) of ${cid} left`)
    }
    if (userId && (await admin.auth.admin.getUserById(userId)).data.user) problems.push('the user is left')
    return problems.length ? problems.join('; ') : null
  })
}

try {
  await main()
} catch (e) {
  failed.push('run')
  console.log(`FAIL run: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
} finally {
  await cleanup()
}

console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
