// Checks the render worker end to end against LOCAL Supabase, LOCAL storage and a LOCAL Anvil chain
// (docs/specs/2026-10-12-render-worker.md, section 8): a signed-in creator's generative project with
// drawn layers is locked and paid on Anvil, then the local runner takes the job through the same
// steps the queue consumer runs, on the production adapters for the database, storage and the chain, with a
// folder standing in for the pinning service and a queue in memory. Sixteen checks: the full run,
// duplicate delivery (serial, then two copies of one batch at once), a pin that fails once, a pin that
// always fails and the retry after it, identical CIDs for identical input, a 1/1 project's attributes
// reaching the pinned metadata, a short payment, a payment no node has seen, a wrong CID (for a batch, then for the metadata set), a
// layer of the wrong size, the credit that failure's unlock leaves, the sweep (two cases) and a placeholder job.
//
// Numbering: the spec (section 8) lists ten checks. Its checks 1 to 5 are checks 1 to 5 here. Check 6
// here is an addition (a 1/1 project's attributes), so the spec's checks 6 to 10 (a short payment, a
// wrong-CID pinner, a wrong-size layer, the sweep, a placeholder job) are numbered 7 to 11 in the output.
// Five more cases carry a letter: 2b (concurrent copies of one batch), 7b (a payment no node has seen), 8b (a wrong CID for the metadata
// set only), 9b (the credit the unlock of the wrong-size failure leaves) and 10b (the sweep starting a paid job).
// With the two setup checks and the two cleanup checks the script prints 20 PASS lines.
//
// Not covered here: the worker's rule that a payment which shows at the latest block but not yet at the
// confirmation depth is unconfirmed (viemChain throws PaymentUnconfirmed, and the step is retried).
// Anvil's chain has a confirmation depth of 1, so the depth equals the latest block locally and that
// state cannot be reached; it is covered by unit tests only.
//
//   supabase start && supabase seed buckets
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:render
//
// Supabase and storage settings come from the environment or `supabase status -o env`; RPC_URL_31337
// and FACTORY_ADDRESS_31337 from the environment or apps/web/.env.local. Refuses non-local endpoints.
// Never prints a key. Deletes every row and object it creates. Runs under
// `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { CarReader } from '@ipld/car'
import * as UnixFS from '@ipld/unixfs'
import { createClient } from '@supabase/supabase-js'
import { CID as IpldCid } from 'multiformats/cid'
import {
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  parseEther,
  publicActions,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { Database } from '../src/lib/database.types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

// The two chain settings from apps/web/.env.local when the environment does not set them.
const envFile = resolve(here, '../.env.local')
if (existsSync(envFile))
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const [, name, value] = line.match(/^(RPC_URL_31337|FACTORY_ADDRESS_31337)=(.*)$/) ?? []
    if (name && value && process.env[name] === undefined) process.env[name] = value.trim()
  }

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

const { factoryAbi, isLocalUrl, enqueueRender } = await import('@cobweb/shared')

const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
const storage = {
  ART_S3_ENDPOINT: config('ART_S3_ENDPOINT', ['STORAGE_S3_URL']),
  ART_S3_REGION: config('ART_S3_REGION', ['S3_PROTOCOL_REGION'], 'local'),
  ART_S3_ACCESS_KEY_ID: config('ART_S3_ACCESS_KEY_ID', ['S3_PROTOCOL_ACCESS_KEY_ID']),
  ART_S3_SECRET_ACCESS_KEY: config('ART_S3_SECRET_ACCESS_KEY', ['S3_PROTOCOL_ACCESS_KEY_SECRET']),
  ART_S3_FORCE_PATH_STYLE: '1',
}
const ART_BUCKET = config('ART_S3_BUCKET', [], 'art')
const RENDER_BUCKET = config('RENDER_S3_BUCKET', [], 'render')
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
const factory = getAddress(factoryEnv)

// Imported after the environment is set, so the shared clients read the local chain settings.
const { confirmCore, loadJob, lockCore, lockPlaceholderCore, reviewLock, unlockCore } =
  await import('../src/lib/art/lock-core.ts')
const { readLockCollection } = await import('../src/lib/art/lock-collection.ts')
const web = await import('../src/lib/art/result.ts')
const schemas = await import('../src/lib/art/schemas.ts')
const worker = await import('@cobweb/worker')
const local = await import('@cobweb/worker/local')
type LockContext = import('../src/lib/art/lock-core.ts').LockContext
type LockOutcome<T> = import('../src/lib/art/lock-core.ts').LockOutcome<T>
type Deps = import('@cobweb/worker').Deps
type RenderMessage = import('@cobweb/shared/render-queue').RenderMessage
type Pinner = import('@cobweb/worker').Pinner
type MemoryQueue = import('@cobweb/worker/local').MemoryQueue

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
type Client = ReturnType<typeof createClient<Database>>
const admin: Client = createClient<Database>(url, serviceKey, clientOptions)
const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(publicActions)
const s3 = new S3Client(worker.artS3Options(storage))
const pins = mkdtempSync(join(tmpdir(), 'cobweb-verify-render-'))
const CID = /^[a-z2-7]{59}$/

let passed = 0
const failed: string[] = []
async function check(name: string, fn: () => Promise<string | null>): Promise<void> {
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

const userIds: string[] = []
const collectionIds: string[] = []
const artKeys: string[] = []

async function signIn(account: PrivateKeyAccount) {
  const client: Client = createClient<Database>(url, publishableKey, clientOptions)
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
  const signature = await account.signMessage({ message })
  const { data, error } = await client.auth.signInWithWeb3({ chain: 'ethereum', message, signature })
  if (error || !data.user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`)
  userIds.push(data.user.id)
  return { client, userId: data.user.id }
}

/** Stores a drawn PNG in the art bucket under an upload key and records it as the creator would. */
async function upload(
  client: Client,
  cid: string,
  kind: 'layer_image' | 'placeholder' | 'asset',
  png: Uint8Array,
  fileName: string,
  declared = 64,
): Promise<string> {
  const hash = createHash('sha256').update(png).digest('hex')
  const folder = { layer_image: 'layers', placeholder: 'placeholders', asset: 'assets' }[kind]
  const key = `${cid}/${folder}/${hash}.png`
  await s3.send(new PutObjectCommand({ Bucket: ART_BUCKET, Key: key, Body: png, ContentType: 'image/png' }))
  artKeys.push(key)
  const recorded = await client.rpc('record_upload', {
    p_collection_id: cid,
    p_kind: kind,
    p_storage_key: key,
    p_content_hash: hash,
    p_mime: 'image/png',
    p_media_type: 'image',
    p_bytes: png.byteLength,
    p_width: declared,
    p_height: declared,
    p_file_name: fileName,
  })
  if (recorded.error) throw new Error(`upload: ${recorded.error.message}`)
  return recorded.data as string
}

async function newCollection(
  client: Client,
  label: string,
  projectType: 'generative' | 'one_of_one' = 'generative',
): Promise<string> {
  const { data, error } = await client
    .from('collections')
    .insert({ name: `Render check ${label} ${Date.now()}`, symbol: 'RND', project_type: projectType })
    .select('id')
    .single()
  if (error || !data) throw new Error(`collection: ${error?.message ?? 'no row'}`)
  collectionIds.push(data.id)
  return data.id
}

const LAYERS = [
  {
    name: 'Background',
    traits: [
      { r: 20, g: 20, b: 60, alpha: 1 },
      { r: 200, g: 120, b: 60, alpha: 1 },
    ],
  },
  {
    name: 'Body',
    traits: [
      { r: 240, g: 240, b: 240, alpha: 0.5 },
      { r: 90, g: 60, b: 30, alpha: 0.5 },
    ],
  },
  {
    name: 'Eyes',
    traits: [
      { r: 255, g: 255, b: 0, alpha: 0.5 },
      { r: 0, g: 255, b: 255, alpha: 0.5 },
    ],
  },
]
const TOKENS = 5

/**
 * A generative project of five tokens over three layers of two traits, 64 by 64, owned by the
 * client's creator, its layer images drawn and stored. The same every time, so two of them render
 * to identical CIDs. `wrongSize` stores one Eyes image at 32 by 32 while recording it as 64 by 64.
 * `reverse` inserts the layers in the opposite order with the same `position` values, so a worker that
 * stacked them in creation order would render different art. That is all it proves: the tokens name
 * their traits by id, so the order of the traits within a layer changes nothing.
 */
async function seededProject(
  client: Client,
  label: string,
  wrongSize = false,
  reverse = false,
): Promise<string> {
  const cid = await newCollection(client, label)
  const named = await client
    .from('collections')
    .update({ token_name: 'Owl', token_description: 'A night owl.' })
    .eq('id', cid)
  if (named.error) throw new Error(`collection text: ${named.error.message}`)
  const art = await client
    .from('art_collections')
    .insert({ collection_id: cid, name: 'Owls', size: TOKENS, position: 0 })
    .select('id')
    .single()
  if (art.error || !art.data) throw new Error(`art collection: ${art.error?.message ?? 'no row'}`)
  const traits: string[][] = []
  const layerOrder = [...LAYERS.entries()]
  if (reverse) layerOrder.reverse()
  for (const [position, layer] of layerOrder) {
    const row = await client
      .from('layers')
      .insert({ collection_id: cid, art_collection_id: art.data.id, name: layer.name, position })
      .select('id')
      .single()
    if (row.error || !row.data) throw new Error(`layer: ${row.error?.message ?? 'no row'}`)
    const ids: string[] = []
    for (const [index, colour] of layer.traits.entries()) {
      const small = wrongSize && layer.name === 'Eyes' && index === 1
      const png = await local.flatPng(colour, small ? 32 : 64)
      const name = index === 0 ? 'One' : 'Two'
      const uploadId = await upload(client, cid, 'layer_image', png, `${layer.name} ${name}.png`)
      const trait = await client
        .from('traits')
        .insert({
          collection_id: cid,
          layer_id: row.data.id,
          name,
          weight: 50,
          position: index,
          upload_id: uploadId,
        })
        .select('id')
        .single()
      if (trait.error || !trait.data) throw new Error(`trait: ${trait.error?.message ?? 'no row'}`)
      ids[index] = trait.data.id
    }
    traits[position] = ids
  }
  // Token n takes the bits of n - 1 as its picks, so the five tokens differ and every trait is used.
  const tokens = await client.from('tokens').insert(
    Array.from({ length: TOKENS }, (_, n) => ({
      collection_id: cid,
      token_id: n + 1,
      art_collection_id: art.data.id,
      dna: traits.map((ids, layer) => ids[(n >> layer) & 1]!),
    })),
  )
  if (tokens.error) throw new Error(`tokens: ${tokens.error.message}`)
  return cid
}

/**
 * A 1/1 project of two files, `Piece one` and `Piece two`, with attributes stored the way the Assets
 * screen stores them: `uploads.attributes` as `[{ traitType, value }]`, written through the same
 * `assetPatch` schema the `updateAsset` action parses, under the creator's own session.
 */
async function oneOfOneProject(client: Client, label: string): Promise<string> {
  const cid = await newCollection(client, label, 'one_of_one')
  const named = await client
    .from('collections')
    .update({ token_name: 'Piece', token_description: 'A one of one.' })
    .eq('id', cid)
  if (named.error) throw new Error(`collection text: ${named.error.message}`)
  const files = [
    { colour: { r: 200, g: 40, b: 40, alpha: 1 }, name: 'Piece one', artist: 'Ada' },
    { colour: { r: 40, g: 40, b: 200, alpha: 1 }, name: 'Piece two', artist: 'Bo' },
  ]
  const placed: { uploadId: string; position: number }[] = []
  for (const [position, file] of files.entries()) {
    const uploadId = await upload(
      client,
      cid,
      'asset',
      await local.flatPng(file.colour, 64),
      `${file.name}.png`,
    )
    const patch = schemas.assetPatch.parse({
      quantity: 1,
      attributes: [
        { traitType: 'Artist', value: file.artist },
        { traitType: 'Name', value: file.name },
      ],
    })
    const saved = await client
      .from('uploads')
      .update({ quantity: patch.quantity, attributes: patch.attributes })
      .eq('id', uploadId)
      .select('id')
    if (saved.error || saved.data?.length !== 1)
      throw new Error(`asset attributes: ${saved.error?.message ?? 'no row updated'}`)
    placed.push({ uploadId, position })
  }
  // The list order the Assets screen saves (the `setAssetOrder` action runs this function).
  const ordered = await client.rpc('art_set_asset_order', { p_collection_id: cid, p_rows: placed })
  if (ordered.error) throw new Error(`asset order: ${ordered.error.message}`)
  return cid
}

type CarFiles = Map<string, Uint8Array>

/**
 * Every file in a CAR's root directory by name, plain or HAMT-sharded. Reads single raw block files
 * only, which is every file a metadata set or an image directory of this size holds.
 */
async function readCarFiles(car: Uint8Array): Promise<CarFiles> {
  const reader = await CarReader.fromBytes(car)
  const [root] = await reader.getRoots()
  if (!root) throw new Error('The CAR has no root.')
  const blockOf = async (cid: IpldCid) => {
    const block = await reader.get(cid)
    if (!block) throw new Error(`The CAR is missing block ${cid.toString()}.`)
    return block.bytes
  }
  const files: CarFiles = new Map()
  const walk = async (node: ReturnType<typeof UnixFS.decode>): Promise<void> => {
    if (node.type === UnixFS.NodeType.Directory) {
      for (const entry of node.entries) files.set(entry.name, await blockOf(IpldCid.decode(entry.cid.bytes)))
      return
    }
    if (node.type !== UnixFS.NodeType.HAMTShard) throw new Error(`Unexpected node type ${node.type}.`)
    for (const entry of node.entries) {
      const cid = IpldCid.decode(entry.cid.bytes)
      if (entry.name.length === 2) await walk(UnixFS.decode(await blockOf(cid)))
      else files.set(entry.name.slice(2), await blockOf(cid))
    }
  }
  await walk(UnixFS.decode(await blockOf(root)))
  return files
}

/** The CAR the folder pinner wrote for a root CID. */
const readPin = (cid: string): Uint8Array => new Uint8Array(readFileSync(join(pins, `${cid}.car`)))

/** An S3 response body as bytes. */
async function bodyBytes(
  body: { transformToByteArray(): Promise<Uint8Array> } | undefined,
): Promise<Uint8Array> {
  if (!body) throw new Error('the object has no body')
  return body.transformToByteArray()
}

/** One token's metadata JSON from the metadata CAR the pinner wrote, parsed. */
async function pinnedMetadata(
  metadataCid: string,
  tokenId: number | string,
): Promise<Record<string, unknown>> {
  const file = (await readCarFiles(readPin(metadataCid))).get(String(tokenId))
  if (!file) throw new Error(`the metadata CAR has no file ${tokenId}`)
  return JSON.parse(new TextDecoder().decode(file)) as Record<string, unknown>
}

/** The context `lockWrite` builds: the creator's RLS client, the service client, the owner's id. */
async function contextFor(client: Client, owner: string, wallet: string, cid: string): Promise<LockContext> {
  const collection = await readLockCollection(client, cid)
  if (!collection || collection.owner_id !== owner) throw new Error('the creator cannot read the collection')
  // The script drives the runner itself, so the pay flow's start message goes nowhere.
  return {
    supabase: client,
    service: () => admin,
    owner,
    wallet: wallet.toLowerCase(),
    collection,
    queue: { send: async () => {} },
  }
}

const refusal = <T>(outcome: LockOutcome<T>) =>
  'refused' in outcome ? outcome.refused : 'error' in outcome ? `db ${outcome.error?.code}` : 'accepted'

async function pay(account: PrivateKeyAccount, jobId: Hex, value: bigint): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'payForArt',
    args: [jobId],
    value,
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`payForArt reverted: ${hash}`)
  return hash
}

type Creator = { client: Client; userId: string; account: PrivateKeyAccount }

/**
 * Locks a seeded project and pays for it on Anvil through the cores the server actions run, then
 * sets a batch size of 2 with the service client so five tokens make three batches. `short` pays 1
 * wei less and marks the job paid by hand; `unseen` pays nothing and records a transaction hash no node has. The product cannot produce this state (confirmCore
 * refuses a short payment, and the database refuses `paid` without a full one), so it is what a
 * server bug would leave, and the worker's own payment check must catch it before the claim.
 */
async function lockedAndPaid(
  creator: Creator,
  cid: string,
  mode: 'paid' | 'short' | 'unseen' = 'paid',
  tokens = TOKENS,
): Promise<string> {
  const ctx = await contextFor(creator.client, creator.userId, creator.account.address, cid)
  const locked = await lockCore(ctx, { allowDuplicates: false, chainId: 31337 })
  if (!('data' in locked)) throw new Error(`lock: ${refusal(locked)}`)
  const job = locked.data
  if (job.state !== 'payment_due') throw new Error(`lock left the job ${job.state}`)
  const total = BigInt(job.quote.totalWei)
  // As verify-chain does: with a zero rate the payment read would compare 0 with 0 and prove nothing.
  if (total === 0n) throw new Error('The factory rate is 0, so the quote total is 0; set a rate above zero.')
  if (mode === 'unseen') {
    // Nothing is paid on chain, and the recorded hash is one no node has: a web app whose node is ahead
    // of the worker's, as far as the worker can tell.
    const forced = await admin
      .from('render_jobs')
      .update({
        state: 'paid',
        payment_tx_hash: `0x${createHash('sha256').update(job.id).digest('hex')}`,
        paid_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    if (forced.error) throw new Error(`force paid: ${forced.error.message}`)
  } else if (mode === 'short') {
    const hash = await pay(creator.account, job.jobId, total - 1n)
    const forced = await admin
      .from('render_jobs')
      .update({ state: 'paid', payment_tx_hash: hash.toLowerCase(), paid_at: new Date().toISOString() })
      .eq('id', job.id)
    if (forced.error) throw new Error(`force paid: ${forced.error.message}`)
  } else {
    const confirmed = await confirmCore(ctx, job.id, await pay(creator.account, job.jobId, total))
    if (!('data' in confirmed)) throw new Error(`confirm: ${refusal(confirmed)}`)
    if (confirmed.data.state !== 'paid') throw new Error(`confirm left the job ${confirmed.data.state}`)
  }
  const sized = await admin
    .from('render_jobs')
    .update({ batch_size: 2, batches_total: Math.ceil(tokens / 2) })
    .eq('id', job.id)
  if (sized.error) throw new Error(`batch size: ${sized.error.message}`)
  return job.id
}

const logLines: string[] = []

/** How many times the worker read a payment from the chain (the production adapter, counted). */
let chainReads = 0

/** The worker's ports: the production adapters for the database, storage and the chain; local doubles for the rest. */
function depsFor(queue: MemoryQueue, pinner: Pinner): Deps & { queue: MemoryQueue } {
  const realChain = worker.viemChain(process.env)
  return {
    jobs: worker.supabaseJobs(admin),
    store: worker.s3Store({ client: s3, bucket: ART_BUCKET }, { client: s3, bucket: RENDER_BUCKET }),
    chain: {
      jobPayment: async (job) => {
        chainReads += 1
        return realChain.jobPayment(job)
      },
    },
    pinner,
    queue,
    log: (event, fields = {}) => void logLines.push(`${event} ${JSON.stringify(fields)}`),
  }
}

/** Enqueues the job's start message and drains the queue, as Vercel Queues and the consumer would. */
async function render(jobId: string, deps: Deps & { queue: MemoryQueue }, retries = 0) {
  await enqueueRender(deps.queue, { id: jobId, retries })
  return local.runLocal(deps)
}

async function jobRow(jobId: string) {
  const { data, error } = await admin
    .from('render_jobs')
    .select(
      'state, error, error_code, metadata_cid, base_uri, collage_key, placeholder_image_cid, batches_done, retries, started_at',
    )
    .eq('id', jobId)
    .single()
  if (error) throw new Error(`job: ${error.message}`)
  return data
}

async function batchRows(jobId: string) {
  const { data, error } = await admin
    .from('render_batches')
    .select('index, state, attempts, images_cid, error, error_code')
    .eq('job_id', jobId)
    .order('index')
  if (error) throw new Error(`batches: ${error.message}`)
  return data
}

async function statusOf(cid: string): Promise<string> {
  const { data, error } = await admin.from('collections').select('status').eq('id', cid).single()
  if (error) throw new Error(`collection: ${error.message}`)
  return data.status
}

/** What a finished job's CIDs are, for comparing two renders. */
async function cidsOf(jobId: string): Promise<string> {
  const job = await jobRow(jobId)
  const batches = await batchRows(jobId)
  return JSON.stringify([batches.map((batch) => batch.images_cid), job.metadata_cid])
}

/** Null when the job is done with three batch CIDs, a metadata CID and its base URI; else what is wrong. */
async function doneProblem(jobId: string): Promise<string | null> {
  const job = await jobRow(jobId)
  const batches = await batchRows(jobId)
  if (job.state !== 'done') return `state ${job.state} (${job.error_code}: ${job.error})`
  const cids = batches.map((batch) => batch.images_cid ?? '')
  if (batches.length !== 3 || batches.some((batch) => batch.state !== 'done')) return JSON.stringify(batches)
  if (!cids.every((cid) => CID.test(cid)) || new Set(cids).size !== 3) return `batch CIDs ${cids.join(', ')}`
  if (!CID.test(job.metadata_cid ?? '')) return `metadata CID ${job.metadata_cid}`
  if (job.base_uri !== `ipfs://${job.metadata_cid}/`) return `base URI ${job.base_uri}`
  return job.batches_done === 3 ? null : `batches_done ${job.batches_done}`
}

async function main(): Promise<void> {
  console.log(`Verifying the render worker on ${rpc} against ${url}`)
  await check('setup: Anvil answers, the factory has code, and the render bucket exists', async () => {
    if ((await chain.getChainId()) !== 31337) return 'not chain 31337'
    const code = await chain.getCode({ address: factory })
    if (!code || code === '0x') return `no contract at ${factory}; run chain:local again`
    try {
      await s3.send(new HeadBucketCommand({ Bucket: RENDER_BUCKET }))
    } catch {
      return `no "${RENDER_BUCKET}" bucket in local storage; run \`supabase seed buckets\``
    }
    return null
  })

  await check('setup: the worker reads the same sentences the web app shows', async () => {
    const pairs: [string, string][] = [
      [worker.SENTENCES.JOB_NOT_READY, web.JOB_NOT_READY],
      [worker.SENTENCES.BATCH_COUNT_MISMATCH, web.BATCH_COUNT_MISMATCH],
      [worker.SENTENCES.JOB_NOT_RENDERING, web.JOB_NOT_RENDERING],
      [worker.SENTENCES.NO_SUCH_BATCH, web.NO_SUCH_BATCH],
      [worker.SENTENCES.BATCH_RESULT_DIFFERS, web.BATCH_RESULT_DIFFERS],
      [worker.SENTENCES.BATCH_ALREADY_DONE, web.BATCH_ALREADY_DONE],
      [worker.SENTENCES.JOB_RESULT_DIFFERS, web.JOB_RESULT_DIFFERS],
      [worker.SENTENCES.BATCHES_STILL_RENDERING, web.BATCHES_STILL_RENDERING],
      [worker.SENTENCES.JOB_FAILURE_NEEDS_FINAL, web.JOB_FAILURE_NEEDS_FINAL],
    ]
    const wrong = pairs.find(([mine, theirs]) => mine !== theirs)
    return wrong ? `"${wrong[0]}" is not "${wrong[1]}"` : null
  })

  const account = privateKeyToAccount(generatePrivateKey())
  await chain.setBalance({ address: account.address, value: parseEther('10') })
  const creator: Creator = { ...(await signIn(account)), account }

  // 1. The full run.
  const firstCid = await seededProject(creator.client, 'one')
  const firstJob = await lockedAndPaid(creator, firstCid)
  let firstHandled = 0
  await check('1. the runner takes a paid job to done: batch CIDs, metadata, base URI, collage', async () => {
    const pinner = local.folderPinner(pins)
    const readsBefore = chainReads
    const run = await render(firstJob, depsFor(local.memoryQueue(), pinner))
    firstHandled = run.handled
    if (run.thrown || run.dead) return `the run had failures: ${JSON.stringify(run)}`
    if (chainReads <= readsBefore) return 'the worker never read the payment from the chain'
    const problem = await doneProblem(firstJob)
    if (problem) return problem
    const job = await jobRow(firstJob)
    const key = `${firstCid}/collage/${firstJob}.png`
    if (job.collage_key !== key) return `collage key ${job.collage_key}`
    const head = await s3.send(new HeadObjectCommand({ Bucket: RENDER_BUCKET, Key: key }))
    if (head.ContentType !== 'image/png' || !head.ContentLength) return 'the collage is not a PNG object'
    // The collage shows the first tokens of batch 0, which holds 2 tokens here (batch size 2): a grid of
    // 4 columns of 256 pixel cells, so one row, 1024 by 256. The centre of each cell is checked exactly.
    // The expected pixels are worked by hand with the render core's integer blend (render core spec,
    // section 6). div255(x) = trunc((x + 127) / 255). At a layer opacity of 1 (alpha 255), as = div255(sa * 255)
    // = sa, wd = div255(da * (255 - as)), oa = as + wd, and oc = trunc(((sc * as + dc * wd) * 2 + oa) / (2 * oa)).
    // A drawn alpha of 0.5 is stored as 128, so Body and Eyes have sa = 128. Over an opaque pixel (da = 255)
    // as = 128, wd = div255(255 * 127) = 127 and oa = 255, so oc = trunc(((sc * 128 + dc * 127) * 2 + 255) / 510).
    // Token 1 (bits 0, 0, 0) is Background One (20,20,60), Body One (240,240,240), Eyes One (255,255,0):
    //   Body over Background: r and g = trunc(66775 / 510) = 130 (240 * 128 + 20 * 127 = 33260), b = trunc(76935 / 510)
    //   = 150 (240 * 128 + 60 * 127 = 38340), so (130,130,150). Eyes over that: r and g = trunc(98555 / 510) = 193
    //   (255 * 128 + 130 * 127 = 49150), b = trunc(38355 / 510) = 75 (0 * 128 + 150 * 127 = 19050). Pixel (193,193,75,255).
    // Token 2 (bits 1, 0, 0) is Background Two (200,120,60), Body One, Eyes One:
    //   Body over Background: r = trunc(112495 / 510) = 220, g = trunc(92175 / 510) = 180, b = 150, so (220,180,150).
    //   Eyes over that: r = trunc(121415 / 510) = 238, g = trunc(111255 / 510) = 218, b = trunc(38355 / 510) = 75.
    //   Pixel (238,218,75,255).
    const object = await s3.send(new GetObjectCommand({ Bucket: RENDER_BUCKET, Key: key }))
    const collageBytes = await bodyBytes(object.Body)
    for (const [x, want] of [
      [128, [193, 193, 75, 255]],
      [384, [238, 218, 75, 255]],
    ] as const) {
      const got = await local.rgbaAt(collageBytes, x, 128).catch((e: unknown) => String(e))
      if (typeof got === 'string') return `the collage does not decode as an image: ${got}`
      if (got.width !== 1024 || got.height !== 256) return `the collage is ${got.width} by ${got.height}`
      if (got.pixel.some((value, at) => value !== want[at]))
        return `collage pixel ${x} is ${JSON.stringify(got.pixel)}, expected ${JSON.stringify(want)}`
    }
    const status = await statusOf(firstCid)
    if (status !== 'rendered') return `collection ${status}`
    // Token 3 is in batch 1 (batch size 2) and takes the bits of 2: One, Two, One.
    const batches = await batchRows(firstJob)
    const meta = await pinnedMetadata(job.metadata_cid ?? '', 3)
    const wanted = {
      name: 'Owl #3',
      description: 'A night owl.',
      image: `ipfs://${batches[1]?.images_cid}/3.png`,
      attributes: [
        { trait_type: 'Background', value: 'One' },
        { trait_type: 'Body', value: 'Two' },
        { trait_type: 'Eyes', value: 'One' },
      ],
    }
    if (JSON.stringify(meta) !== JSON.stringify(wanted))
      return `token 3 metadata is ${JSON.stringify(meta)}, expected ${JSON.stringify(wanted)}`
    // The metadata set holds one file per token: 1 to 5, and nothing else.
    const metaFiles = [...(await readCarFiles(readPin(job.metadata_cid ?? ''))).keys()].sort()
    if (JSON.stringify(metaFiles) !== '["1","2","3","4","5"]')
      return `the metadata CAR holds ${JSON.stringify(metaFiles)}`
    // The second and third batches' archives: their files, decoded, and their pixels checked exactly against
    // the colours of the drawn layers (LAYERS), worked by hand here and not computed by the worker or the
    // render library. Token n picks the bits of n - 1. The blend is the one worked above for the collage:
    // each of Body and Eyes (alpha 128) goes over an opaque pixel, oc = trunc(((sc * 128 + dc * 127) * 2 + 255) / 510).
    //   Token 3 (bits 0, 1, 0) is Background One (20,20,60), Body Two (90,60,30), Eyes One (255,255,0).
    //     Body over Background: r = trunc(28375 / 510) = 55, g = trunc(20695 / 510) = 40, b = trunc(23175 / 510) = 45.
    //     Eyes over (55,40,45): r = trunc(79505 / 510) = 155, g = trunc(75695 / 510) = 148, b = trunc(11685 / 510) = 22.
    //     Pixel (155,148,22,255).
    //   Token 4 (bits 1, 1, 0) is Background Two (200,120,60), Body Two, Eyes One.
    //     Body over Background: r = trunc(74095 / 510) = 145, g = trunc(46095 / 510) = 90, b = trunc(23175 / 510) = 45.
    //     Eyes over (145,90,45): r = trunc(102365 / 510) = 200, g = trunc(88395 / 510) = 173, b = 22.
    //     Pixel (200,173,22,255).
    //   Token 5 (bits 0, 0, 1) is Background One, Body One (240,240,240), Eyes Two (0,255,255), the second
    //     Eyes trait, so an Eyes trait wired to the wrong image within its layer changes this pixel.
    //     Body over Background: (130,130,150) as for token 1. Eyes over that: r = trunc(33275 / 510) = 65
    //     (0 * 128 + 130 * 127 = 16510), g = trunc(98555 / 510) = 193, b = trunc(103635 / 510) = 203
    //     (255 * 128 + 150 * 127 = 51690). Pixel (65,193,203,255).
    // Every layer shows in the result, so the wrong layer order moves the pixel too (stacking Eyes below
    // Body would give (159,124,30) for token 4).
    const archives: [number, [string, number[]][]][] = [
      [
        1,
        [
          ['3.png', [155, 148, 22, 255]],
          ['4.png', [200, 173, 22, 255]],
        ],
      ],
      [2, [['5.png', [65, 193, 203, 255]]]],
    ]
    for (const [batch, files] of archives) {
      const archive = await readCarFiles(readPin(batches[batch]?.images_cid ?? ''))
      const names = [...archive.keys()].sort()
      if (JSON.stringify(names) !== JSON.stringify(files.map(([name]) => name)))
        return `batch ${batch} holds ${JSON.stringify(names)}`
      for (const [name, want] of files) {
        const got = await local
          .rgbaAt(archive.get(name) ?? new Uint8Array(), 32, 32)
          .catch((e: unknown) => String(e))
        if (typeof got === 'string') return `${name} does not decode as an image: ${got}`
        if (got.width !== 64 || got.height !== 64) return `${name} is ${got.width} by ${got.height}`
        if (got.pixel.some((value, at) => value !== want[at]))
          return `${name} pixel is ${JSON.stringify(got.pixel)}, expected ${JSON.stringify(want)}`
      }
    }
    return null
  })

  // 2. Duplicate delivery.
  await check('2. with every message delivered twice, the final state is the same', async () => {
    const cid = await seededProject(creator.client, 'two')
    const jobId = await lockedAndPaid(creator, cid)
    // Delivery here is serial: the local runner handles one message at a time, so a second copy always
    // meets finished work. Check 2b is the case that is not serial.
    const pinner = local.folderPinner(pins)
    const run = await render(jobId, depsFor(local.memoryQueue({ copies: 2 }), pinner))
    if (run.thrown || run.dead) return `the run had failures: ${JSON.stringify(run)}`
    if (run.handled < 2 * firstHandled)
      return `${run.handled} deliveries, expected at least twice check 1's ${firstHandled}`
    const problem = await doneProblem(jobId)
    if (problem) return problem
    // The worker pins each CAR once: three batch directories and the metadata set, four in all. A copy of
    // a message meets work already recorded and pins nothing, so the pins equal the distinct CARs.
    const distinct = new Set(pinner.pinned).size
    if (pinner.pinned.length !== distinct || distinct !== 4)
      return `${pinner.pinned.length} pins of ${distinct} distinct CARs, expected 4 of 4`
    // Each batch has exactly one attempt: art_batch_start counts an attempt only on a batch that is not
    // done, and the first copy of each batch message finishes the batch before the next copy arrives.
    const attempts = (await batchRows(jobId)).map((batch) => batch.attempts)
    if (JSON.stringify(attempts) !== '[1,1,1]')
      return `attempts ${JSON.stringify(attempts)}, expected [1,1,1]`
    if ((await cidsOf(jobId)) !== (await cidsOf(firstJob))) return 'the CIDs differ from the single run'
    const [mine, first] = [await jobRow(jobId), await jobRow(firstJob)]
    if (mine.base_uri !== first.base_uri || mine.metadata_cid !== first.metadata_cid)
      return `metadata ${mine.metadata_cid} ${mine.base_uri}`
    if (mine.collage_key !== `${cid}/collage/${jobId}.png`) return `collage key ${mine.collage_key}`
    return (await statusOf(cid)) === 'rendered' ? null : `collection ${await statusOf(cid)}`
  })

  // 2b. Two copies of one batch message handled at the same moment, by two worker instances.
  await check('2b. two copies of one batch handled concurrently leave one done batch', async () => {
    const cid = await seededProject(creator.client, 'two b')
    const jobId = await lockedAndPaid(creator, cid)
    const pinner = local.folderPinner(pins)
    const [one, two] = [depsFor(local.memoryQueue(), pinner), depsFor(local.memoryQueue(), pinner)]
    await worker.handle({ jobId, step: 'start', retries: 0 }, one)
    const message: RenderMessage = { jobId, step: 'batch', index: 0, retries: 0 }
    await Promise.all([worker.handle(message, one), worker.handle(message, two)])
    const rows = (await batchRows(jobId)).filter((batch) => batch.index === 0)
    if (rows.length !== 1) return `${rows.length} rows for batch 0`
    const [row] = rows
    if (row?.state !== 'done' || row.attempts !== 2) return `batch 0 ${JSON.stringify(row)}`
    const [first] = await batchRows(firstJob)
    if (row.images_cid !== first?.images_cid) return `CID ${row.images_cid} is not ${first?.images_cid}`
    // Batch 0 of 3 is done and the other two have not been sent: the job is still rendering, with no error.
    const job = await jobRow(jobId)
    if (job.state !== 'rendering' || job.error_code !== null || job.error !== null)
      return `job ${job.state} (${job.error_code}: ${job.error})`
    return job.batches_done === 1 ? null : `batches_done ${job.batches_done}`
  })

  // 3. A pin that fails once.
  await check(
    '3. a pin that fails once on one batch: the batch is redelivered and the job finishes',
    async () => {
      const cid = await seededProject(creator.client, 'three')
      const jobId = await lockedAndPaid(creator, cid)
      const pinner = local.failingPinner(local.folderPinner(pins), { nth: 1, times: 1 })
      const run = await render(jobId, depsFor(local.memoryQueue(), pinner))
      if (pinner.failures !== 1 || run.thrown !== 1 || run.dead !== 0) return JSON.stringify({ run, pinner })
      const problem = await doneProblem(jobId)
      if (problem) return problem
      const attempts = (await batchRows(jobId)).map((batch) => batch.attempts)
      return JSON.stringify(attempts) === '[1,2,1]' ? null : `attempts ${JSON.stringify(attempts)}`
    },
  )

  // 4. A pin that always fails, then the creator's retry.
  await check(
    '4. a pin that always fails: dead-letter, then the retry renders only the failed batch',
    async () => {
      const cid = await seededProject(creator.client, 'four')
      const jobId = await lockedAndPaid(creator, cid)
      const failing = local.failingPinner(local.folderPinner(pins), { nth: 1, times: Infinity })
      const run = await render(jobId, depsFor(local.memoryQueue(), failing))
      if (run.dead !== 1 || run.thrown !== 3) return `run ${JSON.stringify(run)}`
      const failedJob = await jobRow(jobId)
      if (failedJob.state !== 'failed' || failedJob.error_code !== 'dead-letter')
        return `after the dead letter: ${JSON.stringify(failedJob)}`
      if (failedJob.error !== worker.DEAD_LETTER) return `error "${failedJob.error}"`
      const failedRows = await batchRows(jobId)
      const states = failedRows.map((batch) => batch.state)
      if (JSON.stringify(states) !== '["done","failed","done"]') return `batches ${JSON.stringify(states)}`
      if ((await statusOf(cid)) !== 'art_locked') return `collection ${await statusOf(cid)}`

      const retried = await creator.client.rpc('art_render_retry', { p_collection_id: cid })
      if (retried.error) return `retry: ${retried.error.message}`
      const pinner = local.folderPinner(pins)
      const again = await render(jobId, depsFor(local.memoryQueue(), pinner), retried.data.retries)
      if (again.thrown || again.dead) return `the retry had failures: ${JSON.stringify(again)}`
      const problem = await doneProblem(jobId)
      if (problem) return problem
      // The failed batch and the metadata set: the two finished batches are not rendered again.
      if (pinner.pinned.length !== 2) return `the retry pinned ${pinner.pinned.length} CARs, expected 2`
      // The batches that finished before the failure are untouched: one attempt, the same CID.
      const retriedRows = await batchRows(jobId)
      for (const index of [0, 2]) {
        const [before, after] = [failedRows[index], retriedRows[index]]
        if (after?.attempts !== 1 || after.images_cid !== before?.images_cid)
          return `batch ${index} changed: ${JSON.stringify(before)} then ${JSON.stringify(after)}`
      }
      return (await jobRow(jobId)).retries === 1 ? null : 'retries is not 1'
    },
  )

  // 5. Determinism across projects.
  await check('5. a second project with the same input renders to identical CIDs', async () => {
    // The layers are inserted in the opposite order with the same positions: the CIDs match only if the
    // worker does not stack them in creation order. (The tokens name their traits by id, so this does not
    // test ordering by position among the traits.)
    const cid = await seededProject(creator.client, 'five', false, true)
    const jobId = await lockedAndPaid(creator, cid)
    await render(jobId, depsFor(local.memoryQueue(), local.folderPinner(pins)))
    const problem = await doneProblem(jobId)
    if (problem) return problem
    const [mine, first] = [await cidsOf(jobId), await cidsOf(firstJob)]
    return mine === first ? null : `${mine} is not ${first}`
  })

  // 6. A 1/1 project whose attributes are stored the way the Assets screen stores them.
  await check(
    '6. a 1/1 project: stored { traitType, value } attributes reach the pinned metadata',
    async () => {
      const cid = await oneOfOneProject(creator.client, 'six')
      const jobId = await lockedAndPaid(creator, cid, 'paid', 2)
      const run = await render(jobId, depsFor(local.memoryQueue(), local.folderPinner(pins)))
      if (run.thrown || run.dead) return `the run had failures: ${JSON.stringify(run)}`
      const job = await jobRow(jobId)
      if (job.state !== 'done') return `state ${job.state} (${job.error_code}: ${job.error})`
      const batches = await batchRows(jobId)
      const wanted = [
        { name: 'Piece #1', artist: 'Ada', piece: 'Piece one' },
        { name: 'Piece #2', artist: 'Bo', piece: 'Piece two' },
      ]
      for (const [at, want] of wanted.entries()) {
        const meta = await pinnedMetadata(job.metadata_cid ?? '', at + 1)
        const expected = {
          name: want.name,
          description: 'A one of one.',
          image: `ipfs://${batches[0]?.images_cid}/${at + 1}.png`,
          attributes: [
            { trait_type: 'Artist', value: want.artist },
            { trait_type: 'Name', value: want.piece },
          ],
        }
        if (JSON.stringify(meta) !== JSON.stringify(expected))
          return `token ${at + 1} metadata is ${JSON.stringify(meta)}, expected ${JSON.stringify(expected)}`
      }
      return null
    },
  )

  // The sweep's view 16 minutes from now of one job only: `render_jobs.updated_at` is kept by a trigger,
  // so a job cannot be backdated, and a job another developer left open in the local database must not be
  // touched. The id filter goes into the query itself, before its limit.
  const sweepDeps = (deps: Deps & { queue: MemoryQueue }, jobId: string) => {
    const later = worker.supabaseJobs(admin, { now: () => Date.now() + 16 * 60_000 })
    return { ...deps, jobs: { ...deps.jobs, stuck: (minutes: number) => later.stuck(minutes, jobId) } }
  }

  // 7. A short payment (the spec's check 6).
  await check(
    '7. a job paid 1 wei short on chain fails with payment-mismatch, never claimed, and cannot be retried',
    async () => {
      const cid = await seededProject(creator.client, 'seven')
      const jobId = await lockedAndPaid(creator, cid, 'short')
      const pinner = local.folderPinner(pins)
      const run = await render(jobId, depsFor(local.memoryQueue(), pinner))
      if (run.thrown || run.dead) return `run ${JSON.stringify(run)}`
      const job = await jobRow(jobId)
      if (job.state !== 'failed' || job.error_code !== 'payment-mismatch') return JSON.stringify(job)
      if (job.error !== worker.PAYMENT_MISMATCH) return `error "${job.error}"`
      if (job.started_at !== null || (await batchRows(jobId)).length !== 0) return 'the job was claimed'
      if (pinner.pinned.length !== 0) return 'something was pinned'
      if ((await statusOf(cid)) !== 'art_locked') return `collection ${await statusOf(cid)}`
      const retry = await creator.client.rpc('art_render_retry', { p_collection_id: cid })
      return retry.error?.message === web.PAYMENT_UNVERIFIED
        ? null
        : `retry: ${retry.error?.message ?? 'accepted'}`
    },
  )

  // 7b. A payment the worker's node has not seen (Critical 1 of the final review).
  await check(
    '7b. a paid job with a recorded payment no node has is not failed: dead-lettered, still paid, and the sweep finds it',
    async () => {
      const cid = await seededProject(creator.client, 'seven b')
      const jobId = await lockedAndPaid(creator, cid, 'unseen')
      const pinner = local.folderPinner(pins)
      const deps = depsFor(local.memoryQueue(), pinner)
      const before = logLines.length
      const run = await render(jobId, deps)
      if (run.thrown !== 3 || run.dead !== 1) return `run ${JSON.stringify({ ...run, deadMessages: [] })}`
      if (run.deadMessages.length !== 1 || run.deadMessages[0]?.step !== 'start')
        return 'the dead message is not the start'
      const lines = logLines.slice(before)
      if (!lines.some((line) => line.startsWith('failure report refused')))
        return 'no refused report was acknowledged'
      if (!lines.some((line) => line.includes('PaymentUnproven')))
        return 'the first failure was not PaymentUnproven'
      const job = await jobRow(jobId)
      if (job.state !== 'paid' || job.error_code !== null) return JSON.stringify(job)
      if (job.started_at !== null || (await batchRows(jobId)).length !== 0) return 'the job was claimed'
      if (pinner.pinned.length !== 0) return 'something was pinned'
      const found = await sweepDeps(deps, jobId).jobs.stuck(15)
      return found.length === 1 && found[0]?.id === jobId ? null : `stuck ${JSON.stringify(found)}`
    },
  )

  // 8. A wrong CID from the pinning service (the spec's check 7).
  await check(
    '8. a pinning service that answers with another CID fails the job with cid-mismatch',
    async () => {
      const cid = await seededProject(creator.client, 'eight')
      const jobId = await lockedAndPaid(creator, cid)
      const run = await render(jobId, depsFor(local.memoryQueue(), local.wrongCidPinner()))
      if (run.thrown || run.dead) return `run ${JSON.stringify(run)}`
      const job = await jobRow(jobId)
      if (job.state !== 'failed' || job.error_code !== 'cid-mismatch') return JSON.stringify(job)
      if (job.error !== worker.CID_MISMATCH) return `error "${job.error}"`
      if ((await batchRows(jobId)).some((batch) => batch.state === 'done')) return 'a batch was recorded'
      return (await statusOf(cid)) === 'art_locked' ? null : `collection ${await statusOf(cid)}`
    },
  )

  // 8b. A wrong CID for the metadata set only.
  await check(
    '8b. a pinning service that answers with another CID for the metadata set fails the job with cid-mismatch',
    async () => {
      const cid = await seededProject(creator.client, 'eight b')
      const jobId = await lockedAndPaid(creator, cid)
      const inner = local.folderPinner(pins)
      const seen: string[] = []
      // Three batch directories pin first, so the fourth distinct CAR is the metadata set.
      const pinner: Pinner = {
        async pin(car, expectedCid) {
          if (!seen.includes(expectedCid)) seen.push(expectedCid)
          return seen.indexOf(expectedCid) === 3 ? local.WRONG_CID : inner.pin(car, expectedCid)
        },
      }
      const run = await render(jobId, depsFor(local.memoryQueue(), pinner))
      if (run.thrown || run.dead) return `run ${JSON.stringify(run)}`
      if (seen.length !== 4) return `${seen.length} distinct CARs were pinned, expected 4`
      const job = await jobRow(jobId)
      if (job.state !== 'failed' || job.error_code !== 'cid-mismatch') return JSON.stringify(job)
      if (job.error !== worker.CID_MISMATCH) return `error "${job.error}"`
      if (job.metadata_cid !== null || job.base_uri !== null) return 'the job recorded a metadata CID'
      // The failure is the job's, not a batch's: every batch stays done with its CID.
      const batches = await batchRows(jobId)
      const bad = batches.filter((batch) => batch.state !== 'done' || !CID.test(batch.images_cid ?? ''))
      if (batches.length !== 3 || bad.length > 0 || batches.some((batch) => batch.error_code !== null))
        return `batches ${JSON.stringify(batches)}`
      return (await statusOf(cid)) === 'art_locked' ? null : `collection ${await statusOf(cid)}`
    },
  )

  // 9. A layer of the wrong size (the spec's check 8). The project is shared with 9b.
  const wrongSize = await seededProject(creator.client, 'nine', true)
  const wrongSizeJob = await lockedAndPaid(creator, wrongSize)
  await check('9. a layer of the wrong size fails the job with layer-size and its sentence', async () => {
    const cid = wrongSize
    const jobId = wrongSizeJob
    const run = await render(jobId, depsFor(local.memoryQueue(), local.folderPinner(pins)))
    if (run.thrown || run.dead) return `a bad layer was retried: ${JSON.stringify(run)}`
    const job = await jobRow(jobId)
    if (job.state !== 'failed' || job.error_code !== 'layer-size') return JSON.stringify(job)
    // The render library's own sentence, stored as the job's error with the worker's token prefix. Token 5
    // is the only one that picks the small Eyes image (n = 4, bit 2), and Eyes is image 3 of 3.
    const sentence = 'Token 5: Image 3 of 3 in the stack is 32 by 32 pixels; the canvas is 64 by 64.'
    if (job.error !== sentence) return `error "${job.error}"`
    const failedBatches = (await batchRows(jobId)).filter((batch) => batch.state === 'failed')
    if (failedBatches.length !== 1) return `failed batches ${JSON.stringify(failedBatches)}`
    if (failedBatches[0]?.error_code !== 'layer-size' || failedBatches[0].error !== job.error)
      return `batch error ${JSON.stringify(failedBatches[0])}`
    if ((await statusOf(cid)) !== 'art_locked') return `collection ${await statusOf(cid)}`
    // The web app's model of the job. The creator can fix this art only by unlocking it, so a retry
    // fails the same way; the model still calls the job retryable. A known gap, recorded for the
    // screen sub-project, which should offer the unlock first.
    const model = await loadJob(creator.client, jobId)
    if (model.state !== 'failed') return `the web model says ${model.state}`
    return model.errorCode === 'layer-size' && model.retryable
      ? null
      : `model ${JSON.stringify({ errorCode: model.errorCode, retryable: model.retryable })}`
  })

  // 9b. The credit on the web side (docs/specs/2026-10-14-render-screen-wiring.md, sections 4 and 5):
  // the art failure is unlocked through the core, the review offers the credit, and the next lock is
  // recorded waived on it and queued at once.
  await check(
    '9b. after an art failure the unlock leaves a credit: the review says so, and the next lock is waived and queued',
    async () => {
      const queue = local.memoryQueue()
      const ctx = {
        ...(await contextFor(creator.client, creator.userId, creator.account.address, wrongSize)),
        queue,
      }
      const unlocked = await unlockCore(ctx)
      if (!('data' in unlocked)) return `unlock: ${refusal(unlocked)}`
      const before = await jobRow(wrongSizeJob)
      if (before.state !== 'failed' || before.error_code !== 'unlocked')
        return `after the unlock: ${JSON.stringify(before)}`
      if ((await statusOf(wrongSize)) !== 'draft') return `collection ${await statusOf(wrongSize)}`
      const review = await reviewLock(ctx)
      if (!review.credit) return `the review offers no credit: ${JSON.stringify(review)}`
      const locked = await lockCore(ctx, { allowDuplicates: false, chainId: 31337 })
      if (!('data' in locked)) return `lock: ${refusal(locked)}`
      const job = locked.data
      if (job.state !== 'waived' || !job.credited)
        return `the lock came back ${job.state}, credited ${String(job.credited)}`
      const want = [{ jobId: job.id, step: 'start', retries: 0 }]
      if (JSON.stringify(queue.sent) !== JSON.stringify(want)) return `queued ${JSON.stringify(queue.sent)}`
      // The credit is used: a review of the same count now offers none.
      const again = await reviewLock(ctx)
      return again.credit ? 'the used credit is still offered' : null
    },
  )

  // 10. The sweep, a job left finalizing (the spec's check 9).
  await check('10. the sweep re-enqueues a job left finalizing and it finishes', async () => {
    const cid = await seededProject(creator.client, 'ten')
    const jobId = await lockedAndPaid(creator, cid)
    // The metadata message is lost, as after a crash between the last batch and the send.
    const lossy = local.memoryQueue({ drop: (message) => message.step === 'metadata' })
    await render(jobId, depsFor(lossy, local.folderPinner(pins)))
    const before = (await jobRow(jobId)).state
    if (before !== 'finalizing') return `before the sweep: ${before}`
    const deps = depsFor(local.memoryQueue(), local.folderPinner(pins))
    if ((await deps.jobs.stuck(15, jobId)).length !== 0) return 'stuck after no time at all'
    const stamp = async () => {
      const { data, error } = await admin.from('render_jobs').select('updated_at').eq('id', jobId).single()
      if (error) throw new Error(`updated_at: ${error.message}`)
      return Date.parse(data.updated_at)
    }
    const swept = await stamp()
    if ((await worker.sweep(sweepDeps(deps, jobId))) !== 1) return 'the sweep did not find the job'
    // The sweep marked the job as just swept, so it is not returned again until a threshold has passed.
    // The forward clock cannot show that (16 minutes ahead still reads a job touched now as older than
    // 15), so the row's own stamp is checked, and a clock only 10 minutes ahead must not see the job.
    if ((await stamp()) <= swept) return 'the sweep did not touch the job'
    const soon = worker.supabaseJobs(admin, { now: () => Date.now() + 10 * 60_000 })
    if ((await soon.stuck(15, jobId)).length !== 0) return 'the job is still stuck right after the sweep'
    const run = await local.runLocal(deps)
    if (run.thrown || run.dead) return `run ${JSON.stringify(run)}`
    return doneProblem(jobId)
  })

  // 10b. The sweep, a paid job whose start message was never delivered.
  await check('10b. the sweep starts a paid job whose start message was lost and it finishes', async () => {
    const cid = await seededProject(creator.client, 'ten b')
    const jobId = await lockedAndPaid(creator, cid)
    const deps = depsFor(local.memoryQueue(), local.folderPinner(pins))
    if ((await deps.jobs.stuck(15, jobId)).length !== 0) return 'stuck after no time at all'
    const job = await jobRow(jobId)
    if (job.state !== 'paid' || job.started_at !== null) return `before the sweep: ${job.state}`
    if ((await worker.sweep(sweepDeps(deps, jobId))) !== 1) return 'the sweep did not find the job'
    const run = await local.runLocal(deps)
    if (run.thrown || run.dead) return `run ${JSON.stringify(run)}`
    return doneProblem(jobId)
  })

  // 11. A placeholder job (the spec's check 10). Nothing is paid: a placeholder job is free.
  await check(
    '11. a placeholder job on a deferred collection finishes with its slash-less base URI',
    async () => {
      const cid = await newCollection(creator.client, 'eleven')
      const deferred = await creator.client.from('collections').update({ art_deferred: true }).eq('id', cid)
      if (deferred.error) return `defer: ${deferred.error.message}`
      const png = await local.flatPng({ r: 30, g: 30, b: 30, alpha: 1 })
      const uploadId = await upload(creator.client, cid, 'placeholder', png, 'Hidden.png')
      const ctx = await contextFor(creator.client, creator.userId, account.address, cid)
      const locked = await lockPlaceholderCore(ctx, uploadId)
      if (!('data' in locked)) return `lock: ${refusal(locked)}`
      const jobId = locked.data.id
      const before = await statusOf(cid)
      const run = await render(jobId, depsFor(local.memoryQueue(), local.folderPinner(pins)))
      if (run.thrown || run.dead) return `run ${JSON.stringify(run)}`
      const job = await jobRow(jobId)
      if (job.state !== 'done') return `state ${job.state} (${job.error_code}: ${job.error})`
      if (job.base_uri !== `ipfs://${job.metadata_cid}/metadata.json`) return `base URI ${job.base_uri}`
      if (!CID.test(job.placeholder_image_cid ?? '')) return `placeholder CID ${job.placeholder_image_cid}`
      const [batch] = await batchRows(jobId)
      if (batch?.images_cid !== job.placeholder_image_cid)
        return 'the batch CID is not the placeholder image CID'
      if (job.collage_key !== null) return 'a placeholder job has a collage'
      // The pinned image directory holds the uploaded placeholder, byte for byte.
      const pinnedImage = (await readCarFiles(readPin(job.placeholder_image_cid ?? ''))).get(
        'placeholder.png',
      )
      if (!pinnedImage || !Buffer.from(pinnedImage).equals(Buffer.from(png)))
        return 'the pinned placeholder image is not the uploaded bytes'
      if ((await statusOf(cid)) !== before) return `collection ${before} became ${await statusOf(cid)}`
      // The pinned metadata points at the placeholder image directory.
      const meta = await pinnedMetadata(job.metadata_cid ?? '', 'metadata.json')
      return meta.image === `ipfs://${job.placeholder_image_cid}/placeholder.png`
        ? null
        : `placeholder metadata ${JSON.stringify(meta)}`
    },
  )
}

async function deleteKeys(bucket: string, keys: string[]): Promise<string | null> {
  for (let at = 0; at < keys.length; at += 1000) {
    const result = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(at, at + 1000).map((Key) => ({ Key })) },
      }),
    )
    if (result.Errors?.length) return `${bucket}: ${result.Errors.length} object(s) could not be deleted`
  }
  return null
}

/** Every key under a collection's `collage/` prefix in the render bucket, recorded on a job row or not. */
async function collageKeys(cid: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: RENDER_BUCKET,
        Prefix: `${cid}/collage/`,
        ContinuationToken: token,
      }),
    )
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key)
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return keys
}

// Children before parents, so a table that refuses a cascade is never the reason a row survives.
// `render_jobs` comes before `uploads`: a placeholder job points at its upload.
const CHILD_TABLES = ['tokens', 'traits', 'layers', 'art_collections', 'render_jobs', 'uploads'] as const

/** Every job id the run created, noted before cleanup deletes the rows, for the final look. */
const createdJobIds: string[] = []

/** True only for the answer "no such object" (or user): any other error is not proof of absence. */
const isNotFound = (e: unknown): boolean => {
  const error = e as {
    name?: string
    code?: string
    status?: number
    $metadata?: { httpStatusCode?: number }
  }
  return (
    error.name === 'NotFound' ||
    error.name === 'NoSuchKey' ||
    error.$metadata?.httpStatusCode === 404 ||
    error.status === 404 ||
    error.code === 'user_not_found'
  )
}

async function cleanup(): Promise<void> {
  await check('cleanup: the run leaves no object, row or user behind', async () => {
    const problems: string[] = []
    const note = (what: string, error: { message: string } | null | undefined) => {
      if (error) problems.push(`${what}: ${error.message}`)
    }
    if (collectionIds.length) {
      const jobs = await admin.from('render_jobs').select('id').in('collection_id', collectionIds)
      note('jobs', jobs.error)
      const jobIds = (jobs.data ?? []).map((row) => row.id)
      createdJobIds.push(...jobIds)
      if (jobIds.length)
        note('batches', (await admin.from('render_batches').delete().in('job_id', jobIds)).error)
      for (const cid of collectionIds) {
        try {
          const found = await collageKeys(cid)
          const failed = await deleteKeys(RENDER_BUCKET, found)
          if (failed) problems.push(failed)
        } catch (e) {
          problems.push(`collages: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      for (const table of CHILD_TABLES)
        note(table, (await admin.from(table).delete().in('collection_id', collectionIds)).error)
      note('collections', (await admin.from('collections').delete().in('id', collectionIds)).error)
    }
    try {
      const failed = await deleteKeys(ART_BUCKET, artKeys)
      if (failed) problems.push(failed)
    } catch (e) {
      problems.push(`art objects: ${e instanceof Error ? e.message : String(e)}`)
    }
    for (const id of userIds) note('user', (await admin.auth.admin.deleteUser(id)).error)
    rmSync(pins, { recursive: true, force: true })
    return problems.length ? problems.join('; ') : null
  })

  await check('cleanup: a final look finds nothing left behind', async () => {
    const left: string[] = []
    if (collectionIds.length) {
      for (const table of [...CHILD_TABLES, 'collections'] as const) {
        const column = table === 'collections' ? 'id' : 'collection_id'
        const { count, error } = await admin
          .from(table)
          .select('*', { count: 'exact', head: true })
          .in(column, collectionIds)
        if (error) return `${table}: ${error.message}`
        if (count) left.push(`${count} ${table} row(s)`)
      }
      for (const cid of collectionIds) {
        const found = await collageKeys(cid)
        if (found.length) left.push(`${found.length} collage object(s)`)
      }
    }
    if (createdJobIds.length) {
      const { count, error } = await admin
        .from('render_batches')
        .select('*', { count: 'exact', head: true })
        .in('job_id', createdJobIds)
      if (error) return `render_batches: ${error.message}`
      if (count) left.push(`${count} render_batches row(s)`)
    }
    for (const key of artKeys) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: ART_BUCKET, Key: key }))
        left.push('an art object')
        break
      } catch (e) {
        // Gone, as wanted, only when the answer is "not found"; any other error proves nothing.
        if (!isNotFound(e))
          return `could not look for an art object: ${e instanceof Error ? e.name : 'error'}`
      }
    }
    for (const id of userIds) {
      const { data, error } = await admin.auth.admin.getUserById(id)
      if (error && !isNotFound(error)) return `could not look for a test user: ${error.message}`
      if (data.user) left.push('a test user')
    }
    if (existsSync(pins)) left.push('the pin folder')
    return left.length ? `left behind: ${left.join(', ')}` : null
  })
}

try {
  await main()
} catch (e) {
  failed.push('run')
  console.log(`FAIL run: ${e instanceof Error ? e.message : String(e)}`)
} finally {
  await cleanup()
}

if (failed.length) console.log(`\nThe worker's last log lines:\n${logLines.slice(-15).join('\n')}`)
console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
