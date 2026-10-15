// The local deploy fixture verify:deploy, verify:phases and verify:whitelist share (docs/specs/2026-10-15-phases.md,
// section 10), so they cannot drift: the local settings with non-local endpoints refused, the service client
// and the Anvil client, the PASS and FAIL lines, the SIWE sign-in, a seeded generative collection, the
// lock and deploy contexts the write helpers build, the payment, the render functions, the factory call,
// and `deployedCollection`, which locks, pays, renders, links, prepares, deploys and confirms through the
// cores. Every row it creates is tracked, and `removeFixtures` deletes them. Never prints a key.

import { createClient } from '@supabase/supabase-js'
import {
  createTestClient,
  createWalletClient,
  http,
  parseAbi,
  publicActions,
  type Address,
  type Hex,
} from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { RenderQueue } from '@cobweb/shared/render-queue'
import type { Database } from '../src/lib/database.types.ts'
import { adminClient, clientOptions, localConfig, type LocalClient } from './render-deps.ts'

// Every local setting, with non-local endpoints refused (scripts/render-deps.ts). It also fills the
// environment the shared chain clients read (RPC_URL_31337, FACTORY_ADDRESS_31337).
export const settings = localConfig()
export const rpc: string = settings.rpc
export const factory: Address = settings.factory

// Imported after the environment is set, so the shared clients read the local chain settings.
export const { collectionSalt, encodeCollectionArgs, factoryAbi, predictCollectionAddress } =
  await import('@cobweb/shared')
export const { COLLECTION_CODE_HASH, COLLECTION_CREATION_CODE } = await import('@cobweb/shared/collection')
export const { confirmCore, lockCore } = await import('../src/lib/art/lock-core.ts')
export const { readLockCollection } = await import('../src/lib/art/lock-collection.ts')
export const { confirmDeployCore, prepareCore, readDeployment } =
  await import('../src/lib/deploy/deploy-core.ts')
export const { collectionArgsOf } = await import('../src/lib/deploy/deploy-args.ts')
export type LockContext = import('../src/lib/art/lock-core.ts').LockContext
export type DeployContext = import('../src/lib/deploy/deploy-core.ts').DeployContext
export type DeployOutcome<T> = import('../src/lib/deploy/deploy-core.ts').DeployOutcome<T>
export type DeployForm = import('../src/lib/deploy/deploy-types.ts').DeployForm
export type Prepared = import('../src/lib/deploy/deploy-types.ts').Prepared
export type DeployRecord = import('../src/lib/deploy/deploy-types.ts').DeployRecord

export const admin: LocalClient = adminClient(settings)
export const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(
  publicActions,
)
/** A queue that sends nothing: the render is driven by hand, not by a worker. */
const silentQueue: RenderQueue = { send: async () => {} }
export const CID = (letter: string) => `bafybei${letter.repeat(52)}`
export const HEX64 = (n: number) => n.toString(16).padStart(64, '0')
/** The factory's approval view, which the shipped ABI leaves out (the app never asks it). */
const approvalAbi = parseAbi(['function isCreationCodeApproved(bytes32 codeHash) view returns (bool)'])

let passed = 0
const failed: string[] = []

/** A check returns null on success, or a description of what happened instead. */
export async function check(name: string, fn: () => Promise<string | null>): Promise<void> {
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

/** Runs the checks, then the cleanup whatever happened, prints the totals and exits non-zero on any failure. */
export async function runChecks(main: () => Promise<void>, cleanup: () => Promise<void>): Promise<never> {
  try {
    await main()
  } catch (e) {
    failed.push('run')
    console.log(`FAIL run: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await cleanup()
  }
  console.log(`\n${passed} passed, ${failed.length} failed`)
  process.exit(failed.length ? 1 : 0)
}

const userIds: string[] = []
const collectionIds: string[] = []

/** Tracks a collection a script created outside `seededCollection`, so `removeFixtures` deletes it. */
export function trackCollection(cid: string): void {
  collectionIds.push(cid)
}

/** A signed-in creator: the wallet, its Supabase session and its user id. */
export type Creator = { account: PrivateKeyAccount; client: LocalClient; userId: string }

/** Signs in with SIWE, as the app does. */
export async function signIn(account: PrivateKeyAccount): Promise<Creator> {
  const client: LocalClient = createClient<Database>(settings.url, settings.publishableKey, clientOptions)
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
  return { account, client, userId: data.user.id }
}

let fileCount = 0
/** A content hash no other upload of the run has. */
export const nextFileHash = () => HEX64(++fileCount)

/** A generative collection of three tokens over two layers of two traits, owned by the client's creator. */
export async function seededCollection(client: LocalClient, name: string): Promise<string> {
  const { data: col, error } = await client
    .from('collections')
    .insert({
      name: `Deploy check ${name} ${Date.now()} ${++fileCount}`,
      symbol: 'DPL',
      project_type: 'generative',
    })
    .select('id')
    .single()
  if (error || !col) throw new Error(`collection: ${error?.message ?? 'no row'}`)
  const cid = col.id
  collectionIds.push(cid)
  const art = await client
    .from('art_collections')
    .insert({ collection_id: cid, name: 'Owls', size: 3, position: 0 })
    .select('id')
    .single()
  if (art.error || !art.data) throw new Error(`art collection: ${art.error?.message ?? 'no row'}`)
  const artId = art.data.id
  const traits: string[][] = []
  for (const [position, layerName] of ['Background', 'Eyes'].entries()) {
    const layer = await client
      .from('layers')
      .insert({ collection_id: cid, art_collection_id: artId, name: layerName, position })
      .select('id')
      .single()
    if (layer.error || !layer.data) throw new Error(`layer: ${layer.error?.message ?? 'no row'}`)
    const ids: string[] = []
    for (const [index, traitName] of ['One', 'Two'].entries()) {
      const hash = nextFileHash()
      const upload = await client.rpc('record_upload', {
        p_collection_id: cid,
        p_kind: 'layer_image',
        p_storage_key: `${cid}/layers/${hash}.png`,
        p_content_hash: hash,
        p_mime: 'image/png',
        p_media_type: 'image',
        p_bytes: 1234,
        p_width: 1000,
        p_height: 1000,
        p_file_name: `${traitName}.png`,
      })
      if (upload.error) throw new Error(`upload: ${upload.error.message}`)
      const trait = await client
        .from('traits')
        .insert({
          collection_id: cid,
          layer_id: layer.data.id,
          name: traitName,
          weight: 50,
          position: index,
          upload_id: upload.data as string,
        })
        .select('id')
        .single()
      if (trait.error || !trait.data) throw new Error(`trait: ${trait.error?.message ?? 'no row'}`)
      ids.push(trait.data.id)
    }
    traits.push(ids)
  }
  const [background, eyes] = traits as [string[], string[]]
  const dna = [
    [background[0]!, eyes[0]!],
    [background[0]!, eyes[1]!],
    [background[1]!, eyes[0]!],
  ]
  const tokens = await client.from('tokens').insert(
    dna.map((traitIds, index) => ({
      collection_id: cid,
      token_id: index + 1,
      art_collection_id: artId,
      dna: traitIds,
    })),
  )
  if (tokens.error) throw new Error(`tokens: ${tokens.error.message}`)
  return cid
}

/** The context `lockWrite` builds, re-read from the row each time so the status is current. */
export async function lockContextFor(
  client: LocalClient,
  owner: string,
  wallet: string,
  cid: string,
): Promise<LockContext> {
  const collection = await readLockCollection(client, cid)
  if (!collection || collection.owner_id !== owner) throw new Error('the creator cannot read the collection')
  return {
    supabase: client,
    service: () => admin,
    owner,
    wallet: wallet.toLowerCase(),
    collection,
    queue: silentQueue,
  }
}

/** The context `deployWrite` and `phasesWrite` build: the same read, without the queue. */
export async function deployContextFor(
  client: LocalClient,
  owner: string,
  wallet: string,
  cid: string,
): Promise<DeployContext> {
  const { queue: _queue, ...context } = await lockContextFor(client, owner, wallet, cid)
  void _queue
  return context
}

/** A refused outcome as a short string: the sentence, the database code, or "accepted". */
export const refusal = <T>(outcome: DeployOutcome<T>) =>
  'refused' in outcome ? outcome.refused : 'error' in outcome ? `db ${outcome.error?.code}` : 'accepted'

/** Pays for a job from the account through the factory and waits for the receipt. */
export async function pay(account: PrivateKeyAccount, jobId: Hex, value: bigint): Promise<Hex> {
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

/** The render functions with the service role, from a paid (or placeholder) job to done, as the worker would. */
export async function finishRender(
  jobId: string,
  imagesCid: string,
  metadataCid: string,
  baseUri: string,
  placeholderImageCid: string | null = null,
): Promise<string | null> {
  const steps: [string, Record<string, unknown>][] = [
    ['art_claim_render', { p_job_id: jobId }],
    ['art_batch_start', { p_job_id: jobId, p_index: 0 }],
    ['art_batch_done', { p_job_id: jobId, p_index: 0, p_images_cid: imagesCid, p_images_size: 1000 }],
    [
      'art_render_finish',
      {
        p_job_id: jobId,
        p_metadata_cid: metadataCid,
        p_base_uri: baseUri,
        p_placeholder_image_cid: placeholderImageCid,
      },
    ],
  ]
  for (const [fn, args] of steps) {
    const { error } = await admin.rpc(fn as 'art_claim_render', args as never)
    if (error) return `${fn}: ${error.message}`
  }
  return null
}

/** Sends deployCollection with the shipped creation code, the given arguments and salt, and waits for the receipt. */
export async function deploy(account: PrivateKeyAccount, encodedArgs: Hex, salt: Hex): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'deployCollection',
    args: [COLLECTION_CREATION_CODE, encodedArgs, salt],
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`deployCollection reverted: ${hash}`)
  return hash
}

export type CollectionRow = {
  status: string
  chain_id: number | null
  contract_address: string | null
  slug: string | null
  slug_reserved_at: string | null
}

/** The collection's row as the service role reads it. */
export async function collectionRow(cid: string): Promise<CollectionRow> {
  const { data, error } = await admin
    .from('collections')
    .select('status, chain_id, contract_address, slug, slug_reserved_at')
    .eq('id', cid)
    .single()
  if (error) throw new Error(`collection row: ${error.message}`)
  return data
}

/** The mint page link each fixture collection reserves. */
export const slugFor = (cid: string) => `deploy-${cid.slice(0, 8)}`

/** Anvil answers as 31337 and the factory approves the shipped creation code hash, or why not. */
export async function chainReady(): Promise<string | null> {
  if ((await chain.getChainId()) !== 31337) return 'not chain 31337'
  const code = await chain.getCode({ address: factory })
  if (!code || code === '0x') return `no contract at ${factory}; run chain:local again`
  const approved = await chain.readContract({
    address: factory,
    abi: approvalAbi,
    functionName: 'isCreationCodeApproved',
    args: [COLLECTION_CODE_HASH],
  })
  return approved
    ? null
    : `the factory does not approve ${COLLECTION_CODE_HASH}; run forge build, the copy script and chain:local again`
}

/**
 * Locks a seeded collection, pays for it from the creator's wallet, renders it to done and reserves its
 * link, through the cores and functions the app uses. Throws on any refusal.
 */
export async function renderCollection(creator: Creator, cid: string): Promise<void> {
  const lockCtx = await lockContextFor(creator.client, creator.userId, creator.account.address, cid)
  const locked = await lockCore(lockCtx, { allowDuplicates: false, chainId: 31337 })
  if (!('data' in locked)) throw new Error(`lock: ${refusal(locked)}`)
  const job = locked.data
  const paidHash = await pay(creator.account, job.jobId, BigInt(job.quote.totalWei))
  const confirmed = await confirmCore(lockCtx, job.id, paidHash)
  if (!('data' in confirmed)) throw new Error(`pay: ${refusal(confirmed)}`)
  if (confirmed.data.state !== 'paid') throw new Error(`job ${confirmed.data.state}`)
  const rendering = await finishRender(job.id, CID('d'), CID('e'), `ipfs://${CID('e')}/`)
  if (rendering) throw new Error(rendering)
  const link = await creator.client.rpc('reserve_slug', { p_collection_id: cid, p_slug: slugFor(cid) })
  if (link.error) throw new Error(`link: ${link.error.message}`)
}

/** A collection deployed through the factory and recorded, with the context to run the cores on it. */
export type Deployed = {
  cid: string
  /** Read after the record, so the collection reads deployed. */
  ctx: DeployContext
  prepared: Prepared
  record: DeployRecord
  hash: Hex
}

/**
 * A seeded collection locked, paid, rendered, linked, prepared, deployed through the factory from the
 * creator's wallet and confirmed, through the same cores the app uses. Throws on any refusal.
 */
export async function deployedCollection(
  creator: Creator,
  form: DeployForm,
  name = 'deployed',
): Promise<Deployed> {
  const cid = await seededCollection(creator.client, name)
  await renderCollection(creator, cid)
  const before = await deployContextFor(creator.client, creator.userId, creator.account.address, cid)
  const prepared = await prepareCore(before, form)
  if (!('data' in prepared)) throw new Error(`prepare: ${refusal(prepared)}`)
  const hash = await deploy(creator.account, prepared.data.encodedArgs, prepared.data.salt)
  const confirmed = await confirmDeployCore(before, hash, form)
  if (!('data' in confirmed)) throw new Error(`confirm: ${refusal(confirmed)}`)
  const ctx = await deployContextFor(creator.client, creator.userId, creator.account.address, cid)
  return { cid, ctx, prepared: prepared.data, record: confirmed.data, hash }
}

/**
 * Deletes every job, collection (its deployment, phases and whitelist entries cascade) and user the run created,
 * or says what is left.
 */
export async function removeFixtures(): Promise<string | null> {
  if (collectionIds.length) {
    const jobs = await admin.from('render_jobs').delete().in('collection_id', collectionIds)
    if (jobs.error) return `jobs: ${jobs.error.message}`
    const cols = await admin.from('collections').delete().in('id', collectionIds)
    if (cols.error) return `collections: ${cols.error.message}`
    const left = await admin.from('deployments').select('collection_id').in('collection_id', collectionIds)
    if (left.error) return `deployments: ${left.error.message}`
    if (left.data.length) return `${left.data.length} deployment(s) left`
    const groups = await admin.from('mint_groups').select('id').in('collection_id', collectionIds)
    if (groups.error) return `mint_groups: ${groups.error.message}`
    if (groups.data.length) return `${groups.data.length} mint group(s) left`
    // Counted, not read: a read answers at most 1,000 rows (max_rows), and a run can leave more.
    const entries = await admin
      .from('whitelist_entries')
      .select('*', { count: 'exact', head: true })
      .in('collection_id', collectionIds)
    if (entries.error) return `whitelist_entries: ${entries.error.message}`
    if (entries.count) return `${entries.count} whitelist entries left`
  }
  for (const id of userIds) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) return error.message
  }
  return null
}
