// Verifies wallet sign-in and row-level security against a LOCAL Supabase.
//
//   pnpm --filter @cobweb/web verify:local
//
// Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (and SUPABASE_SERVICE_ROLE_KEY for
// setup and cleanup); anything unset is discovered with `supabase status -o env` from the repo root.
// Refuses to run against anything but localhost. Never prints a key.

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { onchainJobId } from '../../../packages/shared/src/job-id.ts'

type Hex = `0x${string}`
type DbError = { code?: string; message: string } | null

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------
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

function config(envName: string, statusNames: string[]): string {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const status = supabaseStatus()
  for (const name of statusNames) if (status[name]) return status[name]
  throw new Error(`${envName} is unset and \`supabase status\` did not report ${statusNames.join(' or ')}`)
}

const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])

const host = new URL(url).hostname
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
  console.error(`Refusing to run: ${url} is not a local Supabase (expected localhost or 127.0.0.1).`)
  process.exit(2)
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const newClient = () => createClient(url, publishableKey, clientOptions)
const admin = createClient(url, serviceKey, clientOptions)
const anon = newClient()

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------
let passed = 0
const failed: string[] = []

// A check returns null on success, or a description of what happened instead.
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

function info(text: string): void {
  console.log(`INFO ${text}`)
}

const describe = (error: DbError) => (error ? `${error.code ?? '?'} ${error.message}` : 'no error')

// Expects a write to have been refused with one of the given Postgres error codes.
function expectError(error: DbError, codes: string[], data?: unknown): string | null {
  if (!error) return `accepted (${Array.isArray(data) ? `${data.length} row(s) written` : 'no error'})`
  if (!codes.includes(error.code ?? '')) return `wrong error: ${describe(error)}`
  return null
}

// A read or write that must not touch anything: an error or zero rows both count as nothing.
function expectNothing(error: DbError, data: unknown[] | null): string | null {
  if (error) return null
  if (data && data.length > 0) return `got ${data.length} row(s): ${JSON.stringify(data[0])}`
  return null
}

const PERMISSION = ['42501'] // missing column/table grant, or RLS with-check violation
const CHECK = ['23514']
const UNIQUE = ['23505']

// ---------------------------------------------------------------------------------------------
// Wallet sign-in
// ---------------------------------------------------------------------------------------------
type Creator = { client: SupabaseClient; account: PrivateKeyAccount; userId: string }
const createdUserIds = new Set<string>()

function siweMessage(address: Hex, domain = 'localhost:3000', uri = 'http://localhost:3000'): string {
  return createSiweMessage({
    address,
    chainId: 1,
    domain,
    nonce: generateSiweNonce(),
    uri,
    version: '1',
    statement: 'Sign in to Cobweb.',
    issuedAt: new Date(),
  })
}

async function web3SignIn(client: SupabaseClient, message: string, signature: Hex) {
  const { data, error } = await client.auth.signInWithWeb3({ chain: 'ethereum', message, signature })
  if (data?.user?.id) createdUserIds.add(data.user.id)
  return { user: data?.user ?? null, error }
}

async function signInCreator(): Promise<Creator> {
  const account = privateKeyToAccount(generatePrivateKey())
  const client = newClient()
  const message = siweMessage(account.address)
  const signature = await account.signMessage({ message })
  const { user, error } = await web3SignIn(client, message, signature)
  if (error || !user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`)
  return { client, account, userId: user.id }
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------
const runId = Math.random().toString(36).slice(2, 8)
let slugCount = 0
const slug = () => `verify-${runId}-${++slugCount}`
let nameCount = 0
const uniqueName = () => `Verify ${runId} ${++nameCount}`

type Collection = {
  id: string
  owner_id: string
  name: string
  slug: string | null
  slug_reserved_at: string | null
  status: string
  chain_id: number | null
  contract_address: string | null
  max_supply: number | null
  art_locked_at: string | null
  updated_at: string
}

function collectionInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: uniqueName(),
    symbol: 'VFY',
    project_type: 'generative',
    ...overrides,
  }
}

async function insertCollection(client: SupabaseClient, overrides: Record<string, unknown> = {}) {
  const { data, error } = await client
    .from('collections')
    .insert(collectionInput(overrides))
    .select()
    .single()
  return { row: data as Collection | null, error }
}

async function stored(id: string): Promise<Collection | null> {
  const { data } = await admin.from('collections').select().eq('id', id).maybeSingle()
  return data as Collection | null
}

async function nameExists(value: string): Promise<boolean> {
  const { data } = await admin.from('collections').select('id').eq('name', value)
  return (data?.length ?? 0) > 0
}

// Reserves a mint page link through the public RPC, as the given client.
async function reserve(client: SupabaseClient, collectionId: string, value: string) {
  const { error } = await client.rpc('reserve_slug', { p_collection_id: collectionId, p_slug: value })
  return error as DbError
}

async function expectRejectedInsert(
  client: SupabaseClient,
  overrides: Record<string, unknown>,
  codes: string[],
) {
  const input = collectionInput(overrides)
  const { data, error } = await client.from('collections').insert(input).select()
  const problem = expectError(error, codes, data)
  if (problem) return problem
  if (await nameExists(input.name as string)) return 'error returned but a row was stored'
  return null
}

const HEX64 = (n: number) => n.toString(16).padStart(64, '0')

function uploadInput(collectionId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    collection_id: collectionId,
    kind: 'layer_image',
    storage_key: `${collectionId}/layers/${HEX64(++nameCount)}.png`,
    content_hash: HEX64(nameCount),
    mime: 'image/png',
    media_type: 'image',
    bytes: 1234,
    width: 1000,
    height: 1000,
    file_name: 'trait.png',
    ...overrides,
  }
}

/** Records an upload through the RPC, as the upload server action will; returns the new row id. */
async function recordUpload(
  client: SupabaseClient,
  collectionId: string,
  overrides: Record<string, unknown> = {},
) {
  const input = uploadInput(collectionId, overrides)
  const { data, error } = await client.rpc('record_upload', {
    p_collection_id: collectionId,
    p_kind: input.kind,
    p_storage_key: input.storage_key,
    p_content_hash: input.content_hash,
    p_mime: input.mime,
    p_media_type: input.media_type,
    p_bytes: input.bytes,
    p_width: input.width,
    p_height: input.height,
    p_file_name: input.file_name,
  })
  return { id: (data as string | null) ?? null, error: error as DbError }
}

async function insertArtCollection(
  client: SupabaseClient,
  collectionId: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await client
    .from('art_collections')
    .insert({ collection_id: collectionId, name: 'Owls', size: 0, position: 0, ...overrides })
    .select()
    .single()
  return { row: data as { id: string } | null, error: error as DbError }
}

async function insertLayer(
  client: SupabaseClient,
  collectionId: string,
  artCollectionId: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await client
    .from('layers')
    .insert({
      collection_id: collectionId,
      art_collection_id: artCollectionId,
      name: 'Eyes',
      position: 0,
      ...overrides,
    })
    .select()
    .single()
  return { row: data as { id: string } | null, error: error as DbError }
}

async function insertUploadRow(client: SupabaseClient, collectionId: string): Promise<string> {
  const { id, error } = await recordUpload(client, collectionId)
  if (error || !id) throw new Error(`upload setup: ${describe(error)}`)
  return id
}

async function insertTrait(
  client: SupabaseClient,
  collectionId: string,
  layerId: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await client
    .from('traits')
    .insert({
      collection_id: collectionId,
      layer_id: layerId,
      name: 'Wide',
      weight: 50,
      position: ++nameCount,
      ...overrides,
    })
    .select()
    .single()
  return { row: data as { id: string } | null, error: error as DbError }
}

const sameStoredRow = (before: Collection | null, after: Collection | null) =>
  before !== null && after !== null && JSON.stringify(before) === JSON.stringify(after)

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`Verifying ${url} (run ${runId})`)

  // 1. Sign-in ---------------------------------------------------------------------------------
  let a: Creator | null = null
  let b: Creator | null = null
  await check('sign-in: creator A', async () => {
    a = await signInCreator()
    return null
  })
  await check('sign-in: creator B', async () => {
    b = await signInCreator()
    return null
  })
  if (!a || !b) return

  await check('sign-in: email sign-ups are disabled', async () => {
    const { data, error } = await newClient().auth.signUp({
      email: `signup-${runId}@example.com`,
      password: `pw-${runId}-Aa1!`,
    })
    if (data.user) createdUserIds.add(data.user.id)
    return error ? null : 'an email account was created'
  })

  await check('collections: a session without a wallet profile cannot create a collection', async () => {
    const email = `nowallet-${runId}@example.com`
    const password = `pw-${runId}-Aa1!`
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError || !created.user) return `setup failed: ${createError?.message}`
    createdUserIds.add(created.user.id)
    const client = newClient()
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) return null // cannot even sign in, which is also fine
    const { data, error } = await client
      .from('collections')
      .insert({
        name: 'No wallet',
        symbol: 'NOW',
        project_type: 'generative',
      })
      .select('id')
    return error || !data?.length ? null : 'accepted (1 row written)'
  })

  const A: Creator = a
  const B: Creator = b

  await check('sign-in: tampered signature rejected', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const message = siweMessage(account.address)
    const signature = await account.signMessage({ message })
    const flipped = signature[10] === 'a' ? 'b' : 'a'
    const tampered = (signature.slice(0, 10) + flipped + signature.slice(11)) as Hex
    const { user, error } = await web3SignIn(newClient(), message, tampered)
    return error ? null : `accepted as user ${user?.id}`
  })

  await check('sign-in: message signed by a different key rejected', async () => {
    const claimed = privateKeyToAccount(generatePrivateKey())
    const signer = privateKeyToAccount(generatePrivateKey())
    const message = siweMessage(claimed.address)
    const signature = await signer.signMessage({ message })
    const { user, error } = await web3SignIn(newClient(), message, signature)
    return error ? null : `accepted as user ${user?.id}`
  })

  await check('sign-in: message for another domain rejected', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const message = siweMessage(account.address, 'evil.example', 'https://evil.example')
    const signature = await account.signMessage({ message })
    const { user, error } = await web3SignIn(newClient(), message, signature)
    return error ? null : `accepted as user ${user?.id}`
  })

  {
    const account = privateKeyToAccount(generatePrivateKey())
    const message = siweMessage(account.address)
    const signature = await account.signMessage({ message })
    const first = await web3SignIn(newClient(), message, signature)
    const replay = await web3SignIn(newClient(), message, signature)
    if (!first.error) {
      info(
        replay.error
          ? 'replaying a used SIWE message + signature is rejected'
          : 'replaying a used SIWE message + signature is ACCEPTED (nonce is not single-use)',
      )
    }
  }

  // 2. Profiles --------------------------------------------------------------------------------
  for (const [label, creator] of [
    ['A', A],
    ['B', B],
  ] as const) {
    await check(`profiles: ${label} has a profile with the lowercase wallet address`, async () => {
      const { data, error } = await creator.client.from('profiles').select().eq('id', creator.userId)
      if (error) return describe(error)
      if (data.length !== 1) return `found ${data.length} rows`
      const expected = creator.account.address.toLowerCase()
      return data[0].wallet_address === expected
        ? null
        : `wallet_address ${data[0].wallet_address} != ${expected}`
    })
    await check(`profiles: ${label} reads only their own profile`, async () => {
      const { data, error } = await creator.client.from('profiles').select('id')
      if (error) return describe(error)
      const ids = data.map((r) => r.id)
      return ids.length === 1 && ids[0] === creator.userId ? null : `saw ${JSON.stringify(ids)}`
    })
  }

  await check('profiles: A cannot read B by id', async () => {
    const { data, error } = await A.client.from('profiles').select().eq('id', B.userId)
    return expectNothing(error, data)
  })

  await check('profiles: A cannot change their wallet address', async () => {
    const upd = await A.client
      .from('profiles')
      .update({ wallet_address: '0x' + '1'.repeat(40) })
      .eq('id', A.userId)
      .select()
    const problem = expectNothing(upd.error, upd.data)
    if (problem) return problem
    const { data } = await admin.from('profiles').select('wallet_address').eq('id', A.userId).single()
    return data?.wallet_address === A.account.address.toLowerCase() ? null : 'stored address changed'
  })
  await check('profiles: A cannot insert a profile', async () => {
    const ins = await A.client
      .from('profiles')
      .insert({ id: crypto.randomUUID(), wallet_address: '0x' + '1'.repeat(40) })
      .select()
    return expectError(ins.error, PERMISSION, ins.data)
  })

  // 3. Collections: create ---------------------------------------------------------------------
  const created = await insertCollection(A.client)
  await check('collections: A inserts a collection and owner_id defaults to A', async () => {
    if (created.error || !created.row) return describe(created.error)
    if (created.row.owner_id !== A.userId) return `owner_id ${created.row.owner_id}`
    if (created.row.status !== 'draft') return `status ${created.row.status}`
    if (created.row.slug !== null) return `slug ${created.row.slug}, expected none`
    if (created.row.max_supply !== null) return `max_supply ${created.row.max_supply}, expected none`
    return null
  })
  if (!created.row) return
  const colA: Collection = created.row

  // 4. Collections: protected columns ----------------------------------------------------------
  await check('collections: A cannot insert naming B as owner', () =>
    expectRejectedInsert(A.client, { owner_id: B.userId }, PERMISSION),
  )
  await check('collections: A cannot insert naming themselves as owner explicitly', () =>
    expectRejectedInsert(A.client, { owner_id: A.userId }, PERMISSION),
  )
  await check('collections: A cannot set status on insert', () =>
    expectRejectedInsert(A.client, { status: 'art_locked' }, PERMISSION),
  )
  await check('collections: A cannot set chain_id on insert', () =>
    expectRejectedInsert(A.client, { chain_id: 1 }, PERMISSION),
  )
  await check('collections: A cannot set contract_address on insert', () =>
    expectRejectedInsert(A.client, { contract_address: '0x' + 'a'.repeat(40) }, PERMISSION),
  )

  for (const [column, value] of [
    ['status', 'art_locked'],
    ['chain_id', 1],
    ['contract_address', '0x' + 'a'.repeat(40)],
    ['owner_id', B.userId],
    ['project_type', 'single_asset'],
    ['created_at', '2000-01-01T00:00:00Z'],
    ['slug', `verify-${runId}-direct`],
    ['slug_reserved_at', '2000-01-01T00:00:00Z'],
  ] as const) {
    await check(`collections: A cannot update ${column}; stored row unchanged`, async () => {
      // A fresh collection each time, so one hole does not contaminate the next check.
      const target = await insertCollection(A.client)
      if (!target.row) return `setup: ${describe(target.error)}`
      const before = await stored(target.row.id)
      const { data, error } = await A.client
        .from('collections')
        .update({ [column]: value })
        .eq('id', target.row.id)
        .select()
      const problem = expectError(error, PERMISSION, data)
      if (problem) return problem
      return sameStoredRow(before, await stored(target.row.id)) ? null : 'stored row changed'
    })
  }

  // 5. Cross-tenant and anonymous access -------------------------------------------------------
  await check("collections: B cannot select A's collection", async () => {
    const { data, error } = await B.client.from('collections').select().eq('id', colA.id)
    return expectNothing(error, data)
  })
  await check("collections: B cannot update A's collection", async () => {
    const before = await stored(colA.id)
    const { data, error } = await B.client
      .from('collections')
      .update({ name: 'Hijacked' })
      .eq('id', colA.id)
      .select()
    const problem = expectNothing(error, data)
    if (problem) return problem
    return sameStoredRow(before, await stored(colA.id)) ? null : 'stored row changed'
  })
  await check("collections: B cannot delete A's collection", async () => {
    const { data, error } = await B.client.from('collections').delete().eq('id', colA.id).select()
    const problem = expectNothing(error, data)
    if (problem) return problem
    return (await stored(colA.id)) ? null : 'row is gone'
  })

  // 7 (setup). Mint groups and whitelist entries, created before the anonymous checks so there is
  // something to (not) see in every table. Rows come only from the record functions (Phases,
  // docs/specs/2026-10-15-phases.md, section 4), so the service role seeds the groups.
  await check('mint_groups: A cannot insert a group; rows come only from the record functions', async () => {
    const { data, error } = await A.client
      .from('mint_groups')
      .insert({ collection_id: colA.id, onchain_id: 1, name: 'Allowlist', price_wei: '1000000000000000' })
      .select()
    return expectError(error, PERMISSION, data)
  })
  const groupInsert = await admin
    .from('mint_groups')
    .insert({ collection_id: colA.id, onchain_id: 1, name: 'Allowlist', price_wei: '1000000000000000' })
    .select()
    .single()
  const groupA = groupInsert.data as { id: string; updated_at: string } | null

  const entryWallet = '0x' + 'b'.repeat(40)
  const entryInsert = groupA
    ? await A.client
        .from('whitelist_entries')
        .insert({ mint_group_id: groupA.id, collection_id: colA.id, wallet_address: entryWallet, quota: 2 })
        .select()
    : null
  await check('whitelist_entries: A adds an entry', async () => {
    if (!entryInsert) return 'no mint group to add to'
    return entryInsert.error ? describe(entryInsert.error) : null
  })

  for (const table of [
    'profiles',
    'collections',
    'mint_groups',
    'whitelist_entries',
    'airdrops',
    'withdrawals',
  ]) {
    await check(`anon: reads nothing from ${table}`, async () => {
      const { data, error } = await anon.from(table).select()
      return expectNothing(error, data)
    })
  }
  await check('anon: cannot insert a collection', () => expectRejectedInsert(anon, {}, PERMISSION))
  await check('collections: A cannot insert with a slug', () =>
    expectRejectedInsert(A.client, { slug: slug() }, PERMISSION),
  )

  // 6. Constraints -----------------------------------------------------------------------------
  for (const [label, value] of [
    ['reserved slug "collections"', 'collections'],
    ['malformed slug', `Bad_Slug-${runId}`],
    ['slug with trailing hyphen', `verify-${runId}-`],
  ] as const) {
    await check(`reserve_slug: ${label} rejected`, async () => {
      const target = await insertCollection(A.client)
      if (!target.row) return `setup: ${describe(target.error)}`
      const problem = expectError(await reserve(A.client, target.row.id, value), CHECK)
      if (problem) return problem
      return (await stored(target.row.id))?.slug === null ? null : 'a slug was stored'
    })
  }
  await check('constraints: lowercase symbol rejected', () =>
    expectRejectedInsert(A.client, { symbol: 'vfy' }, CHECK),
  )
  await check('constraints: max_supply 0 rejected', () =>
    expectRejectedInsert(A.client, { max_supply: 0 }, CHECK),
  )
  await check('constraints: single_asset with max_supply 4001 rejected', () =>
    expectRejectedInsert(A.client, { project_type: 'single_asset', max_supply: 4001 }, CHECK),
  )
  let single: Collection | null = null
  await check('constraints: single_asset with max_supply 4000 accepted', async () => {
    const res = await insertCollection(A.client, { project_type: 'single_asset', max_supply: 4000 })
    single = res.row
    return res.error ? describe(res.error) : null
  })
  await check('constraints: single_asset cannot be updated to max_supply 4001', async () => {
    const target = single as Collection | null
    if (!target) return 'no single_asset collection to update'
    const { data, error } = await A.client
      .from('collections')
      .update({ max_supply: 4001 })
      .eq('id', target.id)
      .select()
    return expectError(error, CHECK, data)
  })
  await check("constraints: project_type 'metadata' rejected (the type was removed)", async () => {
    const input = collectionInput({ project_type: 'metadata' })
    const { data, error } = await A.client.from('collections').insert(input).select()
    // 22P02: not a value of the project_type enum.
    const problem = expectError(error, ['22P02'], data)
    if (problem) return problem
    return (await nameExists(input.name as string)) ? 'error returned but a row was stored' : null
  })
  await check('supply: A sets max_supply on a draft that has none', async () => {
    const draft = await insertCollection(A.client)
    if (!draft.row) return `setup: ${describe(draft.error)}`
    const { data, error } = await A.client
      .from('collections')
      .update({ max_supply: 250 })
      .eq('id', draft.row.id)
      .select()
    if (error) return describe(error)
    if (data.length !== 1) return `updated ${data.length} rows`
    return (await stored(draft.row.id))?.max_supply === 250 ? null : 'max_supply not stored'
  })
  await check('supply: A can change max_supply again while the collection is a draft', async () => {
    const draft = await insertCollection(A.client, { max_supply: 10 })
    if (!draft.row) return `setup: ${describe(draft.error)}`
    const { error } = await A.client.from('collections').update({ max_supply: 12 }).eq('id', draft.row.id)
    if (error) return describe(error)
    return (await stored(draft.row.id))?.max_supply === 12 ? null : 'max_supply not changed'
  })
  await check('supply: max_supply over 100,000 rejected on update', async () => {
    const draft = await insertCollection(A.client)
    if (!draft.row) return `setup: ${describe(draft.error)}`
    const { data, error } = await A.client
      .from('collections')
      .update({ max_supply: 100_001 })
      .eq('id', draft.row.id)
      .select()
    return expectError(error, CHECK, data)
  })
  await check('supply: a collection cannot leave draft without a supply', async () => {
    const draft = await insertCollection(A.client)
    if (!draft.row) return `setup: ${describe(draft.error)}`
    const { error } = await admin.from('collections').update({ status: 'art_locked' }).eq('id', draft.row.id)
    const problem = expectError(error, CHECK)
    if (problem) return problem
    return (await stored(draft.row.id))?.status === 'draft' ? null : 'status changed'
  })
  await check('supply: max_supply is refused once art_locked; stored row unchanged', async () => {
    const target = await insertCollection(A.client)
    if (!target.row) return `setup: ${describe(target.error)}`
    const lock = await admin
      .from('collections')
      .update({ status: 'art_locked', max_supply: 100 })
      .eq('id', target.row.id)
    if (lock.error) return `service role could not lock it: ${describe(lock.error)}`
    const before = await stored(target.row.id)
    const { data, error } = await A.client
      .from('collections')
      .update({ max_supply: 101 })
      .eq('id', target.row.id)
      .select()
    const problem = expectError(error, CHECK, data)
    if (problem) return problem
    return sameStoredRow(before, await stored(target.row.id)) ? null : 'stored row changed'
  })

  // 7. Mint groups -----------------------------------------------------------------------------
  await check("mint_groups: B cannot create a group under A's collection", async () => {
    const { data, error } = await B.client
      .from('mint_groups')
      .insert({ collection_id: colA.id, onchain_id: 7, name: 'Intruder' })
      .select()
    return expectError(error, PERMISSION, data)
  })
  await check("mint_groups: B cannot read A's groups", async () => {
    const { data, error } = await B.client.from('mint_groups').select().eq('collection_id', colA.id)
    return expectNothing(error, data)
  })
  await check("mint_groups: B cannot update or delete A's group", async () => {
    if (!groupA) return 'no group'
    const upd = await B.client.from('mint_groups').update({ name: 'Hijacked' }).eq('id', groupA.id).select()
    const del = await B.client.from('mint_groups').delete().eq('id', groupA.id).select()
    const problem = expectNothing(upd.error, upd.data) ?? expectNothing(del.error, del.data)
    if (problem) return problem
    const { data } = await admin.from('mint_groups').select('name').eq('id', groupA.id).single()
    return data?.name === 'Allowlist' ? null : `stored group is now ${JSON.stringify(data)}`
  })

  const colB = await insertCollection(B.client)
  const groupBInsert = colB.row
    ? await admin
        .from('mint_groups')
        .insert({ collection_id: colB.row.id, onchain_id: 1, name: 'B group' })
        .select()
        .single()
    : null
  const groupB = (groupBInsert?.data ?? null) as { id: string } | null

  await check("mint_groups: A cannot move their group into B's collection", async () => {
    if (!groupA || !colB.row) return 'setup failed'
    const { data, error } = await A.client
      .from('mint_groups')
      .update({ collection_id: colB.row.id })
      .eq('id', groupA.id)
      .select()
    return expectError(error, PERMISSION, data)
  })

  // 7. Whitelist entries -----------------------------------------------------------------------
  await check('whitelist_entries: uppercase address rejected', async () => {
    if (!groupA) return 'no group'
    const { data, error } = await A.client
      .from('whitelist_entries')
      .insert({
        mint_group_id: groupA.id,
        collection_id: colA.id,
        wallet_address: '0x' + 'C'.repeat(40),
        quota: 1,
      })
      .select()
    return expectError(error, CHECK, data)
  })
  await check('whitelist_entries: a negative quota is refused', async () => {
    if (!groupA) return 'no group'
    const { data, error } = await A.client
      .from('whitelist_entries')
      .insert({
        mint_group_id: groupA.id,
        collection_id: colA.id,
        wallet_address: '0x' + 'd'.repeat(40),
        quota: -1,
      })
      .select()
    return expectError(error, CHECK, data)
  })
  await check("whitelist_entries: B cannot read A's entries", async () => {
    const { data, error } = await B.client.from('whitelist_entries').select().eq('collection_id', colA.id)
    return expectNothing(error, data)
  })
  await check("whitelist_entries: B cannot add to A's group", async () => {
    if (!groupA) return 'no group'
    const { data, error } = await B.client
      .from('whitelist_entries')
      .insert({
        mint_group_id: groupA.id,
        collection_id: colA.id,
        wallet_address: '0x' + 'e'.repeat(40),
        quota: 1,
      })
      .select()
    return expectError(error, PERMISSION, data)
  })
  await check('whitelist_entries: group from a different collection of the same owner rejected', async () => {
    if (!groupA) return 'no group'
    const other = await insertCollection(A.client)
    if (!other.row) return `setup: ${describe(other.error)}`
    const { data, error } = await A.client
      .from('whitelist_entries')
      .insert({
        mint_group_id: groupA.id,
        collection_id: other.row.id,
        wallet_address: '0x' + 'f'.repeat(40),
        quota: 1,
      })
      .select()
    return expectError(error, PERMISSION, data)
  })
  await check("whitelist_entries: A cannot attach an entry to B's group via A's collection", async () => {
    if (!groupB) return `setup: ${describe(groupBInsert?.error ?? null)}`
    const squatted = '0x' + '9'.repeat(40)
    const { data, error } = await A.client
      .from('whitelist_entries')
      .insert({ mint_group_id: groupB.id, collection_id: colA.id, wallet_address: squatted, quota: 1 })
      .select()
    const problem = expectError(error, PERMISSION, data)
    if (!problem) return null
    // Show the consequence: B can no longer allowlist that wallet in their own group.
    const blocked = await B.client
      .from('whitelist_entries')
      .insert({ mint_group_id: groupB.id, collection_id: colB.row!.id, wallet_address: squatted, quota: 1 })
      .select()
    return `${problem}; B adding the same wallet to their own group then gets: ${describe(blocked.error)}`
  })

  // 7b. Mint page link reservations ---------------------------------------------------------
  const DAY_MS = 24 * 3600 * 1000
  const reservedSlug = slug()
  const first = await insertCollection(A.client)
  await check('reserve_slug: the owner reserves a link; slug_reserved_at is set', async () => {
    if (!first.row) return `setup: ${describe(first.error)}`
    const error = await reserve(A.client, first.row.id, reservedSlug)
    if (error) return describe(error)
    const row = await stored(first.row.id)
    if (row?.slug !== reservedSlug) return `slug ${row?.slug}`
    if (!row.slug_reserved_at) return 'slug_reserved_at not set'
    const age = Date.now() - Date.parse(row.slug_reserved_at)
    return Math.abs(age) < 60_000 ? null : `slug_reserved_at ${row.slug_reserved_at} is not now`
  })
  await check("reserve_slug: B cannot reserve on A's collection", async () => {
    if (!first.row) return 'no collection'
    const before = await stored(first.row.id)
    const problem = expectError(await reserve(B.client, first.row.id, slug()), PERMISSION)
    if (problem) return problem
    return sameStoredRow(before, await stored(first.row.id)) ? null : 'stored row changed'
  })
  await check('reserve_slug: anon cannot call it', async () => {
    if (!first.row) return 'no collection'
    const error = await reserve(anon, first.row.id, slug())
    return error ? null : 'accepted'
  })
  const second = await insertCollection(B.client)
  await check('reserve_slug: a live reservation (under 3 days) cannot be taken; 23505', async () => {
    if (!second.row) return `setup: ${describe(second.error)}`
    const problem = expectError(await reserve(B.client, second.row.id, reservedSlug), UNIQUE)
    if (problem) return problem
    return (await stored(second.row.id))?.slug === null ? null : 'a slug was stored'
  })
  await check(
    'reserve_slug: a lapsed reservation (4 days old) is taken over; the first loses it',
    async () => {
      if (!first.row || !second.row) return 'setup failed'
      const aged = await admin
        .from('collections')
        .update({ slug_reserved_at: new Date(Date.now() - 4 * DAY_MS).toISOString() })
        .eq('id', first.row.id)
      if (aged.error) return `service role could not age it: ${describe(aged.error)}`
      const error = await reserve(B.client, second.row.id, reservedSlug)
      if (error) return describe(error)
      const [was, now] = [await stored(first.row.id), await stored(second.row.id)]
      if (now?.slug !== reservedSlug) return `second has ${now?.slug}`
      if (was?.slug !== null || was.slug_reserved_at !== null)
        return `first still has ${was?.slug} (${was?.slug_reserved_at})`
      return null
    },
  )
  await check('reserve_slug: the owner can change their reservation; the old link is freed', async () => {
    if (!second.row) return 'no collection'
    const next = slug()
    const error = await reserve(B.client, second.row.id, next)
    if (error) return describe(error)
    if ((await stored(second.row.id))?.slug !== next) return 'not changed'
    const reuse = await insertCollection(A.client)
    if (!reuse.row) return `setup: ${describe(reuse.error)}`
    const again = await reserve(A.client, reuse.row.id, reservedSlug)
    return again ? `old link not free: ${describe(again)}` : null
  })

  const deployedSlug = slug()
  const shipped = await insertCollection(A.client)
  await check('reserve_slug: a deployed collection can change its link; the old one is freed', async () => {
    if (!shipped.row) return `setup: ${describe(shipped.error)}`
    const oldSlug = slug()
    const reserved = await reserve(A.client, shipped.row.id, oldSlug)
    if (reserved) return `setup reserve: ${describe(reserved)}`
    const set = await admin
      .from('collections')
      .update({ status: 'deployed', max_supply: 100, chain_id: 1, contract_address: '0x' + '5'.repeat(40) })
      .eq('id', shipped.row.id)
    if (set.error) return `service role could not deploy it: ${describe(set.error)}`
    const error = await reserve(A.client, shipped.row.id, deployedSlug)
    if (error) return describe(error)
    const row = await stored(shipped.row.id)
    if (row?.slug !== deployedSlug) return `slug ${row?.slug}`
    if (row.slug_reserved_at !== null) return `slug_reserved_at ${row.slug_reserved_at}, expected none`
    const reuse = await insertCollection(B.client)
    if (!reuse.row) return `setup: ${describe(reuse.error)}`
    const again = await reserve(B.client, reuse.row.id, oldSlug)
    return again ? `old link not free: ${describe(again)}` : null
  })
  await check('collections: A cannot change the link of a deployed collection directly', async () => {
    if (!shipped.row) return 'no collection'
    const before = await stored(shipped.row.id)
    const { data, error } = await A.client
      .from('collections')
      .update({ slug: slug() })
      .eq('id', shipped.row.id)
      .select()
    const problem = expectError(error, PERMISSION, data)
    if (problem) return problem
    return sameStoredRow(before, await stored(shipped.row.id)) ? null : 'stored row changed'
  })
  await check("reserve_slug: a deployed collection's link is never taken over, however old", async () => {
    if (!shipped.row) return 'no collection'
    await admin
      .from('collections')
      .update({ slug_reserved_at: new Date(Date.now() - 30 * DAY_MS).toISOString() })
      .eq('id', shipped.row.id)
    const other = await insertCollection(B.client)
    if (!other.row) return `setup: ${describe(other.error)}`
    const problem = expectError(await reserve(B.client, other.row.id, deployedSlug), UNIQUE)
    if (problem) return problem
    return (await stored(shipped.row.id))?.slug === deployedSlug ? null : 'deployed link lost'
  })
  await check('reserve_slug: a deployed collection without a link can set one, then change it', async () => {
    const bare = await insertCollection(A.client)
    if (!bare.row) return `setup: ${describe(bare.error)}`
    await admin
      .from('collections')
      .update({ status: 'deployed', max_supply: 100, chain_id: 1, contract_address: '0x' + '6'.repeat(40) })
      .eq('id', bare.row.id)
    const value = slug()
    const error = await reserve(A.client, bare.row.id, value)
    if (error) return describe(error)
    if ((await stored(bare.row.id))?.slug !== value) return 'not stored'
    const next = slug()
    const changed = await reserve(A.client, bare.row.id, next)
    if (changed) return `change refused: ${describe(changed)}`
    return (await stored(bare.row.id))?.slug === next ? null : 'not changed'
  })
  await check('collections: a reservation that lapsed before deploy is released at deploy', async () => {
    const late = await insertCollection(A.client)
    if (!late.row) return `setup: ${describe(late.error)}`
    const reserved = await reserve(A.client, late.row.id, slug())
    if (reserved) return `setup reserve: ${describe(reserved)}`
    await admin
      .from('collections')
      .update({ slug_reserved_at: new Date(Date.now() - 4 * DAY_MS).toISOString() })
      .eq('id', late.row.id)
    const set = await admin
      .from('collections')
      .update({ status: 'deployed', max_supply: 100, chain_id: 1, contract_address: '0x' + '7'.repeat(40) })
      .eq('id', late.row.id)
    if (set.error) return `service role could not deploy it: ${describe(set.error)}`
    const row = await stored(late.row.id)
    return row?.slug === null ? null : `slug ${row?.slug} kept`
  })

  // 8. updated_at ------------------------------------------------------------------------------
  await check('collections: updated_at advances on update', async () => {
    await pause(50)
    const { data, error } = await A.client
      .from('collections')
      .update({ name: 'Verify renamed' })
      .eq('id', colA.id)
      .select()
      .single()
    if (error) return describe(error)
    return Date.parse(data.updated_at) > Date.parse(colA.updated_at)
      ? null
      : `${data.updated_at} is not after ${colA.updated_at}`
  })
  await check('mint_groups: updated_at advances on update', async () => {
    if (!groupA) return 'no group'
    await pause(50)
    const { data, error } = await A.client
      .from('mint_groups')
      .update({ name: 'Allowlist 2' })
      .eq('id', groupA.id)
      .select()
      .single()
    if (error) return describe(error)
    return Date.parse(data.updated_at) > Date.parse(groupA.updated_at)
      ? null
      : `${data.updated_at} is not after ${groupA.updated_at}`
  })

  // 9. Delete ----------------------------------------------------------------------------------
  await check('collections: A can delete a draft', async () => {
    const draft = await insertCollection(A.client)
    if (!draft.row) return `setup: ${describe(draft.error)}`
    const { data, error } = await A.client.from('collections').delete().eq('id', draft.row.id).select()
    if (error) return describe(error)
    if (data.length !== 1) return `deleted ${data.length} rows`
    return (await stored(draft.row.id)) ? 'row still stored' : null
  })
  await check('collections: A cannot delete a non-draft', async () => {
    const locked = await insertCollection(A.client)
    if (!locked.row) return `setup: ${describe(locked.error)}`
    const set = await admin
      .from('collections')
      .update({ status: 'art_locked', max_supply: 100 })
      .eq('id', locked.row.id)
    if (set.error) return `service role could not set status: ${describe(set.error)}`
    const { data, error } = await A.client.from('collections').delete().eq('id', locked.row.id).select()
    const problem = expectNothing(error, data)
    if (problem) return problem
    return (await stored(locked.row.id)) ? null : 'row is gone'
  })
  await check('collections: A cannot move a non-draft back to draft (and then delete it)', async () => {
    const locked = await insertCollection(A.client)
    if (!locked.row) return `setup: ${describe(locked.error)}`
    const set = await admin
      .from('collections')
      .update({ status: 'art_locked', max_supply: 100 })
      .eq('id', locked.row.id)
    if (set.error) return `service role could not set status: ${describe(set.error)}`
    const reset = await A.client
      .from('collections')
      .update({ status: 'draft' })
      .eq('id', locked.row.id)
      .select()
    const problem = expectError(reset.error, PERMISSION, reset.data)
    if (!problem) return null
    const del = await A.client.from('collections').delete().eq('id', locked.row.id).select()
    const gone = !del.error && del.data.length === 1
    return `${problem}; A then ${gone ? 'deleted it' : `could not delete it (${describe(del.error)})`}`
  })

  await check(
    'collections and mint_groups: on a deployed collection the owner changes neither max_supply nor adds a group',
    async () => {
      const deployed = await insertCollection(A.client)
      if (!deployed.row) return `setup: ${describe(deployed.error)}`
      const set = await admin
        .from('collections')
        .update({ status: 'deployed', max_supply: 100, chain_id: 1, contract_address: '0x' + '4'.repeat(40) })
        .eq('id', deployed.row.id)
      if (set.error) return `setup: ${describe(set.error)}`
      const upd = await A.client
        .from('collections')
        .update({ max_supply: 5 })
        .eq('id', deployed.row.id)
        .select()
      const supply = expectError(upd.error, CHECK, upd.data)
      if (supply) return `max_supply: ${supply}`
      const grp = await A.client
        .from('mint_groups')
        .insert({ collection_id: deployed.row.id, onchain_id: 9, name: 'Late' })
        .select()
      const group = expectError(grp.error, PERMISSION, grp.data)
      return group ? `mint group: ${group}` : null
    },
  )

  await artFoundation(A, B)
  await artTraitsAndRules(A, B)
  await artTokens(A, B)
  await artLockAndJobs(A, B)
  await artInvariants(A)
  await artEdits(A, B)
  await artLockAndPay(A, B)
  await artRenderState(A, B)
  await artRenderCredit(A, B)
  await artDeploy(A, B)
  await artPhases(A, B)
  await artWhitelist(A, B)
  await artAirdropSettings(A, B)
}

// ---------------------------------------------------------------------------------------------
// 9a. Art foundation: uploads, art collections, layers, collection art columns
// ---------------------------------------------------------------------------------------------
async function artFoundation(A: Creator, B: Creator): Promise<void> {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const other = await insertCollection(B.client)
  if (!other.row) throw new Error(`setup: ${describe(other.error)}`)

  let artId = ''
  await check('art_collections: A inserts one under their collection', async () => {
    const { row, error } = await insertArtCollection(A.client, cid)
    if (error || !row) return describe(error)
    artId = row.id
    return null
  })
  await check("art_collections: B cannot insert into A's collection", async () => {
    const { error, row } = await insertArtCollection(B.client, cid, { position: 1 })
    return expectError(error, PERMISSION, row ? [row] : null)
  })
  await check("art_collections: B cannot read A's", async () => {
    const { data, error } = await B.client.from('art_collections').select().eq('collection_id', cid)
    return expectNothing(error, data)
  })
  await check("art_collections: B cannot update or delete A's", async () => {
    const upd = await B.client.from('art_collections').update({ name: 'Hijacked' }).eq('id', artId).select()
    const del = await B.client.from('art_collections').delete().eq('id', artId).select()
    return expectNothing(upd.error, upd.data) ?? expectNothing(del.error, del.data)
  })
  await check('art_collections: A cannot move one to another of their own collections', async () => {
    const second = await insertCollection(A.client)
    if (!second.row) return `setup: ${describe(second.error)}`
    const { data, error } = await A.client
      .from('art_collections')
      .update({ collection_id: second.row.id })
      .eq('id', artId)
      .select()
    return expectError(error as DbError, PERMISSION, data)
  })
  await check('art_collections: a size above 10,000 is refused', async () => {
    const { error, row } = await insertArtCollection(A.client, cid, { position: 2, size: 10_001 })
    return expectError(error, CHECK, row ? [row] : null)
  })

  let layerId = ''
  await check('layers: A inserts one under their art collection', async () => {
    const { row, error } = await insertLayer(A.client, cid, artId)
    if (error || !row) return describe(error)
    layerId = row.id
    return null
  })
  await check("layers: a layer naming B's collection with A's art collection is refused", async () => {
    const { error, row } = await insertLayer(B.client, other.row!.id, artId, { position: 5 })
    return expectError(error, [...PERMISSION, ...CHECK], row ? [row] : null)
  })
  await check("layers: B cannot read A's layer", async () => {
    const { data, error } = await B.client.from('layers').select().eq('id', layerId)
    return expectNothing(error, data)
  })

  let uploadId = ''
  await check('uploads: A records a layer image through record_upload', async () => {
    const { id, error } = await recordUpload(A.client, cid)
    if (error || !id) return describe(error)
    uploadId = id
    return null
  })
  await check('uploads: a direct insert is refused, even by the owner', async () => {
    const { data, error } = await A.client.from('uploads').insert(uploadInput(cid)).select()
    return expectError(error as DbError, PERMISSION, data)
  })
  await check("uploads: a key outside the collection's prefix is refused", async () => {
    const { id, error } = await recordUpload(A.client, cid, {
      storage_key: `${other.row!.id}/layers/stolen.png`,
    })
    return expectError(error, CHECK, id ? [id] : null)
  })
  await check('uploads: a key that climbs out of its folder is refused', async () => {
    const { id, error } = await recordUpload(A.client, cid, {
      storage_key: `${cid}/../${other.row!.id}/x.png`,
    })
    return expectError(error, CHECK, id ? [id] : null)
  })
  await check('uploads: a non-square layer image is refused', async () => {
    const { id, error } = await recordUpload(A.client, cid, { width: 1000, height: 900 })
    return expectError(error, CHECK, id ? [id] : null)
  })
  await check('uploads: the same content hash twice for one kind is refused', async () => {
    const first = uploadInput(cid)
    const a = await recordUpload(A.client, cid, first)
    if (a.error) return `setup: ${describe(a.error)}`
    const { id, error } = await recordUpload(A.client, cid, {
      ...first,
      storage_key: `${(first.storage_key as string).replace(/\.png$/, '')}-again.png`,
    })
    return expectError(error, UNIQUE, id ? [id] : null)
  })
  await check('uploads: A cannot change the stored object description', async () => {
    const { data, error } = await A.client
      .from('uploads')
      .update({ storage_key: 'moved' })
      .eq('id', uploadId)
      .select()
    return expectError(error as DbError, PERMISSION, data)
  })
  await check("uploads: B cannot read A's uploads or record into A's collection", async () => {
    const read = await B.client.from('uploads').select().eq('collection_id', cid)
    const rec = await recordUpload(B.client, cid)
    return (
      expectNothing(read.error, read.data) ?? expectError(rec.error, PERMISSION, rec.id ? [rec.id] : null)
    )
  })

  await check('collections: A sets the art columns while unlocked', async () => {
    const { data, error } = await A.client
      .from('collections')
      .update({
        token_name: 'Night Owls',
        show_blank_traits: true,
        canvas_width: 1000,
        canvas_height: 1000,
        art_deferred: true,
      })
      .eq('id', cid)
      .select()
    if (error) return describe(error)
    return data?.length === 1 ? null : 'no row updated'
  })
  await check('collections: a non-square canvas is refused', async () => {
    const { data, error } = await A.client
      .from('collections')
      .update({ canvas_width: 1000, canvas_height: 800 })
      .eq('id', cid)
      .select()
    return expectError(error, CHECK, data)
  })
  await check('collections: a token name with # is refused', async () => {
    const { data, error } = await A.client
      .from('collections')
      .update({ token_name: 'Owl #' })
      .eq('id', cid)
      .select()
    return expectError(error, CHECK, data)
  })
  await check('collections: A cannot set art_locked_at', async () => {
    const { data, error } = await A.client
      .from('collections')
      .update({ art_locked_at: new Date().toISOString() })
      .eq('id', cid)
      .select()
    return expectError(error, PERMISSION, data)
  })
}

// ---------------------------------------------------------------------------------------------
// 9b. Traits, rules and constraints
// ---------------------------------------------------------------------------------------------
async function artTraitsAndRules(A: Creator, B: Creator): Promise<void> {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const art = await insertArtCollection(A.client, cid)
  const eyes = await insertLayer(A.client, cid, art.row!.id, { name: 'Eyes', position: 0 })
  const hats = await insertLayer(A.client, cid, art.row!.id, { name: 'Hats', position: 1 })
  const uploadId = await insertUploadRow(A.client, cid)
  const other = await insertCollection(B.client)
  const otherArt = await insertArtCollection(B.client, other.row!.id)
  const otherLayer = await insertLayer(B.client, other.row!.id, otherArt.row!.id)
  const otherUpload = await insertUploadRow(B.client, other.row!.id)
  const otherTrait = await insertTrait(B.client, other.row!.id, otherLayer.row!.id, {
    upload_id: otherUpload,
  })

  let wide = ''
  let blank = ''
  let cap = ''
  await check('traits: A inserts a trait with an image and a blank without one', async () => {
    const a = await insertTrait(A.client, cid, eyes.row!.id, { name: 'Wide', upload_id: uploadId })
    const b = await insertTrait(A.client, cid, eyes.row!.id, { name: 'None', blank: true, weight: 50 })
    if (a.error || b.error) return describe(a.error ?? b.error)
    wide = a.row!.id
    blank = b.row!.id
    return null
  })
  await check('traits: a trait that is not blank needs an image', async () => {
    const { error, row } = await insertTrait(A.client, cid, eyes.row!.id, { name: 'Bare' })
    return expectError(error, CHECK, row ? [row] : null)
  })
  await check('traits: a second blank in one layer is refused', async () => {
    const { error, row } = await insertTrait(A.client, cid, eyes.row!.id, { name: 'None 2', blank: true })
    return expectError(error, UNIQUE, row ? [row] : null)
  })
  await check('traits: a capped trait has weight 0 and a cap from 1 to 10,000', async () => {
    const bad = await insertTrait(A.client, cid, hats.row!.id, {
      name: 'Gold',
      upload_id: uploadId,
      constant: 3,
      weight: 10,
    })
    const good = await insertTrait(A.client, cid, hats.row!.id, {
      name: 'Gold',
      upload_id: uploadId,
      constant: 3,
      weight: 0,
    })
    if (good.error || !good.row) return `good refused: ${describe(good.error)}`
    cap = good.row.id
    return expectError(bad.error, CHECK, bad.row ? [bad.row] : null)
  })
  await check('traits: a trait whose layer is in another collection is refused', async () => {
    const { error, row } = await insertTrait(A.client, cid, otherLayer.row!.id, { upload_id: uploadId })
    return expectError(error, [...PERMISSION, ...CHECK], row ? [row] : null)
  })
  await check('traits: an image from another collection is refused', async () => {
    const { error, row } = await insertTrait(A.client, cid, hats.row!.id, {
      name: 'Stolen',
      upload_id: otherUpload,
    })
    return expectError(error, CHECK, row ? [row] : null)
  })
  await check('traits: the 501st trait of a layer is refused with the cap message', async () => {
    const layer = await insertLayer(A.client, cid, art.row!.id, { name: 'Many', position: 2 })
    const rows = Array.from({ length: 500 }, (_, i) => ({
      collection_id: cid,
      layer_id: layer.row!.id,
      name: `T${i}`,
      weight: 0.2,
      position: i,
      upload_id: uploadId,
    }))
    const bulk = await A.client.from('traits').insert(rows)
    if (bulk.error) return `setup: ${describe(bulk.error as DbError)}`
    const { error, row } = await insertTrait(A.client, cid, layer.row!.id, {
      name: 'T500',
      upload_id: uploadId,
      position: 500,
    })
    const problem = expectError(error, CHECK, row ? [row] : null)
    if (problem) return problem
    return error?.message.includes('at most 500 traits') ? null : `wrong message: ${error?.message}`
  })
  await check("traits: B cannot read A's", async () => {
    const { data, error } = await B.client.from('traits').select().eq('id', wide)
    return expectNothing(error, data)
  })
  await check('uploads: an image a trait uses cannot be deleted', async () => {
    const { data, error } = await A.client.from('uploads').delete().eq('id', uploadId).select()
    return expectError(error as DbError, ['23503'], data)
  })

  await check('rules: A inserts a doesnt_mix_with rule between two layers', async () => {
    const { error } = await A.client.from('rules').insert({
      collection_id: cid,
      kind: 'doesnt_mix_with',
      trait_id: wide,
      related_trait_ids: [cap],
      bidirectional: true,
    })
    return error ? describe(error as DbError) : null
  })
  await check('rules: bidirectional must match the kind', async () => {
    const { data, error } = await A.client
      .from('rules')
      .insert({
        collection_id: cid,
        kind: 'must_pair_with',
        trait_id: wide,
        related_trait_ids: [cap],
        bidirectional: true,
      })
      .select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('rules: a related trait in another collection is refused', async () => {
    const { data, error } = await A.client
      .from('rules')
      .insert({
        collection_id: cid,
        kind: 'doesnt_mix_with',
        trait_id: wide,
        related_trait_ids: [otherTrait.row!.id],
        bidirectional: true,
      })
      .select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('rules: related traits must share one layer', async () => {
    const { data, error } = await A.client
      .from('rules')
      .insert({
        collection_id: cid,
        kind: 'doesnt_mix_with',
        trait_id: cap,
        related_trait_ids: [wide, blank, cap],
        bidirectional: true,
      })
      .select()
    return expectError(error as DbError, CHECK, data)
  })

  await check('at_least_one: A inserts one over two traits; one trait is refused', async () => {
    const ok = await A.client
      .from('at_least_one')
      .insert({ collection_id: cid, art_collection_id: art.row!.id, trait_ids: [wide, blank] })
    if (ok.error) return describe(ok.error as DbError)
    const { data, error } = await A.client
      .from('at_least_one')
      .insert({ collection_id: cid, art_collection_id: art.row!.id, trait_ids: [wide] })
      .select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('at_least_one: a trait of another collection is refused', async () => {
    const { data, error } = await A.client
      .from('at_least_one')
      .insert({ collection_id: cid, art_collection_id: art.row!.id, trait_ids: [wide, otherTrait.row!.id] })
      .select()
    return expectError(error as DbError, CHECK, data)
  })
}

// ---------------------------------------------------------------------------------------------
// 9c. Tokens
// ---------------------------------------------------------------------------------------------
async function artTokens(A: Creator, B: Creator): Promise<void> {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const art = await insertArtCollection(A.client, cid, { size: 4 })
  const uploadId = await insertUploadRow(A.client, cid)
  const bg = await insertLayer(A.client, cid, art.row!.id, { name: 'Background', position: 0 })
  const eyes = await insertLayer(A.client, cid, art.row!.id, { name: 'Eyes', position: 1 })
  const ink = (
    await insertTrait(A.client, cid, bg.row!.id, { name: 'Ink', upload_id: uploadId, position: 0 })
  ).row!.id
  const wide = (
    await insertTrait(A.client, cid, eyes.row!.id, { name: 'Wide', upload_id: uploadId, position: 0 })
  ).row!.id
  const none = (await insertTrait(A.client, cid, eyes.row!.id, { name: 'None', blank: true, position: 1 }))
    .row!.id
  const token = (id: number, dna: string[]) => ({
    collection_id: cid,
    token_id: id,
    art_collection_id: art.row!.id,
    dna,
  })
  const DNA_MSG = 'Token DNA does not match the layers.'

  await check('tokens: A inserts tokens whose DNA matches the layers, a blank included', async () => {
    const { error } = await A.client.from('tokens').insert([token(1, [ink, wide]), token(2, [ink, none])])
    return error ? describe(error as DbError) : null
  })
  await check('tokens: a DNA of the wrong length is refused with the DNA message', async () => {
    const { data, error } = await A.client
      .from('tokens')
      .insert(token(3, [ink]))
      .select()
    const problem = expectError(error as DbError, CHECK, data)
    return problem ?? (error?.message.includes(DNA_MSG) ? null : `wrong message: ${error?.message}`)
  })
  await check('tokens: a trait in the wrong layer position is refused', async () => {
    const { data, error } = await A.client
      .from('tokens')
      .insert(token(3, [wide, ink]))
      .select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('tokens: the same trait twice is refused', async () => {
    const { data, error } = await A.client
      .from('tokens')
      .insert(token(3, [ink, ink]))
      .select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('tokens: a token id above 100,000 or below 1 is refused', async () => {
    const hi = await A.client
      .from('tokens')
      .insert(token(100_001, [ink, wide]))
      .select()
    const lo = await A.client
      .from('tokens')
      .insert(token(0, [ink, wide]))
      .select()
    return (
      expectError(hi.error as DbError, CHECK, hi.data) ?? expectError(lo.error as DbError, CHECK, lo.data)
    )
  })
  await check('tokens: A updates a DNA and the guard re-checks it', async () => {
    const ok = await A.client
      .from('tokens')
      .update({ dna: [ink, none] })
      .eq('collection_id', cid)
      .eq('token_id', 1)
      .select()
    if (ok.error) return describe(ok.error as DbError)
    const { data, error } = await A.client
      .from('tokens')
      .update({ dna: [none, ink] })
      .eq('collection_id', cid)
      .eq('token_id', 1)
      .select()
    return expectError(error as DbError, CHECK, data)
  })
  await check("tokens: B cannot read A's tokens", async () => {
    const { data, error } = await B.client.from('tokens').select().eq('collection_id', cid)
    return expectNothing(error, data)
  })
  await check('layers: a position change is refused while the art collection has tokens', async () => {
    const { data, error } = await A.client
      .from('layers')
      .update({ position: 5 })
      .eq('id', eyes.row!.id)
      .select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('layers: adding a layer is refused while the art collection has tokens', async () => {
    const { error, row } = await insertLayer(A.client, cid, art.row!.id, { name: 'Late', position: 7 })
    return expectError(error, CHECK, row ? [row] : null)
  })
  await check('tokens: two ids swap in one statement under the deferrable key', async () => {
    // Tokens 1 and 2 both carry [ink, none] by now; give token 2 a distinct DNA so the swap is observable.
    const prep = await A.client
      .from('tokens')
      .update({ dna: [ink, wide] })
      .eq('collection_id', cid)
      .eq('token_id', 2)
    if (prep.error) return `setup: ${describe(prep.error as DbError)}`
    const { error } = await A.client.rpc('swap_token_ids_for_check', { p_collection_id: cid, p_a: 1, p_b: 2 })
    if (error) return describe(error as DbError)
    const { data } = await admin
      .from('tokens')
      .select('token_id, dna')
      .eq('collection_id', cid)
      .in('token_id', [1, 2])
      .order('token_id')
    const rows = (data ?? []) as { token_id: number; dna: string[] }[]
    return rows[0]?.dna[1] === wide && rows[1]?.dna[1] === none
      ? null
      : `ids did not swap: ${JSON.stringify(rows)}`
  })
  await check('layers: a rename is still allowed while tokens exist', async () => {
    const { error } = await A.client.from('layers').update({ name: 'Eyes 2' }).eq('id', eyes.row!.id)
    return error ? describe(error as DbError) : null
  })
  await check('layers: deleting a layer is refused while the art collection has tokens', async () => {
    const { data, error } = await A.client.from('layers').delete().eq('id', eyes.row!.id).select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('art_collections: deleting one removes its tokens by cascade', async () => {
    const second = await insertArtCollection(A.client, cid, { name: 'Owlets', position: 1, size: 1 })
    const layer = await insertLayer(A.client, cid, second.row!.id, { name: 'Body', position: 0 })
    const barn = (
      await insertTrait(A.client, cid, layer.row!.id, { name: 'Barn', upload_id: uploadId, position: 0 })
    ).row!.id
    const ins = await A.client
      .from('tokens')
      .insert({ collection_id: cid, token_id: 3, art_collection_id: second.row!.id, dna: [barn] })
    if (ins.error) return `setup: ${describe(ins.error as DbError)}`
    const del = await A.client.from('art_collections').delete().eq('id', second.row!.id)
    if (del.error) return describe(del.error as DbError)
    const { data } = await admin.from('tokens').select('token_id').eq('collection_id', cid).eq('token_id', 3)
    // Ids are not renumbered here: that is the server action's job, with the engine's deleteTokens.
    return data && data.length === 0 ? null : 'token 3 survived its art collection'
  })
}

// ---------------------------------------------------------------------------------------------
// 9d. Render jobs and the lock gate
// ---------------------------------------------------------------------------------------------
const createdJobIds = new Set<string>()

async function artLockAndJobs(A: Creator, B: Creator): Promise<void> {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const art = await insertArtCollection(A.client, cid, { size: 1 })
  const uploadId = await insertUploadRow(A.client, cid)
  const layer = await insertLayer(A.client, cid, art.row!.id)
  const trait = (await insertTrait(A.client, cid, layer.row!.id, { upload_id: uploadId })).row!.id
  // A second layer and trait, a valid rule and a valid constraint, so the lock checks have rows to update and delete.
  const layer2 = await insertLayer(A.client, cid, art.row!.id, { name: 'Hat', position: 1 })
  const trait2 = (await insertTrait(A.client, cid, layer2.row!.id, { name: 'Cap', upload_id: uploadId })).row!
    .id
  const ruleSetup = await A.client.from('rules').insert({
    collection_id: cid,
    kind: 'doesnt_mix_with',
    trait_id: trait,
    related_trait_ids: [trait2],
    bidirectional: true,
  })
  if (ruleSetup.error) throw new Error(`setup: ${describe(ruleSetup.error as DbError)}`)
  const aloSetup = await A.client
    .from('at_least_one')
    .insert({ collection_id: cid, art_collection_id: art.row!.id, trait_ids: [trait, trait2] })
  if (aloSetup.error) throw new Error(`setup: ${describe(aloSetup.error as DbError)}`)
  const tok = await A.client
    .from('tokens')
    .insert({ collection_id: cid, token_id: 1, art_collection_id: art.row!.id, dna: [trait, trait2] })
  if (tok.error) throw new Error(`setup: ${describe(tok.error as DbError)}`)
  const jobInput = {
    collection_id: cid,
    kind: 'real',
    state: 'locked',
    token_count: 1,
    token_list_hash: `0x${HEX64(7)}`,
    fee_per_token_wei: '0',
    quote_total_wei: '0',
  }

  await check('render_jobs: A cannot insert a job', async () => {
    const { data, error } = await A.client.from('render_jobs').insert(jobInput).select()
    return expectError(error as DbError, PERMISSION, data)
  })
  let jobId = ''
  await check('render_jobs: the service role inserts a job and A reads it', async () => {
    const { data, error } = await admin.from('render_jobs').insert(jobInput).select().single()
    if (error || !data) return describe(error as DbError)
    jobId = (data as { id: string }).id
    createdJobIds.add(jobId)
    const mine = await A.client.from('render_jobs').select('id').eq('id', jobId)
    return mine.data?.length === 1 ? null : `A sees ${mine.data?.length ?? 0} rows`
  })
  await check("render_jobs: B cannot read A's job; A cannot update or delete it", async () => {
    const read = await B.client.from('render_jobs').select().eq('id', jobId)
    const upd = await A.client.from('render_jobs').update({ state: 'paid' }).eq('id', jobId).select()
    const del = await A.client.from('render_jobs').delete().eq('id', jobId).select()
    return (
      expectNothing(read.error, read.data) ??
      expectError(upd.error as DbError, PERMISSION, upd.data) ??
      expectError(del.error as DbError, PERMISSION, del.data)
    )
  })
  await check('render_jobs: a second open job of the same kind is refused', async () => {
    const { data, error } = await admin.from('render_jobs').insert(jobInput).select()
    return expectError(error as DbError, UNIQUE, data)
  })
  await check(
    'render_jobs: a placeholder job needs its upload; a paid state needs a payment or a zero quote',
    async () => {
      const noUpload = await admin
        .from('render_jobs')
        .insert({ ...jobInput, kind: 'placeholder' })
        .select()
      const unpaid = await admin
        .from('render_jobs')
        .insert({
          ...jobInput,
          kind: 'placeholder',
          placeholder_upload_id: uploadId,
          state: 'rendering',
          quote_total_wei: '5',
        })
        .select()
      return (
        expectError(noUpload.error as DbError, CHECK, noUpload.data) ??
        expectError(unpaid.error as DbError, CHECK, unpaid.data)
      )
    },
  )
  await check('render_batches: the service role inserts one, A reads it, B cannot', async () => {
    const ins = await admin
      .from('render_batches')
      .insert({ job_id: jobId, index: 0, state: 'queued', first_token_id: 1, last_token_id: 1 })
    if (ins.error) return describe(ins.error as DbError)
    const mine = await A.client.from('render_batches').select('index').eq('job_id', jobId)
    const theirs = await B.client.from('render_batches').select('index').eq('job_id', jobId)
    return (
      (mine.data?.length === 1 ? null : `A sees ${mine.data?.length ?? 0}`) ??
      expectNothing(theirs.error, theirs.data)
    )
  })

  await check('render_batches: A cannot insert, update or delete', async () => {
    const ins = await A.client
      .from('render_batches')
      .insert({ job_id: jobId, index: 1, state: 'queued', first_token_id: 1, last_token_id: 1 })
    const upd = await A.client.from('render_batches').update({ state: 'done' }).eq('job_id', jobId)
    const del = await A.client.from('render_batches').delete().eq('job_id', jobId)
    return (
      expectError(ins.error, PERMISSION, ins.data) ??
      expectError(upd.error, PERMISSION, upd.data) ??
      expectError(del.error, PERMISSION, del.data)
    )
  })

  await check('lock: the service role sets art_locked_at', async () => {
    const { error } = await admin
      .from('collections')
      .update({ art_locked_at: new Date().toISOString() })
      .eq('id', cid)
    return error ? describe(error) : null
  })
  const LOCKED = ['42501']
  const tables: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['art_collections', { collection_id: cid, name: 'Late', size: 0, position: 9 }, { name: 'Renamed' }],
    [
      'layers',
      { collection_id: cid, art_collection_id: art.row!.id, name: 'Late', position: 9 },
      { name: 'Renamed' },
    ],
    [
      'traits',
      { collection_id: cid, layer_id: layer.row!.id, name: 'Late', weight: 0, blank: true, position: 9 },
      { name: 'Renamed' },
    ],
    [
      'rules',
      {
        collection_id: cid,
        kind: 'doesnt_mix_with',
        trait_id: trait,
        related_trait_ids: [trait],
        bidirectional: true,
      },
      { bidirectional: true },
    ],
    [
      'at_least_one',
      { collection_id: cid, art_collection_id: art.row!.id, trait_ids: [trait, trait] },
      { trait_ids: [trait, trait] },
    ],
    [
      'tokens',
      { collection_id: cid, token_id: 2, art_collection_id: art.row!.id, dna: [trait, trait2] },
      { description: 'late' },
    ],
    ['uploads', uploadInput(cid), { file_name: 'late.png' }],
  ]
  for (const [table, insert, update] of tables) {
    await check(`lock: ${table} refuses insert, update and delete once the art is locked`, async () => {
      const ins = await A.client.from(table).insert(insert).select()
      const upd = await A.client.from(table).update(update).eq('collection_id', cid).select()
      const del = await A.client.from(table).delete().eq('collection_id', cid).select()
      return (
        expectError(ins.error as DbError, LOCKED, ins.data) ??
        expectError(upd.error as DbError, LOCKED, upd.data) ??
        expectError(del.error as DbError, LOCKED, del.data)
      )
    })
  }
  await check('lock: record_upload refuses once the art is locked', async () => {
    const { id, error } = await recordUpload(A.client, cid)
    return expectError(error, LOCKED, id ? [id] : null)
  })
  await check('lock: A still reads every art row', async () => {
    for (const table of [
      'art_collections',
      'layers',
      'traits',
      'rules',
      'at_least_one',
      'tokens',
      'uploads',
    ]) {
      const { data, error } = await A.client.from(table).select('collection_id').eq('collection_id', cid)
      if (error) return `${table}: ${describe(error)}`
      if (!data?.length) return `${table}: no rows`
    }
    return null
  })
  await check('lock: token_name cannot change after the lock; token_description still can', async () => {
    const name = await A.client.from('collections').update({ token_name: 'Late Owls' }).eq('id', cid).select()
    const desc = await A.client
      .from('collections')
      .update({ token_description: 'A late note.' })
      .eq('id', cid)
      .select()
    return expectError(name.error, CHECK, name.data) ?? (desc.error ? describe(desc.error) : null)
  })
  await check('lock: A cannot clear art_locked_at', async () => {
    const { data, error } = await A.client
      .from('collections')
      .update({ art_locked_at: null })
      .eq('id', cid)
      .select()
    return expectError(error, PERMISSION, data)
  })
}

// ---------------------------------------------------------------------------------------------
// 9e. Schema invariants and a timing check
// ---------------------------------------------------------------------------------------------
const ART_TABLES = [
  'art_collections',
  'layers',
  'traits',
  'rules',
  'at_least_one',
  'tokens',
  'uploads',
  'render_jobs',
  'render_batches',
]

async function artInvariants(A: Creator): Promise<void> {
  await check('schema: every art table has RLS, an owner policy, and no grant to anon', async () => {
    const { data, error } = await admin.rpc('art_table_facts')
    if (error) return describe(error as DbError)
    const facts = data as { table_name: string; rls: boolean; policies: number; anon_grants: number }[]
    const problems: string[] = []
    for (const table of ART_TABLES) {
      const f = facts.find((row) => row.table_name === table)
      if (!f) problems.push(`${table}: missing`)
      else if (!f.rls || f.policies < 1 || f.anon_grants > 0)
        problems.push(`${table}: rls ${f.rls}, policies ${f.policies}, anon grants ${f.anon_grants}`)
    }
    return problems.length ? problems.join('; ') : null
  })

  await check('tokens: 10,000 rows insert in one statement in under five seconds', async () => {
    const col = await insertCollection(A.client)
    if (!col.row) return `setup: ${describe(col.error)}`
    const cid = col.row.id
    const art = await insertArtCollection(A.client, cid, { size: 10_000 })
    const uploadId = await insertUploadRow(A.client, cid)
    const layer = await insertLayer(A.client, cid, art.row!.id)
    const traits: string[] = []
    for (let i = 0; i < 4; i++)
      traits.push(
        (
          await insertTrait(A.client, cid, layer.row!.id, {
            name: `T${i}`,
            upload_id: uploadId,
            position: i,
            weight: 25,
          })
        ).row!.id,
      )
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      collection_id: cid,
      token_id: i + 1,
      art_collection_id: art.row!.id,
      dna: [traits[i % 4]!],
    }))
    const started = Date.now()
    const { error } = await A.client.from('tokens').insert(rows)
    const ms = Date.now() - started
    if (error) return describe(error as DbError)
    info(`10,000 tokens inserted in ${ms} ms`)
    return ms < 5000 ? null : `took ${ms} ms`
  })
}

// ---------------------------------------------------------------------------------------------
// 9f. Art edits: the database functions behind the Art screens (docs/specs/2026-10-08-art-wiring.md)
// ---------------------------------------------------------------------------------------------
type ImportedIds = { collections: { id: string; layers: { id: string; traits: { id: string }[] }[] }[] }
type ImportPayloadInput = {
  collections: { name: string; layers: { name: string; traits: { name: string; uploadId: string }[] }[] }[]
  activeCollectionId: string | null
}

async function callArt(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args)
  return { data: data as unknown, error: error as DbError }
}

function expectSentence(error: DbError, codes: string[], sentence: string): string | null {
  const problem = expectError(error, codes)
  if (problem) return problem
  return error?.message.includes(sentence) ? null : `wrong message: ${error?.message}`
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value)
  if (error) throw new Error(`count ${table}: ${describe(error as DbError)}`)
  return count ?? 0
}

/**
 * A project imported through art_import_layers. `shape` lists trait names per layer per art
 * collection; every trait gets its own layer image row.
 */
async function importedProject(client: SupabaseClient, shape: string[][][]) {
  const col = await insertCollection(client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const payload: ImportPayloadInput = { collections: [], activeCollectionId: null }
  for (const [c, layers] of shape.entries()) {
    const collection: ImportPayloadInput['collections'][number] = { name: `Collection ${c}`, layers: [] }
    for (const [l, traits] of layers.entries()) {
      const layer: ImportPayloadInput['collections'][number]['layers'][number] = {
        name: `Layer ${c}.${l}`,
        traits: [],
      }
      for (const name of traits) layer.traits.push({ name, uploadId: await insertUploadRow(client, cid) })
      collection.layers.push(layer)
    }
    payload.collections.push(collection)
  }
  const { data, error } = await callArt(client, 'art_import_layers', {
    p_collection_id: cid,
    p_payload: payload,
  })
  if (error) throw new Error(`import: ${describe(error)}`)
  const ids = data as ImportedIds
  return {
    cid,
    art: (c = 0) => ids.collections[c]!.id,
    layer: (c: number, l: number) => ids.collections[c]!.layers[l]!.id,
    trait: (c: number, l: number, t: number) => ids.collections[c]!.layers[l]!.traits[t]!.id,
  }
}

const tokenRow = (cid: string, art: string, tokenId: number, dna: string[]) => ({
  collection_id: cid,
  token_id: tokenId,
  art_collection_id: art,
  dna,
})

async function artEdits(A: Creator, B: Creator): Promise<void> {
  // A project with Background (Ink, Dusk) under Eyes (Wide, Sleepy, Wink).
  const p = await importedProject(A.client, [
    [
      ['Ink', 'Dusk'],
      ['Wide', 'Sleepy', 'Wink'],
    ],
  ])
  const [ink, dusk] = [p.trait(0, 0, 0), p.trait(0, 0, 1)]
  const [wide, sleepy, wink] = [p.trait(0, 1, 0), p.trait(0, 1, 1), p.trait(0, 1, 2)]

  await check(
    'art_import_layers: a two-layer folder becomes one art collection, two layers, even weights',
    async () => {
      if ((await countRows('art_collections', 'collection_id', p.cid)) !== 1) return 'not one art collection'
      const { data: layers } = await admin
        .from('layers')
        .select('id, position')
        .eq('collection_id', p.cid)
        .order('position')
      if (layers?.map((layer) => layer.position).join() !== '0,1') return `layers ${JSON.stringify(layers)}`
      const { data: traits } = await admin.from('traits').select('weight').eq('layer_id', p.layer(0, 1))
      const weights = (traits ?? []).map((trait) => Number(trait.weight)).sort((a, b) => b - a)
      return weights.join() === '33.34,33.33,33.33' ? null : `eyes weights ${weights.join()}`
    },
  )

  await check('art_import_layers: a second import into the same art collection is refused', async () => {
    const uploadId = await insertUploadRow(A.client, p.cid)
    const payload: ImportPayloadInput = {
      collections: [{ name: 'Again', layers: [{ name: 'Hat', traits: [{ name: 'Cap', uploadId }] }] }],
      activeCollectionId: p.art(),
    }
    const { error } = await callArt(A.client, 'art_import_layers', {
      p_collection_id: p.cid,
      p_payload: payload,
    })
    return expectSentence(error, CHECK, 'This collection already has layers. Start over to replace them.')
  })

  await check(
    'art_delete_trait: prunes two rules and a group, drops the empty ones, closes positions',
    async () => {
      const rules = await A.client
        .from('rules')
        .insert([
          {
            collection_id: p.cid,
            kind: 'doesnt_mix_with',
            trait_id: ink,
            related_trait_ids: [wide],
            bidirectional: true,
          },
          {
            collection_id: p.cid,
            kind: 'must_pair_with',
            trait_id: dusk,
            related_trait_ids: [wide, sleepy],
            bidirectional: false,
          },
        ])
        .select('id')
      if (rules.error) return `setup: ${describe(rules.error as DbError)}`
      const group = await A.client
        .from('at_least_one')
        .insert({ collection_id: p.cid, art_collection_id: p.art(), trait_ids: [wide, wink] })
      if (group.error) return `setup: ${describe(group.error as DbError)}`
      const { error } = await callArt(A.client, 'art_delete_trait', {
        p_collection_id: p.cid,
        p_trait_id: wide,
      })
      if (error) return describe(error)
      const { data: left } = await admin
        .from('rules')
        .select('trait_id, related_trait_ids')
        .eq('collection_id', p.cid)
      if (left?.length !== 1 || left[0]!.trait_id !== dusk || left[0]!.related_trait_ids.join() !== sleepy)
        return `rules ${JSON.stringify(left)}`
      if ((await countRows('at_least_one', 'collection_id', p.cid)) !== 0)
        return 'the group of one is still there'
      const { data: eyes } = await admin
        .from('traits')
        .select('id, position')
        .eq('layer_id', p.layer(0, 1))
        .order('position')
      return eyes?.map((trait) => trait.position).join() === '0,1' && eyes[0]!.id === sleepy
        ? null
        : `positions ${JSON.stringify(eyes)}`
    },
  )

  await check('art_set_layer_weights: a constant forces the weight to 0', async () => {
    const { error } = await callArt(A.client, 'art_set_layer_weights', {
      p_collection_id: p.cid,
      p_layer_id: p.layer(0, 1),
      p_rows: [
        { traitId: sleepy, weight: 30, constant: 5 },
        { traitId: wink, weight: 70, constant: null },
      ],
    })
    if (error) return describe(error)
    const { data } = await admin.from('traits').select('weight, constant').eq('id', sleepy).single()
    return Number(data?.weight) === 0 && data?.constant === 5 ? null : `stored ${JSON.stringify(data)}`
  })

  await check(
    "art_set_layer_weights: a table missing a trait leaves it unchanged and another layer's id is ignored",
    async () => {
      const before = await admin.from('traits').select('id, weight').in('id', [wink, ink])
      const { error } = await callArt(A.client, 'art_set_layer_weights', {
        p_collection_id: p.cid,
        p_layer_id: p.layer(0, 1),
        p_rows: [
          { traitId: sleepy, weight: 30, constant: 5 },
          { traitId: ink, weight: 1, constant: null },
        ],
      })
      if (error) return describe(error)
      const after = await admin.from('traits').select('id, weight').in('id', [wink, ink])
      const same =
        JSON.stringify(before.data?.sort((x, y) => x.id.localeCompare(y.id))) ===
        JSON.stringify(after.data?.sort((x, y) => x.id.localeCompare(y.id)))
      return same && (after.data?.length ?? 0) === 2
        ? null
        : `before ${JSON.stringify(before.data)} after ${JSON.stringify(after.data)}`
    },
  )

  await check(
    'art_delete_layer: refused with the trigger sentence while tokens exist and the flag is off',
    async () => {
      const ins = await A.client
        .from('tokens')
        .insert([tokenRow(p.cid, p.art(), 1, [ink, sleepy]), tokenRow(p.cid, p.art(), 2, [dusk, wink])])
      if (ins.error) return `setup: ${describe(ins.error as DbError)}`
      const { error } = await callArt(A.client, 'art_delete_layer', {
        p_collection_id: p.cid,
        p_layer_id: p.layer(0, 0),
        p_clear_tokens: false,
      })
      return expectSentence(error, CHECK, 'Clear the tokens first.')
    },
  )

  await check(
    'art_delete_layer: with the flag the tokens go, then the layer, and positions close',
    async () => {
      const { error } = await callArt(A.client, 'art_delete_layer', {
        p_collection_id: p.cid,
        p_layer_id: p.layer(0, 0),
        p_clear_tokens: true,
      })
      if (error) return describe(error)
      if ((await countRows('tokens', 'collection_id', p.cid)) !== 0) return 'tokens left'
      const { data } = await admin.from('layers').select('id, position').eq('collection_id', p.cid)
      return data?.length === 1 && data[0]!.id === p.layer(0, 1) && data[0]!.position === 0
        ? null
        : `layers ${JSON.stringify(data)}`
    },
  )

  // Three layers, for moves.
  const m = await importedProject(A.client, [[['A1'], ['B1'], ['C1']]])
  await check('art_move_layer: moves the top layer to the bottom and renumbers the stack', async () => {
    const { error } = await callArt(A.client, 'art_move_layer', {
      p_collection_id: m.cid,
      p_layer_id: m.layer(0, 2),
      p_position: 0,
    })
    if (error) return describe(error)
    const { data } = await admin
      .from('layers')
      .select('id, position')
      .eq('collection_id', m.cid)
      .order('position')
    const order = (data ?? []).map((layer) => layer.id).join()
    return order === [m.layer(0, 2), m.layer(0, 0), m.layer(0, 1)].join()
      ? null
      : `order ${JSON.stringify(data)}`
  })
  await check('art_move_layer: refused with the trigger sentence while tokens exist', async () => {
    const ins = await A.client
      .from('tokens')
      .insert(tokenRow(m.cid, m.art(), 1, [m.trait(0, 2, 0), m.trait(0, 0, 0), m.trait(0, 1, 0)]))
    if (ins.error) return `setup: ${describe(ins.error as DbError)}`
    const { error } = await callArt(A.client, 'art_move_layer', {
      p_collection_id: m.cid,
      p_layer_id: m.layer(0, 1),
      p_position: 0,
    })
    return expectSentence(error, CHECK, 'Clear the tokens first.')
  })

  // Two art collections with one layer each, for the collection delete.
  const r = await importedProject(A.client, [[['X1', 'X2']], [['Y1', 'Y2']]])
  await check(
    'art_delete_art_collection: the rest of the tokens renumber from 1 and positions close',
    async () => {
      const ins = await A.client
        .from('tokens')
        .insert([
          tokenRow(r.cid, r.art(0), 1, [r.trait(0, 0, 0)]),
          tokenRow(r.cid, r.art(0), 2, [r.trait(0, 0, 1)]),
          tokenRow(r.cid, r.art(1), 3, [r.trait(1, 0, 0)]),
          tokenRow(r.cid, r.art(1), 4, [r.trait(1, 0, 1)]),
        ])
      if (ins.error) return `setup: ${describe(ins.error as DbError)}`
      const { error } = await callArt(A.client, 'art_delete_art_collection', {
        p_collection_id: r.cid,
        p_art_collection_id: r.art(0),
      })
      if (error) return describe(error)
      const { data: tokens } = await admin
        .from('tokens')
        .select('token_id, dna')
        .eq('collection_id', r.cid)
        .order('token_id')
      const ids = (tokens ?? []).map((token) => `${token.token_id}:${token.dna[0]}`).join()
      if (ids !== `1:${r.trait(1, 0, 0)},2:${r.trait(1, 0, 1)}`) return `tokens ${ids}`
      const { data: arts } = await admin
        .from('art_collections')
        .select('id, position')
        .eq('collection_id', r.cid)
      return arts?.length === 1 && arts[0]!.id === r.art(1) && arts[0]!.position === 0
        ? null
        : `art collections ${JSON.stringify(arts)}`
    },
  )

  // One layer of four traits, for the whole-set save.
  const s = await importedProject(A.client, [[['T0', 'T1', 'T2', 'T3']]])
  const t = [0, 1, 2, 3].map((i) => s.trait(0, 0, i))
  await check(
    'art_save_tokens then art_delete_tokens: 10,000 saved, 3 deleted, ids close up, under five seconds',
    async () => {
      const tokens = Array.from({ length: 10_000 }, (_, i) => ({
        tokenId: i + 1,
        artCollectionId: s.art(),
        dna: [t[i % 4]!],
        description: null,
      }))
      const started = Date.now()
      const saved = await callArt(A.client, 'art_save_tokens', {
        p_collection_id: s.cid,
        p_tokens: tokens,
        p_seed: 42,
      })
      if (saved.error) return describe(saved.error)
      const deleted = await callArt(A.client, 'art_delete_tokens', {
        p_collection_id: s.cid,
        p_ids: [2, 500, 9_999],
      })
      const ms = Date.now() - started
      if (deleted.error) return describe(deleted.error)
      info(`10,000 tokens saved and 3 deleted in ${ms} ms`)
      const total = await countRows('tokens', 'collection_id', s.cid)
      const { data: last } = await admin
        .from('tokens')
        .select('token_id, dna')
        .eq('collection_id', s.cid)
        .order('token_id', { ascending: false })
        .limit(1)
        .single()
      const { data: second } = await admin
        .from('tokens')
        .select('dna')
        .eq('collection_id', s.cid)
        .eq('token_id', 2)
        .single()
      const { data: seeded } = await admin
        .from('collections')
        .select('generation_seed')
        .eq('id', s.cid)
        .single()
      if (total !== 9_997 || last?.token_id !== 9_997) return `count ${total}, last id ${last?.token_id}`
      if (second?.dna[0] !== t[2]) return 'token 3 did not become token 2'
      if (last.dna[0] !== t[3]) return 'the last token did not move up by three'
      if (Number(seeded?.generation_seed) !== 42) return `seed ${seeded?.generation_seed}`
      return ms < 5000 ? null : `took ${ms} ms`
    },
  )

  await check('art_update_tokens: writes a description, and refuses a DNA that does not match', async () => {
    const good = await callArt(A.client, 'art_update_tokens', {
      p_collection_id: s.cid,
      p_rows: [{ tokenId: 1, description: 'First light' }],
    })
    if (good.error) return describe(good.error)
    const { data } = await admin
      .from('tokens')
      .select('description')
      .eq('collection_id', s.cid)
      .eq('token_id', 1)
      .single()
    if (data?.description !== 'First light') return `description ${data?.description}`
    const bad = await callArt(A.client, 'art_update_tokens', {
      p_collection_id: s.cid,
      p_rows: [{ tokenId: 1, dna: [t[0], t[1]] }],
    })
    return expectSentence(bad.error, CHECK, 'Token DNA does not match the layers.')
  })

  await check(
    'art_update_tokens and art_delete_tokens: refuse an id that is not there and change nothing',
    async () => {
      const before = await countRows('tokens', 'collection_id', s.cid)
      const update = await callArt(A.client, 'art_update_tokens', {
        p_collection_id: s.cid,
        p_rows: [
          { tokenId: 1, description: 'Rolled back' },
          { tokenId: 99_999, description: 'Nowhere' },
        ],
      })
      const problemUpdate = expectSentence(
        update.error,
        CHECK,
        'Some tokens were changed elsewhere. Reload the page.',
      )
      if (problemUpdate) return `update: ${problemUpdate}`
      const { data } = await admin
        .from('tokens')
        .select('description')
        .eq('collection_id', s.cid)
        .eq('token_id', 1)
        .single()
      if (data?.description !== 'First light') return `description ${data?.description}`
      const removal = await callArt(A.client, 'art_delete_tokens', {
        p_collection_id: s.cid,
        p_ids: [1, 99_999],
      })
      const problemDelete = expectSentence(
        removal.error,
        CHECK,
        'Some tokens were changed elsewhere. Reload the page.',
      )
      if (problemDelete) return `delete: ${problemDelete}`
      const after = await countRows('tokens', 'collection_id', s.cid)
      return after === before ? null : `count ${before} became ${after}`
    },
  )

  await check('art_save_tokens: an empty or missing set is refused and the stored set stays', async () => {
    const before = await countRows('tokens', 'collection_id', s.cid)
    for (const tokens of [[], null]) {
      const { error } = await callArt(A.client, 'art_save_tokens', {
        p_collection_id: s.cid,
        p_tokens: tokens,
        p_seed: 1,
      })
      const problem = expectSentence(error, CHECK, 'The set is empty.')
      if (problem) return `${JSON.stringify(tokens)}: ${problem}`
    }
    const after = await countRows('tokens', 'collection_id', s.cid)
    return after === before ? null : `count ${before} became ${after}`
  })

  await check('timings at a realistic shape: 10 layers of 3 traits, 10,000 tokens (INFO only)', async () => {
    const wide = await importedProject(A.client, [
      [...Array.from({ length: 10 }, (): string[] => ['a', 'b', 'c'])],
    ])
    const tokens = Array.from({ length: 10_000 }, (_, i) => ({
      tokenId: i + 1,
      artCollectionId: wide.art(),
      dna: Array.from({ length: 10 }, (_, l) => wide.trait(0, l, (i + l) % 3)),
      description: null,
    }))
    const saveStarted = Date.now()
    const saved = await callArt(A.client, 'art_save_tokens', {
      p_collection_id: wide.cid,
      p_tokens: tokens,
      p_seed: 9,
    })
    const saveMs = Date.now() - saveStarted
    if (saved.error) return describe(saved.error)
    const deleteStarted = Date.now()
    const removed = await callArt(A.client, 'art_delete_tokens', {
      p_collection_id: wide.cid,
      p_ids: [1],
    })
    const deleteMs = Date.now() - deleteStarted
    if (removed.error) return describe(removed.error)
    info(`art_save_tokens, 10 layers x 3 traits, 10,000 tokens: ${saveMs} ms`)
    info(`art_delete_tokens, token 1 of 10,000 (renumbers 9,999): ${deleteMs} ms`)
    return (await countRows('tokens', 'collection_id', wide.cid)) === 9_999 ? null : 'wrong count'
  })

  await check("art_set_asset_order: writes the positions of the project's assets", async () => {
    const col = await insertCollection(A.client, { project_type: 'one_of_one' })
    if (!col.row) return `setup: ${describe(col.error)}`
    const cid = col.row.id
    const asset = async () => {
      const hash = HEX64(++nameCount)
      const { id, error } = await recordUpload(A.client, cid, {
        kind: 'asset',
        storage_key: `${cid}/assets/${hash}.png`,
        content_hash: hash,
        width: 800,
        height: 600,
      })
      if (error || !id) throw new Error(`asset setup: ${describe(error)}`)
      return id
    }
    const [first, second] = [await asset(), await asset()]
    const { error } = await callArt(A.client, 'art_set_asset_order', {
      p_collection_id: cid,
      p_rows: [
        { uploadId: second, position: 0 },
        { uploadId: first, position: 1 },
      ],
    })
    if (error) return describe(error)
    const { data } = await admin.from('uploads').select('id').eq('collection_id', cid).order('position')
    return (data ?? []).map((row) => row.id).join() === [second, first].join()
      ? null
      : `order ${JSON.stringify(data)}`
  })

  await check(
    'art_start_over: no art rows, no layer uploads, canvas and seed cleared, keys returned',
    async () => {
      const z = await importedProject(A.client, [[['Z1', 'Z2']]])
      const saved = await callArt(A.client, 'art_save_tokens', {
        p_collection_id: z.cid,
        p_tokens: [{ tokenId: 1, artCollectionId: z.art(), dna: [z.trait(0, 0, 0)], description: null }],
        p_seed: 7,
      })
      if (saved.error) return `setup: ${describe(saved.error)}`
      const { data, error } = await callArt(A.client, 'art_start_over', { p_collection_id: z.cid })
      if (error) return describe(error)
      const keys = data as string[]
      for (const table of ['art_collections', 'layers', 'traits', 'rules', 'at_least_one', 'tokens'])
        if ((await countRows(table, 'collection_id', z.cid)) !== 0) return `${table} left`
      const { data: images } = await admin
        .from('uploads')
        .select('id')
        .eq('collection_id', z.cid)
        .eq('kind', 'layer_image')
      if (images?.length) return `${images.length} layer images left`
      const { data: row } = await admin
        .from('collections')
        .select('canvas_width, canvas_height, generation_seed')
        .eq('id', z.cid)
        .single()
      if (row?.canvas_width !== null || row?.canvas_height !== null || row?.generation_seed !== null)
        return `collection ${JSON.stringify(row)}`
      return keys.length === 2 && keys.every((key) => key.startsWith(`${z.cid}/layers/`))
        ? null
        : `keys ${JSON.stringify(keys)}`
    },
  )

  // Every function, refused for another creator and after the lock.
  const w = await importedProject(A.client, [[['W1', 'W2']]])
  const everyFunction: [string, Record<string, unknown>][] = [
    [
      'art_import_layers',
      { p_collection_id: w.cid, p_payload: { collections: [], activeCollectionId: null } },
    ],
    ['art_move_layer', { p_collection_id: w.cid, p_layer_id: w.layer(0, 0), p_position: 0 }],
    ['art_delete_layer', { p_collection_id: w.cid, p_layer_id: w.layer(0, 0), p_clear_tokens: true }],
    ['art_delete_trait', { p_collection_id: w.cid, p_trait_id: w.trait(0, 0, 0) }],
    ['art_delete_art_collection', { p_collection_id: w.cid, p_art_collection_id: w.art() }],
    ['art_set_layer_weights', { p_collection_id: w.cid, p_layer_id: w.layer(0, 0), p_rows: [] }],
    ['art_save_tokens', { p_collection_id: w.cid, p_tokens: [], p_seed: 1 }],
    ['art_update_tokens', { p_collection_id: w.cid, p_rows: [] }],
    ['art_delete_tokens', { p_collection_id: w.cid, p_ids: [1] }],
    ['art_set_asset_order', { p_collection_id: w.cid, p_rows: [] }],
    ['art_start_over', { p_collection_id: w.cid }],
  ]
  await check(
    "art functions: B calling any of them on A's collection is refused and nothing changes",
    async () => {
      const problems: string[] = []
      for (const [fn, args] of everyFunction) {
        const { error } = await callArt(B.client, fn, args)
        const problem = expectSentence(error, PERMISSION, 'collection not found')
        if (problem) problems.push(`${fn}: ${problem}`)
      }
      if ((await countRows('traits', 'collection_id', w.cid)) !== 2) problems.push('traits changed')
      if ((await countRows('layers', 'collection_id', w.cid)) !== 1) problems.push('layers changed')
      return problems.length ? problems.join('; ') : null
    },
  )
  await check('art functions: every one is refused after the lock', async () => {
    const lock = await admin
      .from('collections')
      .update({ art_locked_at: new Date().toISOString() })
      .eq('id', w.cid)
    if (lock.error) return `setup: ${describe(lock.error as DbError)}`
    const problems: string[] = []
    for (const [fn, args] of everyFunction) {
      const { error } = await callArt(A.client, fn, args)
      const problem = expectSentence(error, PERMISSION, 'The art is locked and cannot change.')
      if (problem) problems.push(`${fn}: ${problem}`)
    }
    return problems.length ? problems.join('; ') : null
  })
}

// ---------------------------------------------------------------------------------------------
// 9g. Lock and pay: the definer functions behind Lock and upload (docs/specs/2026-10-09-lock-and-pay.md)
// ---------------------------------------------------------------------------------------------
const FEE = '25000000000000'
const txHash = (n: number) => `0x${HEX64(9_000_000 + n)}`

type JobCheckRow = {
  id: string
  quote_factory: string | null
  error: string | null
  finished_at: string | null
  kind: string
  state: string
  onchain_job_id: string
  token_count: number
  fee_per_token_wei: string
  quote_total_wei: string
  quote_payer: string | null
  quote_expires_at: string | null
  batches_total: number
  token_list: unknown
  payment_tx_hash: string | null
  paid_amount_wei: string | null
}

async function jobFor(id: string): Promise<JobCheckRow | null> {
  const { data } = await admin
    .from('render_jobs')
    .select(
      'id, kind, state, quote_factory, error, finished_at, onchain_job_id, token_count, fee_per_token_wei::text, quote_total_wei::text, quote_payer, quote_expires_at, batches_total, token_list, payment_tx_hash, paid_amount_wei::text',
    )
    .eq('id', id)
    .maybeSingle()
  return data as JobCheckRow | null
}

type LockState = { art_locked_at: string | null; status: string; max_supply: number | null }

async function lockState(cid: string): Promise<LockState> {
  const { data, error } = await admin
    .from('collections')
    .select('art_locked_at, status, max_supply')
    .eq('id', cid)
    .single()
  if (error) throw new Error(`lock state: ${describe(error as DbError)}`)
  return data as LockState
}

/** A generative project with one art collection of two tokens, ready to lock. */
async function lockableProject(client: SupabaseClient) {
  const col = await insertCollection(client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const art = (await insertArtCollection(client, cid, { size: 2 })).row!.id
  const uploadId = await insertUploadRow(client, cid)
  const layer = (await insertLayer(client, cid, art)).row!.id
  const wide = (await insertTrait(client, cid, layer, { name: 'Wide', upload_id: uploadId })).row!.id
  const sleepy = (await insertTrait(client, cid, layer, { name: 'Sleepy', upload_id: uploadId })).row!.id
  const list = [
    { id: 1, collectionId: art, dna: [wide] },
    { id: 2, collectionId: art, dna: [sleepy] },
  ]
  const { error } = await client.from('tokens').insert(list.map((t) => tokenRow(cid, art, t.id, t.dna)))
  if (error) throw new Error(`setup: ${describe(error as DbError)}`)
  return { cid, art, wide, sleepy, uploadId, list }
}

// art_lock, art_requote and art_record_payment are service-role only: the checks call them with the
// admin client and the owner's id, as the server actions do with the service client.
const FACTORY_ADDRESS = '0x5fbdb2315678afecb367f032d93f642f64180aa3'
const lockArgs = (
  owner: string,
  cid: string,
  list: unknown,
  payer: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_collection_id: cid,
  p_owner: owner,
  p_kind: 'generative',
  p_token_list: list,
  p_token_list_hash: `0x${HEX64(42)}`,
  p_allow_duplicates: false,
  p_fee_per_token_wei: FEE,
  p_chain_id: 31337,
  p_payer: payer,
  p_factory: FACTORY_ADDRESS,
  ...overrides,
})

const payArgs = (owner: string, cid: string, jobId: string, hash: string, payer: string, amount: string) => ({
  p_collection_id: cid,
  p_owner: owner,
  p_job_id: jobId,
  p_tx_hash: hash,
  p_payer: payer,
  p_amount_wei: amount,
})

const idOf = (data: unknown) => {
  const id = (data as { id?: string } | null)?.id ?? ''
  if (id) createdJobIds.add(id)
  return id
}

async function backdateQuote(jobId: string, minutesAgo: number): Promise<string | null> {
  const { error } = await admin
    .from('render_jobs')
    .update({ quote_expires_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() })
    .eq('id', jobId)
  return error ? `setup: ${describe(error as DbError)}` : null
}

async function artLockAndPay(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  const g = await lockableProject(A.client)
  let job1 = ''

  await check(
    'art_lock: a list that differs from the stored tokens is refused and nothing locks',
    async () => {
      const changed = [g.list[0]!, { ...g.list[1]!, dna: [g.wide] }]
      const { error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, changed, payer))
      const problem = expectSentence(error, CHECK, 'The art changed while locking. Review it again.')
      if (problem) return problem
      const state = await lockState(g.cid)
      return state.art_locked_at === null && state.status === 'draft' ? null : JSON.stringify(state)
    },
  )

  await check('art_lock: a list with one token fewer than stored is refused', async () => {
    const { error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, [g.list[0]], payer))
    return expectSentence(error, CHECK, 'The art changed while locking. Review it again.')
  })

  await check('art_lock: a list with one token more than stored is refused', async () => {
    const extra = [...g.list, { id: 3, collectionId: g.art, dna: [g.wide] }]
    const { error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, extra, payer))
    return expectSentence(error, CHECK, 'The art changed while locking. Review it again.')
  })

  await check('art_lock: a zero fee on a generative project is refused', async () => {
    const { error } = await callArt(
      admin,
      'art_lock',
      lockArgs(A.userId, g.cid, g.list, payer, { p_fee_per_token_wei: '0' }),
    )
    const problem = expectSentence(error, CHECK, 'This chain is not ready for payments yet.')
    if (problem) return problem
    return (await lockState(g.cid)).art_locked_at === null ? null : 'the art locked'
  })

  await check('art_lock: a quote for another wallet than the sign-in wallet is refused', async () => {
    const other = B.account.address.toLowerCase()
    const { error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, g.list, other))
    return expectSentence(error, CHECK, 'The quote must be issued to your sign-in wallet.')
  })

  await check(
    'art_lock: the matching list locks the art, quotes fee x count for 24 hours and derives the on-chain id',
    async () => {
      const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, g.list, payer))
      if (error) return describe(error)
      job1 = idOf(data)
      const job = await jobFor(job1)
      const state = await lockState(g.cid)
      if (!job) return 'no job row'
      const hours = (Date.parse(job.quote_expires_at ?? '') - Date.now()) / 3_600_000
      const problems = [
        job.state === 'payment_due' ? null : `state ${job.state}`,
        job.kind === 'real' ? null : `kind ${job.kind}`,
        job.onchain_job_id === onchainJobId(job.id) ? null : `onchain id ${job.onchain_job_id}`,
        job.token_count === 2 ? null : `token_count ${job.token_count}`,
        job.fee_per_token_wei === FEE ? null : `fee ${job.fee_per_token_wei}`,
        job.quote_total_wei === '50000000000000' ? null : `total ${job.quote_total_wei}`,
        job.quote_payer === payer ? null : `payer ${job.quote_payer}`,
        job.quote_factory === FACTORY_ADDRESS ? null : `factory ${job.quote_factory}`,
        hours > 23.9 && hours < 24.1 ? null : `expires in ${hours} hours`,
        job.batches_total === 1 ? null : `batches ${job.batches_total}`,
        job.token_list === null ? null : 'a generative job stored a token list',
        state.art_locked_at !== null && state.status === 'art_locked' && state.max_supply === 2
          ? null
          : JSON.stringify(state),
      ].filter(Boolean)
      return problems.length ? problems.join('; ') : null
    },
  )

  await check('art_lock: locking twice is refused', async () => {
    const { error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, g.list, payer))
    return expectSentence(error, CHECK, 'The art is already locked.')
  })

  await check('art_unlock: while payment is due, the job is cancelled and the art opens again', async () => {
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: g.cid })
    if (error) return describe(error)
    const state = await lockState(g.cid)
    if (state.art_locked_at !== null || state.status !== 'draft') return JSON.stringify(state)
    if (state.max_supply !== null) return `max_supply ${state.max_supply} after unlock`
    // The job is kept, cancelled: a payment mined and never recorded can still be matched to its id.
    const cancelled = await jobFor(job1)
    if (!cancelled) return 'the job row is gone'
    if (cancelled.state !== 'failed' || cancelled.error !== 'unlocked' || cancelled.finished_at === null)
      return JSON.stringify(cancelled)
    // The lock gate is open again: the creator can edit a token.
    const edit = await A.client
      .from('tokens')
      .update({ description: 'Edited after unlock.' })
      .eq('collection_id', g.cid)
      .eq('token_id', 1)
      .select('token_id')
    return edit.error ? `token edit refused: ${describe(edit.error as DbError)}` : null
  })

  await check('art_unlock: with nothing locked is refused', async () => {
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: g.cid })
    return expectSentence(error, CHECK, 'The art is not locked.')
  })

  await check('art_record_payment: the right payer and amount mark the job paid', async () => {
    const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, g.cid, g.list, payer))
    if (error) return `relock: ${describe(error)}`
    job1 = idOf(data)
    const paid = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, g.cid, job1, txHash(1), payer, '50000000000000'),
    )
    if (paid.error) return describe(paid.error)
    const job = await jobFor(job1)
    return job?.state === 'paid' &&
      job.payment_tx_hash === txHash(1) &&
      job.paid_amount_wei === '50000000000000'
      ? null
      : JSON.stringify(job)
  })

  await check('art_record_payment: the same hash again on the paid job answers "already used"', async () => {
    const again = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, g.cid, job1, txHash(1), payer, '50000000000000'),
    )
    return expectSentence(again.error, UNIQUE, 'This payment was already used.')
  })

  await check('art_unlock: after payment is refused and the art stays locked', async () => {
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: g.cid })
    const problem = expectSentence(error, CHECK, 'The art is paid for and stays locked.')
    if (problem) return problem
    return (await lockState(g.cid)).art_locked_at !== null ? null : 'the lock was cleared'
  })

  // The supply: a stored supply that differs from the token count refuses the lock; an unlock clears
  // a generative supply, so a relock after a different count succeeds.
  const k = await lockableProject(A.client)
  await check('art_lock: a stored supply that differs from the token count is refused', async () => {
    const set = await admin.from('collections').update({ max_supply: 5 }).eq('id', k.cid)
    if (set.error) return `setup: ${describe(set.error as DbError)}`
    const { error } = await callArt(admin, 'art_lock', lockArgs(A.userId, k.cid, k.list, payer))
    const problem = expectSentence(error, CHECK, 'The supply does not match the tokens. Generate again.')
    if (problem) return problem
    return (await lockState(k.cid)).art_locked_at === null ? null : 'the art locked'
  })
  await check(
    'art_unlock: clears a generative supply, and a relock after a different count works',
    async () => {
      const clear = await admin.from('collections').update({ max_supply: null }).eq('id', k.cid)
      if (clear.error) return `setup: ${describe(clear.error as DbError)}`
      const first = await callArt(admin, 'art_lock', lockArgs(A.userId, k.cid, k.list, payer))
      if (first.error) return `lock: ${describe(first.error)}`
      idOf(first.data)
      const unlock = await callArt(A.client, 'art_unlock', { p_collection_id: k.cid })
      if (unlock.error) return `unlock: ${describe(unlock.error)}`
      const state = await lockState(k.cid)
      if (state.max_supply !== null || state.status !== 'draft') return JSON.stringify(state)
      const drop = await admin.from('tokens').delete().eq('collection_id', k.cid).eq('token_id', 2)
      if (drop.error) return `setup: ${describe(drop.error as DbError)}`
      const again = await callArt(admin, 'art_lock', lockArgs(A.userId, k.cid, [k.list[0]], payer))
      if (again.error) return `relock: ${describe(again.error)}`
      idOf(again.data)
      const after = await lockState(k.cid)
      return after.max_supply === 1 && after.status === 'art_locked' ? null : JSON.stringify(after)
    },
  )

  // A second project for the refusals, the requote and the grace hour.
  const h = await lockableProject(A.client)
  let job2 = ''
  await check('art_record_payment: another payer and a reused hash are refused', async () => {
    const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, h.cid, h.list, payer))
    if (error) return `lock: ${describe(error)}`
    job2 = idOf(data)
    const other = B.account.address.toLowerCase()
    const wrongPayer = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, h.cid, job2, txHash(2), other, '50000000000000'),
    )
    const reused = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, h.cid, job2, txHash(1), payer, '50000000000000'),
    )
    const problem =
      expectSentence(wrongPayer.error, CHECK, 'The payment came from a different wallet than the quote.') ??
      expectSentence(reused.error, UNIQUE, 'This payment was already used.')
    if (problem) return problem
    return (await jobFor(job2))?.state === 'payment_due' ? null : 'the job changed'
  })

  await check('art_requote: refused while the quote is still valid', async () => {
    const { error } = await callArt(admin, 'art_requote', {
      p_collection_id: h.cid,
      p_owner: A.userId,
      p_fee_per_token_wei: '30000000000000',
    })
    return expectSentence(error, CHECK, 'The quote has not expired yet.')
  })

  await check('art_requote: an expired quote takes the new rate and runs 24 hours again', async () => {
    const setup = await backdateQuote(job2, 61)
    if (setup) return setup
    const { error } = await callArt(admin, 'art_requote', {
      p_collection_id: h.cid,
      p_owner: A.userId,
      p_fee_per_token_wei: '30000000000000',
    })
    if (error) return describe(error)
    const job = await jobFor(job2)
    const hours = (Date.parse(job?.quote_expires_at ?? '') - Date.now()) / 3_600_000
    return job?.state === 'payment_due' &&
      job.fee_per_token_wei === '30000000000000' &&
      job.quote_total_wei === '60000000000000' &&
      hours > 23.9
      ? null
      : JSON.stringify(job)
  })

  await check('art_record_payment: an expired quote still records a mined payment', async () => {
    const setup = await backdateQuote(job2, 600)
    if (setup) return setup
    const { error } = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, h.cid, job2, txHash(5), payer, '60000000000000'),
    )
    if (error) return describe(error)
    const job = await jobFor(job2)
    return job?.state === 'paid' && job.payment_tx_hash === txHash(5) ? null : JSON.stringify(job)
  })

  // A short payment is recorded, not refused: the job stays payment_due with the hash and amount kept.
  const i = await lockableProject(A.client)
  let job3 = ''
  await check('art_record_payment: a short amount is stored and the job stays payment_due', async () => {
    const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, i.cid, i.list, payer))
    if (error) return `lock: ${describe(error)}`
    job3 = idOf(data)
    const { error: payError } = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, i.cid, job3, txHash(3), payer, '49999999999999'),
    )
    if (payError) return describe(payError)
    const job = await jobFor(job3)
    return job?.state === 'payment_due' &&
      job.payment_tx_hash === txHash(3) &&
      job.paid_amount_wei === '49999999999999'
      ? null
      : JSON.stringify(job)
  })

  await check(
    'a recorded payment protects the job: unlock, requote and a second record are refused',
    async () => {
      const unlock = await callArt(A.client, 'art_unlock', { p_collection_id: i.cid })
      const requote = await callArt(admin, 'art_requote', {
        p_collection_id: i.cid,
        p_owner: A.userId,
        p_fee_per_token_wei: '30000000000000',
      })
      const second = await callArt(
        admin,
        'art_record_payment',
        payArgs(A.userId, i.cid, job3, txHash(7), payer, '50000000000000'),
      )
      const problem =
        expectSentence(unlock.error, CHECK, 'A payment is recorded on this lock, so it stays.') ??
        expectSentence(requote.error, CHECK, 'A payment is already recorded, so the quote cannot change.') ??
        expectSentence(second.error, CHECK, 'A payment is already recorded for this job.')
      if (problem) return problem
      const job = await jobFor(job3)
      return job?.state === 'payment_due' &&
        job.payment_tx_hash === txHash(3) &&
        job.paid_amount_wei === '49999999999999' &&
        (await lockState(i.cid)).art_locked_at !== null
        ? null
        : JSON.stringify(job)
    },
  )

  // Deferred art: the placeholder alone, at no cost, without locking the art.
  const d = (await insertCollection(A.client)).row!.id
  const deferred = await A.client.from('collections').update({ art_deferred: true }).eq('id', d)
  if (deferred.error) throw new Error(`setup: ${describe(deferred.error as DbError)}`)
  const layerImage = await insertUploadRow(A.client, d)
  const placeholder = await recordUpload(A.client, d, { kind: 'placeholder' })
  if (!placeholder.id) throw new Error(`setup: ${describe(placeholder.error)}`)

  await check('art_lock_placeholder: refused on a collection that does not defer its art', async () => {
    const { error } = await callArt(A.client, 'art_lock_placeholder', {
      p_collection_id: h.cid,
      p_placeholder_upload_id: h.uploadId,
    })
    return expectSentence(
      error,
      CHECK,
      'Only a collection that finishes its art later locks a placeholder alone.',
    )
  })

  await check('art_lock_placeholder: refused for an upload that is not a placeholder', async () => {
    const { error } = await callArt(A.client, 'art_lock_placeholder', {
      p_collection_id: d,
      p_placeholder_upload_id: layerImage,
    })
    return expectSentence(error, CHECK, 'Choose a placeholder file first.')
  })

  await check('art_lock_placeholder: a placeholder file of another collection is refused', async () => {
    const other = (await insertCollection(A.client)).row!.id
    const foreign = await recordUpload(A.client, other, { kind: 'placeholder' })
    if (!foreign.id) return `setup: ${describe(foreign.error)}`
    const { error } = await callArt(A.client, 'art_lock_placeholder', {
      p_collection_id: d,
      p_placeholder_upload_id: foreign.id,
    })
    return expectSentence(error, CHECK, 'Choose a placeholder file first.')
  })

  await check('art_lock_placeholder: a paid job of one token at no cost, the art left open', async () => {
    const { data, error } = await callArt(A.client, 'art_lock_placeholder', {
      p_collection_id: d,
      p_placeholder_upload_id: placeholder.id,
    })
    if (error) return describe(error)
    const job = await jobFor(idOf(data))
    const state = await lockState(d)
    return job?.kind === 'placeholder' &&
      job.state === 'paid' &&
      job.token_count === 1 &&
      job.quote_total_wei === '0' &&
      state.art_locked_at === null &&
      state.status === 'draft'
      ? null
      : `${JSON.stringify(job)} ${JSON.stringify(state)}`
  })

  await check('art_lock_placeholder: twice is refused', async () => {
    const { error } = await callArt(A.client, 'art_lock_placeholder', {
      p_collection_id: d,
      p_placeholder_upload_id: placeholder.id,
    })
    return expectSentence(error, CHECK, 'The placeholder is already locked.')
  })

  // A single asset: one file, three tokens, no fee.
  const s = (await insertCollection(A.client, { project_type: 'single_asset', max_supply: 3 })).row!.id
  const asset = await recordUpload(A.client, s, { kind: 'asset' })
  if (!asset.id) throw new Error(`setup: ${describe(asset.error)}`)
  const quantity = await A.client.from('uploads').update({ quantity: 3 }).eq('id', asset.id)
  if (quantity.error) throw new Error(`setup: ${describe(quantity.error as DbError)}`)
  const assetList = [1, 2, 3].map((id) => ({ id, uploadId: asset.id, attributes: [] }))

  await check('art_lock: a changed asset attribute is refused', async () => {
    const changed = assetList.map((t) => ({ ...t, attributes: [{ trait_type: 'Mood', value: 'Calm' }] }))
    const { error } = await callArt(
      admin,
      'art_lock',
      lockArgs(A.userId, s, changed, payer, { p_kind: 'single_asset', p_fee_per_token_wei: '0' }),
    )
    return expectSentence(error, CHECK, 'The art changed while locking. Review it again.')
  })

  await check(
    'art_lock: a single asset locks at no cost, goes straight to paid and stores its list',
    async () => {
      const { data, error } = await callArt(
        admin,
        'art_lock',
        lockArgs(A.userId, s, assetList, payer, { p_kind: 'single_asset', p_fee_per_token_wei: '0' }),
      )
      if (error) return describe(error)
      const job = await jobFor(idOf(data))
      const state = await lockState(s)
      return job?.state === 'paid' &&
        job.quote_total_wei === '0' &&
        job.fee_per_token_wei === '0' &&
        state.status === 'art_locked' &&
        state.max_supply === 3 &&
        Array.isArray(job.token_list) &&
        job.token_list.length === 3
        ? null
        : JSON.stringify(job)
    },
  )

  // Nobody else, and nobody signed out, can run any of them; the creator's own session cannot run the
  // three service functions at all.
  const serviceCalls = (owner: string): [string, Record<string, unknown>][] => [
    ['art_lock', lockArgs(owner, h.cid, h.list, payer)],
    ['art_requote', { p_collection_id: h.cid, p_owner: owner, p_fee_per_token_wei: FEE }],
    ['art_record_payment', payArgs(owner, h.cid, job2, txHash(6), payer, '1')],
  ]
  const sessionCalls: [string, Record<string, unknown>][] = [
    ['art_unlock', { p_collection_id: h.cid }],
    ['art_lock_placeholder', { p_collection_id: d, p_placeholder_upload_id: placeholder.id }],
  ]
  await check(
    "lock functions: B's session calling unlock or the placeholder lock on A's collections is refused",
    async () => {
      const problems: string[] = []
      for (const [fn, args] of sessionCalls) {
        const { error } = await callArt(B.client, fn, args)
        const problem = expectSentence(error, PERMISSION, 'collection not found')
        if (problem) problems.push(`${fn}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )
  await check(
    "lock functions: the service functions with B's owner id on A's collections are refused",
    async () => {
      const problems: string[] = []
      for (const [fn, args] of serviceCalls(B.userId)) {
        const { error } = await callArt(admin, fn, args)
        const problem = expectSentence(error, PERMISSION, 'collection not found')
        if (problem) problems.push(`${fn}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )
  await check(
    "lock functions: the owner's own session cannot execute the three service functions",
    async () => {
      const problems: string[] = []
      for (const [fn, args] of serviceCalls(A.userId)) {
        const { error } = await callArt(A.client, fn, args)
        const problem = expectSentence(error, PERMISSION, 'permission denied')
        if (problem) problems.push(`${fn}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )
  await check('lock functions: a signed-out caller cannot execute any of them', async () => {
    const problems: string[] = []
    for (const [fn, args] of [...serviceCalls(A.userId), ...sessionCalls]) {
      const { error } = await callArt(anon, fn, args)
      const problem = expectError(error, PERMISSION)
      if (problem) problems.push(`${fn}: ${problem}`)
    }
    return problems.length ? problems.join('; ') : null
  })

  // Every job of these collections goes in cleanup, before the collections it restricts.
  const { data: jobs } = await admin
    .from('render_jobs')
    .select('id')
    .in('collection_id', [g.cid, h.cid, i.cid, k.cid, d, s])
  for (const job of (jobs ?? []) as { id: string }[]) createdJobIds.add(job.id)
}

// ---------------------------------------------------------------------------------------------
// 9h. Render job state: the functions the render worker and the retry call
// (docs/specs/2026-10-12-render-job-state.md)
// ---------------------------------------------------------------------------------------------

/** A CIDv1 in base32, as the worker reports them: 59 characters of a to z and 2 to 7. */
const CID = (letter: string) => `bafybei${letter.repeat(52)}`
const NO_JOB = '00000000-0000-0000-0000-000000000000'

/** A generative project of three tokens, locked, and paid for unless `pay` is false. */
async function renderFixture(A: Creator, payer: string, tag: number, pay = true) {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const art = (await insertArtCollection(A.client, cid, { size: 3 })).row!.id
  const uploadId = await insertUploadRow(A.client, cid)
  const layer = (await insertLayer(A.client, cid, art)).row!.id
  const traits: string[] = []
  for (const name of ['Wide', 'Sleepy', 'Wink'])
    traits.push((await insertTrait(A.client, cid, layer, { name, upload_id: uploadId })).row!.id)
  const list = traits.map((trait, i) => ({ id: i + 1, collectionId: art, dna: [trait] }))
  const tokens = await A.client.from('tokens').insert(list.map((t) => tokenRow(cid, art, t.id, t.dna)))
  if (tokens.error) throw new Error(`setup: ${describe(tokens.error as DbError)}`)
  const lock = await callArt(admin, 'art_lock', lockArgs(A.userId, cid, list, payer))
  if (lock.error) throw new Error(`setup: lock: ${describe(lock.error)}`)
  const jobId = idOf(lock.data)
  if (pay) {
    const paid = await callArt(
      admin,
      'art_record_payment',
      payArgs(A.userId, cid, jobId, txHash(tag), payer, '75000000000000'),
    )
    if (paid.error) throw new Error(`setup: pay: ${describe(paid.error)}`)
  }
  return { cid, jobId, list }
}

type RenderJobCheck = {
  state: string
  batches_done: number
  started_at: string | null
  finished_at: string | null
  metadata_cid: string | null
  base_uri: string | null
  placeholder_image_cid: string | null
  collage_key: string | null
  error: string | null
  error_code: string | null
  retries: number
}

async function renderJob(id: string): Promise<RenderJobCheck> {
  const { data, error } = await admin
    .from('render_jobs')
    .select(
      'state, batches_done, started_at, finished_at, metadata_cid, base_uri, placeholder_image_cid, collage_key, error, error_code, retries',
    )
    .eq('id', id)
    .single()
  if (error) throw new Error(`render job: ${describe(error as DbError)}`)
  return data as RenderJobCheck
}

type BatchCheck = {
  index: number
  state: string
  attempts: number
  first_token_id: number
  last_token_id: number
  images_cid: string | null
  images_size: number | null
  error_code: string | null
  started_at: string | null
  finished_at: string | null
}

async function batchesOf(jobId: string): Promise<BatchCheck[]> {
  const { data, error } = await admin
    .from('render_batches')
    .select(
      'index, state, attempts, first_token_id, last_token_id, images_cid, images_size, error_code, started_at, finished_at',
    )
    .eq('job_id', jobId)
    .order('index')
  if (error) throw new Error(`render batches: ${describe(error as DbError)}`)
  return data as BatchCheck[]
}

type DoneResult = { batches_done: number; last: boolean }
/** art_batch_done returns a table: PostgREST answers an array of one row. */
const doneOf = (data: unknown) => (data as DoneResult[] | null)?.[0]

/** Runs service calls in order against one collection, reading its status after each one. */
async function runSteps(
  steps: [string, Record<string, unknown>][],
  statusOf: () => Promise<string>,
): Promise<{ seen: string[]; failed: string | null }> {
  const seen: string[] = []
  for (const [fn, args] of steps) {
    const { error } = await callArt(admin, fn, args)
    if (error) return { seen, failed: `${fn}: ${describe(error)}` }
    seen.push(await statusOf())
  }
  return { seen, failed: null }
}

/**
 * Locks a 1/1 project of `files` asset uploads through art_lock, as the server action does, after
 * setting the `bytes` of the first upload to `biggest` (a number of bytes, set through the service
 * client: no real file is stored). Returns the new job's batch columns.
 */
async function lockedOneOfOne(A: Creator, files: number, biggest: number | null) {
  const col = await insertCollection(A.client, { project_type: 'one_of_one' })
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  for (let n = 0; n < files; n++) {
    const hash = HEX64(++nameCount)
    const { id, error } = await recordUpload(A.client, cid, {
      kind: 'asset',
      storage_key: `${cid}/assets/${hash}.png`,
      content_hash: hash,
      width: 800,
      height: 600,
    })
    if (error || !id) throw new Error(`setup: asset: ${describe(error)}`)
  }
  const rows = await admin
    .from('uploads')
    .select('id')
    .eq('collection_id', cid)
    .order('created_at')
    .order('id')
  if (rows.error || !rows.data) throw new Error(`setup: uploads: ${describe(rows.error as DbError)}`)
  if (biggest !== null) {
    const sized = await admin.from('uploads').update({ bytes: biggest }).eq('id', rows.data[0]!.id)
    if (sized.error) throw new Error(`setup: bytes: ${describe(sized.error as DbError)}`)
  }
  const list = rows.data.map((row, i) => ({ id: i + 1, uploadId: row.id, attributes: [] }))
  const lock = await callArt(
    admin,
    'art_lock',
    lockArgs(A.userId, cid, list, A.account.address.toLowerCase(), { p_kind: 'one_of_one' }),
  )
  if (lock.error) throw new Error(`setup: lock: ${describe(lock.error)}`)
  const job = await admin
    .from('render_jobs')
    .select('token_count, batch_size, batches_total')
    .eq('id', idOf(lock.data))
    .single()
  if (job.error) throw new Error(`setup: job: ${describe(job.error as DbError)}`)
  return job.data
}

async function artRenderState(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // One batch (batch size 100, three tokens).
  const one = await renderFixture(A, payer, 102)
  // Three batches: batch size 1 is set through the service client before the claim.
  const three = await renderFixture(A, payer, 101)
  // Locked and waiting for payment; unlocked in group 7.
  const due = await renderFixture(A, payer, 103, false)
  // Two batches (batch size 2): one finishes, one fails for good, then the retry.
  const two = await renderFixture(A, payer, 104)
  // A collection already deployed: the render must not move its status (the reveal flow owns it).
  const shipped = await renderFixture(A, payer, 105)
  // One batch, brought to finalizing, then failed at job level.
  const meta = await renderFixture(A, payer, 106)
  // One batch each: a code longer than the column allows, and a deployed collection failed for good.
  const clamp = await renderFixture(A, payer, 107)
  const held = await renderFixture(A, payer, 108)
  // One batch failed for good over and over (the retry cap), a three-batch job left half run, and a
  // paid job failed by hand with no batch rows.
  const capped = await renderFixture(A, payer, 109)
  const mixed = await renderFixture(A, payer, 110)
  const bare = await renderFixture(A, payer, 111)
  // One batch failed for good with the worker's payment-mismatch code.
  const unverified = await renderFixture(A, payer, 112)
  // The final review's fixes: a code stored in mixed case, a payment mismatch reported after another
  // final failure, a stale final report, a batch landing after a sibling's final failure, a mismatch
  // found before the claim, and a real lock unlocked and then deferred.
  const codeBatch = await renderFixture(A, payer, 113)
  const codeJob = await renderFixture(A, payer, 114)
  const stale = await renderFixture(A, payer, 115)
  const staleMismatch = await renderFixture(A, payer, 119)
  const late = await renderFixture(A, payer, 116)
  const preclaim = await renderFixture(A, payer, 117)
  const flipped = await renderFixture(A, payer, 118, false)
  const indexed = await renderFixture(A, payer, 120)
  const unlockedLate = await renderFixture(A, payer, 121)
  const preclaimOther = await renderFixture(A, payer, 122)

  await check(
    'render state: the new job and batch columns exist and render_jobs.images_cid is gone',
    async () => {
      const job = await admin
        .from('render_jobs')
        .select('base_uri, placeholder_image_cid, collage_key, error_code')
        .limit(1)
      if (job.error) return `render_jobs: ${describe(job.error as DbError)}`
      const batch = await admin
        .from('render_batches')
        .select('images_size, error_code, started_at, finished_at')
        .limit(1)
      if (batch.error) return `render_batches: ${describe(batch.error as DbError)}`
      const gone = await admin.from('render_jobs').select('images_cid').limit(1)
      return expectError(gone.error as DbError, ['42703'], gone.data)
    },
  )

  // Asset batches are sized by bytes at insert (docs/specs/2026-10-12-render-worker.md, section 9).
  await check(
    'render_jobs: a 1/1 job with a 50 MiB file gets 9 tokens a batch and the batch count to match',
    async () => {
      const job = await lockedOneOfOne(A, 45, 50 * 1024 * 1024)
      // floor(500,000,000 / 52,428,800) = 9; ceil(45 / 9) = 5.
      return job.batch_size === 9 && job.batches_total === 5 && job.token_count === 45
        ? null
        : JSON.stringify(job)
    },
  )

  await check(
    'render_jobs: a job whose distinct files fit in one batch keeps 100 tokens a batch, however large one file is',
    async () => {
      // Five distinct files, the largest 50 MiB: at most 5 x 52,428,800 = 262,144,000 bytes, under 500 MB.
      const job = await lockedOneOfOne(A, 5, 50 * 1024 * 1024)
      return job.batch_size === 100 && job.batches_total === 1 ? null : JSON.stringify(job)
    },
  )

  await check('render_jobs: a 1/1 job with small files keeps 100 tokens a batch', async () => {
    const job = await lockedOneOfOne(A, 3, null)
    return job.batch_size === 100 && job.batches_total === 1 ? null : JSON.stringify(job)
  })

  await check('render_jobs: a generative job keeps 100 tokens a batch', async () => {
    const { jobId } = await renderFixture(A, payer, 123, false)
    const job = await admin.from('render_jobs').select('batch_size, batches_total').eq('id', jobId).single()
    if (job.error) return describe(job.error as DbError)
    return job.data.batch_size === 100 && job.data.batches_total === 1 ? null : JSON.stringify(job.data)
  })

  await check(
    'render state: finalizing is a render state, and a done job needs its metadata and base URI',
    async () => {
      const finalizing = await admin.from('render_jobs').select('id').eq('state', 'finalizing').limit(1)
      if (finalizing.error) return `finalizing: ${describe(finalizing.error as DbError)}`
      const done = await admin
        .from('render_jobs')
        .update({ state: 'done', metadata_cid: CID('m') })
        .eq('id', one.jobId)
        .select('id')
      return expectError(done.error as DbError, CHECK, done.data)
    },
  )

  // Group 1: the claim.
  await check('art_claim_render: a batch count that does not match the token count is refused', async () => {
    const set = await admin.from('render_jobs').update({ batch_size: 1 }).eq('id', three.jobId)
    if (set.error) return `setup: ${describe(set.error as DbError)}`
    const { error } = await callArt(admin, 'art_claim_render', { p_job_id: three.jobId })
    const refused = expectSentence(error, CHECK, 'The batch count does not match the token count.')
    if (refused) return refused
    const rows = await countRows('render_batches', 'job_id', three.jobId)
    return rows === 0 ? null : `${rows} batch rows after the refusal`
  })

  await check(
    'art_claim_render: three batch rows with their token ranges, the job and the collection rendering',
    async () => {
      const set = await admin.from('render_jobs').update({ batches_total: 3 }).eq('id', three.jobId)
      if (set.error) return `setup: ${describe(set.error as DbError)}`
      const { data, error } = await callArt(admin, 'art_claim_render', { p_job_id: three.jobId })
      if (error) return describe(error)
      const job = await renderJob(three.jobId)
      const ranges = (await batchesOf(three.jobId))
        .map((b) => `${b.index}:${b.first_token_id}-${b.last_token_id}:${b.state}:${b.attempts}`)
        .join(' ')
      const status = (await lockState(three.cid)).status
      const problems = [
        (data as { id?: string } | null)?.id === three.jobId ? null : `returned ${JSON.stringify(data)}`,
        job.state === 'rendering' &&
        job.started_at !== null &&
        job.batches_done === 0 &&
        job.error === null &&
        job.error_code === null
          ? null
          : JSON.stringify(job),
        ranges === '0:1-1:queued:0 1:2-2:queued:0 2:3-3:queued:0' ? null : `batches ${ranges}`,
        status === 'rendering' ? null : `collection ${status}`,
      ].filter(Boolean)
      return problems.length ? problems.join('; ') : null
    },
  )

  await check('art_claim_render: a second claim returns the same job and adds no batch', async () => {
    const before = await renderJob(three.jobId)
    const { data, error } = await callArt(admin, 'art_claim_render', { p_job_id: three.jobId })
    if (error) return describe(error)
    const after = await renderJob(three.jobId)
    const count = await countRows('render_batches', 'job_id', three.jobId)
    const returned = data as { id?: string; state?: string } | null
    return returned?.id === three.jobId &&
      returned.state === 'rendering' &&
      after.started_at === before.started_at &&
      count === 3
      ? null
      : `${count} batches, ${JSON.stringify(after)}`
  })

  await check('art_claim_render: a job waiting for payment is refused', async () => {
    const { error } = await callArt(admin, 'art_claim_render', { p_job_id: due.jobId })
    return expectSentence(error, CHECK, 'This job is not ready to render.')
  })

  await check('art_claim_render: an unknown job id is refused', async () => {
    const { error } = await callArt(admin, 'art_claim_render', { p_job_id: NO_JOB })
    return expectSentence(error, CHECK, 'This job is not ready to render.')
  })

  await check(
    "render_batches: A reads the job's batch rows and their new columns; B reads none",
    async () => {
      const mine = await A.client
        .from('render_batches')
        .select('index, images_size, error_code, started_at, finished_at')
        .eq('job_id', three.jobId)
      if (mine.error) return describe(mine.error as DbError)
      if (mine.data.length !== 3) return `A sees ${mine.data.length} rows`
      const theirs = await B.client.from('render_batches').select('index').eq('job_id', three.jobId)
      return expectNothing(theirs.error as DbError, theirs.data)
    },
  )

  // Group 2: a batch starts.
  await check('art_batch_start: a queued batch runs with its first attempt', async () => {
    const { data, error } = await callArt(admin, 'art_batch_start', { p_job_id: three.jobId, p_index: 0 })
    if (error) return describe(error)
    const batch = data as BatchCheck
    return batch.state === 'running' &&
      batch.attempts === 1 &&
      batch.started_at !== null &&
      batch.finished_at === null
      ? null
      : JSON.stringify(batch)
  })

  await check('art_batch_start: a redelivered start keeps it running and counts the attempt', async () => {
    const { data, error } = await callArt(admin, 'art_batch_start', { p_job_id: three.jobId, p_index: 0 })
    if (error) return describe(error)
    const batch = data as BatchCheck
    return batch.state === 'running' && batch.attempts === 2 ? null : JSON.stringify(batch)
  })

  await check('art_batch_start: an unknown batch is refused', async () => {
    const { error } = await callArt(admin, 'art_batch_start', { p_job_id: three.jobId, p_index: 3 })
    return expectSentence(error, CHECK, 'There is no such batch.')
  })

  await check('art_batch_start and art_batch_done: a job waiting for payment is refused', async () => {
    const start = await callArt(admin, 'art_batch_start', { p_job_id: due.jobId, p_index: 0 })
    const done = await callArt(admin, 'art_batch_done', {
      p_job_id: due.jobId,
      p_index: 0,
      p_images_cid: CID('a'),
      p_images_size: 1,
    })
    return (
      expectSentence(start.error, CHECK, 'This job is not rendering.') ??
      expectSentence(done.error, CHECK, 'This job is not rendering.')
    )
  })

  // Group 3: a batch lands, once.
  const batch0 = { p_job_id: three.jobId, p_index: 0, p_images_cid: CID('a'), p_images_size: 1024 }
  await check('art_batch_done: batch 0 is recorded; one of three done, not the last', async () => {
    const { data, error } = await callArt(admin, 'art_batch_done', batch0)
    if (error) return describe(error)
    const result = doneOf(data)
    const batch = (await batchesOf(three.jobId))[0]
    const job = await renderJob(three.jobId)
    return result?.batches_done === 1 &&
      result.last === false &&
      batch?.state === 'done' &&
      batch.images_cid === CID('a') &&
      batch.images_size === 1024 &&
      batch.finished_at !== null &&
      job.batches_done === 1 &&
      job.state === 'rendering'
      ? null
      : `${JSON.stringify(result)} ${JSON.stringify(batch)} ${JSON.stringify(job)}`
  })

  await check('art_batch_done: the same report again changes nothing and is not the last', async () => {
    const before = (await batchesOf(three.jobId))[0]
    const { data, error } = await callArt(admin, 'art_batch_done', batch0)
    if (error) return describe(error)
    const result = doneOf(data)
    const after = (await batchesOf(three.jobId))[0]
    return result?.batches_done === 1 && result.last === false && after?.finished_at === before?.finished_at
      ? null
      : `${JSON.stringify(result)} ${JSON.stringify(after)}`
  })

  await check('art_batch_done: a different CID for a done batch is refused', async () => {
    const { error } = await callArt(admin, 'art_batch_done', { ...batch0, p_images_cid: CID('b') })
    return expectSentence(error, CHECK, 'This batch was already recorded with a different result.')
  })

  await check('art_batch_start: a redelivered start of a done batch returns it unchanged', async () => {
    const { data, error } = await callArt(admin, 'art_batch_start', { p_job_id: three.jobId, p_index: 0 })
    if (error) return describe(error)
    const batch = data as BatchCheck
    return batch.state === 'done' && batch.attempts === 2 && batch.images_cid === CID('a')
      ? null
      : JSON.stringify(batch)
  })

  await check('art_batch_done: a missing or malformed CID is refused and the batch stays open', async () => {
    const missing = await callArt(admin, 'art_batch_done', {
      p_job_id: three.jobId,
      p_index: 1,
      p_images_cid: null,
      p_images_size: 1,
    })
    const malformed = await callArt(admin, 'art_batch_done', {
      p_job_id: three.jobId,
      p_index: 1,
      p_images_cid: 'QmNotBase32',
      p_images_size: 1,
    })
    const problem = expectError(missing.error, CHECK) ?? expectError(malformed.error, CHECK)
    if (problem) return problem
    const batch = (await batchesOf(three.jobId))[1]
    const job = await renderJob(three.jobId)
    return batch?.state === 'queued' && job.batches_done === 1
      ? null
      : `${JSON.stringify(batch)} ${JSON.stringify(job)}`
  })

  // Group 4: the last two batches land at once. Two PostgREST requests run on two connections, so the
  // job row lock really serializes them.
  await check(
    'art_batch_done: the last two batches at once flip the job to finalizing exactly once',
    async () => {
      const results = await Promise.all(
        [1, 2].map((index) =>
          callArt(admin, 'art_batch_done', {
            p_job_id: three.jobId,
            p_index: index,
            p_images_cid: CID(index === 1 ? 'c' : 'd'),
            p_images_size: 2048,
          }),
        ),
      )
      const refused = results.find((r) => r.error)
      if (refused) return describe(refused.error)
      const lasts = results.filter((r) => doneOf(r.data)?.last === true).length
      const job = await renderJob(three.jobId)
      return lasts === 1 && job.state === 'finalizing' && job.batches_done === 3
        ? null
        : `${lasts} last, ${JSON.stringify(job)}`
    },
  )

  await check(
    'art_batch_done: a redelivered last batch after the flip changes nothing and is not the last',
    async () => {
      const { data, error } = await callArt(admin, 'art_batch_done', {
        p_job_id: three.jobId,
        p_index: 2,
        p_images_cid: CID('d'),
        p_images_size: 2048,
      })
      if (error) return describe(error)
      const result = doneOf(data)
      const job = await renderJob(three.jobId)
      return result?.last === false && result.batches_done === 3 && job.state === 'finalizing'
        ? null
        : `${JSON.stringify(result)} ${JSON.stringify(job)}`
    },
  )

  await check(
    'art_batch_start: a start of a done batch on a finalizing job returns it unchanged',
    async () => {
      const before = (await batchesOf(three.jobId))[0]
      const { data, error } = await callArt(admin, 'art_batch_start', { p_job_id: three.jobId, p_index: 0 })
      if (error) return describe(error)
      const batch = data as BatchCheck
      return batch.state === 'done' && batch.attempts === before?.attempts && batch.images_cid === CID('a')
        ? null
        : JSON.stringify(batch)
    },
  )

  // Group 5: the finish.
  await check('art_batch_failed: a failure reported for a done batch is refused', async () => {
    const { error } = await callArt(admin, 'art_batch_failed', {
      p_job_id: three.jobId,
      p_index: 0,
      p_code: 'late-report',
      p_message: 'A late failure.',
      p_final: false,
    })
    return expectSentence(error, CHECK, 'This batch is already done.')
  })

  await check('art_batch_failed and art_render_finish: a job waiting for payment is refused', async () => {
    const failed = await callArt(admin, 'art_batch_failed', {
      p_job_id: due.jobId,
      p_index: 0,
      p_code: 'x',
      p_message: 'x',
      p_final: true,
    })
    const finish = await callArt(admin, 'art_render_finish', {
      p_job_id: due.jobId,
      p_metadata_cid: CID('m'),
      p_base_uri: `ipfs://${CID('m')}/`,
    })
    return (
      expectSentence(failed.error, CHECK, 'This job is not rendering.') ??
      expectSentence(finish.error, CHECK, 'This job has batches still rendering.')
    )
  })

  const finishArgs = {
    p_job_id: three.jobId,
    p_metadata_cid: CID('m'),
    p_base_uri: `ipfs://${CID('m')}/`,
    p_collage_key: 'collages/verify.webp',
  }
  await check(
    'art_render_finish: a base URI built from a different CID than the metadata CID is refused',
    async () => {
      const { error } = await callArt(admin, 'art_render_finish', {
        ...finishArgs,
        p_base_uri: `ipfs://${CID('n')}/`,
      })
      const refused = expectError(error, CHECK)
      if (refused) return refused
      const job = await renderJob(three.jobId)
      return job.state === 'finalizing' && job.metadata_cid === null && job.base_uri === null
        ? null
        : JSON.stringify(job)
    },
  )

  await check('art_render_finish: the job is done with its CIDs and the collection is rendered', async () => {
    const { error } = await callArt(admin, 'art_render_finish', finishArgs)
    if (error) return describe(error)
    const job = await renderJob(three.jobId)
    const status = (await lockState(three.cid)).status
    return job.state === 'done' &&
      job.metadata_cid === CID('m') &&
      job.base_uri === `ipfs://${CID('m')}/` &&
      job.collage_key === 'collages/verify.webp' &&
      job.placeholder_image_cid === null &&
      job.finished_at !== null &&
      status === 'rendered'
      ? null
      : `${JSON.stringify(job)} collection ${status}`
  })

  await check('art_render_finish: the same call again returns the job unchanged', async () => {
    const before = await renderJob(three.jobId)
    const { error } = await callArt(admin, 'art_render_finish', finishArgs)
    if (error) return describe(error)
    const after = await renderJob(three.jobId)
    return after.state === 'done' && after.finished_at === before.finished_at ? null : JSON.stringify(after)
  })

  await check('art_render_finish: different values for a done job are refused', async () => {
    const { error } = await callArt(admin, 'art_render_finish', { ...finishArgs, p_metadata_cid: CID('n') })
    return expectSentence(error, CHECK, 'This job was already finished with a different result.')
  })

  await check(
    'art_render_finish: a different collage key or placeholder image for a done job is refused',
    async () => {
      const collage = await callArt(admin, 'art_render_finish', {
        ...finishArgs,
        p_collage_key: 'collages/other.webp',
      })
      const image = await callArt(admin, 'art_render_finish', {
        ...finishArgs,
        p_placeholder_image_cid: CID('p'),
      })
      const job = await renderJob(three.jobId)
      return (
        expectSentence(collage.error, CHECK, 'This job was already finished with a different result.') ??
        expectSentence(image.error, CHECK, 'This job was already finished with a different result.') ??
        (job.collage_key === 'collages/verify.webp' && job.placeholder_image_cid === null
          ? null
          : JSON.stringify(job))
      )
    },
  )

  await check('art_claim_render: a claim redelivered for a done job returns it unchanged', async () => {
    const before = await renderJob(three.jobId)
    const { data, error } = await callArt(admin, 'art_claim_render', { p_job_id: three.jobId })
    if (error) return describe(error)
    const after = await renderJob(three.jobId)
    const count = await countRows('render_batches', 'job_id', three.jobId)
    const status = (await lockState(three.cid)).status
    return (data as { state?: string } | null)?.state === 'done' &&
      after.state === 'done' &&
      after.started_at === before.started_at &&
      count === 3 &&
      status === 'rendered'
      ? null
      : `${JSON.stringify(data)} ${JSON.stringify(after)} ${count} batches, collection ${status}`
  })

  await check('art_render_finish: a job still rendering is refused', async () => {
    const claim = await callArt(admin, 'art_claim_render', { p_job_id: one.jobId })
    if (claim.error) return `setup: ${describe(claim.error)}`
    const { error } = await callArt(admin, 'art_render_finish', {
      p_job_id: one.jobId,
      p_metadata_cid: CID('m'),
      p_base_uri: `ipfs://${CID('m')}/`,
    })
    return expectSentence(error, CHECK, 'This job has batches still rendering.')
  })

  await check(
    'render functions: a deployed collection keeps its status through the claim and the finish',
    async () => {
      const deploy = await admin
        .from('collections')
        .update({ status: 'deployed', chain_id: 31337, contract_address: `0x${'ab'.repeat(20)}` })
        .eq('id', shipped.cid)
      if (deploy.error) return `setup: ${describe(deploy.error as DbError)}`
      const steps: [string, Record<string, unknown>][] = [
        ['art_claim_render', { p_job_id: shipped.jobId }],
        [
          'art_batch_done',
          { p_job_id: shipped.jobId, p_index: 0, p_images_cid: CID('g'), p_images_size: 64 },
        ],
        [
          'art_render_finish',
          { p_job_id: shipped.jobId, p_metadata_cid: CID('h'), p_base_uri: `ipfs://${CID('h')}/` },
        ],
      ]
      const { seen, failed } = await runSteps(steps, () => lockState(shipped.cid).then((s) => s.status))
      if (failed) return failed
      const job = await renderJob(shipped.jobId)
      return job.state === 'done' && seen.every((status) => status === 'deployed')
        ? null
        : `${job.state}, statuses ${seen.join(' ')}`
    },
  )

  // Group 6: failures, on the one-batch job.
  const failure = {
    p_job_id: one.jobId,
    p_index: 0,
    p_code: 'layer-missing',
    p_message: 'A layer image is missing.',
  }
  await check(
    'art_batch_failed: a failure that is not final leaves the job rendering and the batch failed with its code',
    async () => {
      const start = await callArt(admin, 'art_batch_start', { p_job_id: one.jobId, p_index: 0 })
      if (start.error) return `setup: ${describe(start.error)}`
      const { data, error } = await callArt(admin, 'art_batch_failed', { ...failure, p_final: false })
      if (error) return describe(error)
      const job = await renderJob(one.jobId)
      const batch = (await batchesOf(one.jobId))[0]
      return (data as { state?: string } | null)?.state === 'rendering' &&
        job.state === 'rendering' &&
        job.error === null &&
        batch?.state === 'failed' &&
        batch.error_code === 'layer-missing' &&
        batch.finished_at !== null
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(batch)}`
    },
  )

  await check(
    'art_batch_failed: a final failure fails the job with its code and returns the collection to art_locked',
    async () => {
      const { error } = await callArt(admin, 'art_batch_failed', { ...failure, p_final: true })
      if (error) return describe(error)
      const job = await renderJob(one.jobId)
      const state = await lockState(one.cid)
      return job.state === 'failed' &&
        job.error_code === 'layer-missing' &&
        job.error === 'A layer image is missing.' &&
        job.finished_at !== null &&
        state.status === 'art_locked' &&
        state.art_locked_at !== null
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(state)}`
    },
  )
  await check(
    'art_batch_failed: a second final failure on a failed job returns it unchanged with the first code',
    async () => {
      const { data, error } = await callArt(admin, 'art_batch_failed', {
        ...failure,
        p_code: 'other-code',
        p_message: 'Another message.',
        p_final: true,
      })
      if (error) return describe(error)
      const job = await renderJob(one.jobId)
      return (data as { state?: string } | null)?.state === 'failed' &&
        job.state === 'failed' &&
        job.error_code === 'layer-missing' &&
        job.error === 'A layer image is missing.'
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(job)}`
    },
  )

  await check(
    'art_batch_failed: a code longer than 40 characters is clamped and the job still fails',
    async () => {
      const claim = await callArt(admin, 'art_claim_render', { p_job_id: clamp.jobId })
      if (claim.error) return `setup: ${describe(claim.error)}`
      const code = 'c'.repeat(60)
      const { error } = await callArt(admin, 'art_batch_failed', {
        p_job_id: clamp.jobId,
        p_index: 0,
        p_code: code,
        p_message: 'A long code.',
        p_final: true,
      })
      if (error) return describe(error)
      const job = await renderJob(clamp.jobId)
      const batch = (await batchesOf(clamp.jobId))[0]
      const expected = code.slice(0, 40)
      return job.state === 'failed' && job.error_code === expected && batch?.error_code === expected
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(batch)}`
    },
  )

  await check(
    'art_batch_failed: a deployed collection keeps its status through a final failure',
    async () => {
      const deploy = await admin
        .from('collections')
        .update({ status: 'deployed', chain_id: 31337, contract_address: `0x${'cd'.repeat(20)}` })
        .eq('id', held.cid)
      if (deploy.error) return `setup: ${describe(deploy.error as DbError)}`
      const { seen, failed } = await runSteps(
        [
          ['art_claim_render', { p_job_id: held.jobId }],
          [
            'art_batch_failed',
            { p_job_id: held.jobId, p_index: 0, p_code: 'x', p_message: 'x', p_final: true },
          ],
        ],
        () => lockState(held.cid).then((s) => s.status),
      )
      if (failed) return failed
      const job = await renderJob(held.jobId)
      return job.state === 'failed' && seen.every((status) => status === 'deployed')
        ? null
        : `${job.state}, statuses ${seen.join(' ')}`
    },
  )

  await check(
    'art_batch_failed: a job-level failure must be final, and a final one fails a finalizing job and returns the collection to art_locked',
    async () => {
      const claim = await callArt(admin, 'art_claim_render', { p_job_id: meta.jobId })
      if (claim.error) return `setup: claim: ${describe(claim.error)}`
      const done = await callArt(admin, 'art_batch_done', {
        p_job_id: meta.jobId,
        p_index: 0,
        p_images_cid: CID('i'),
        p_images_size: 128,
      })
      if (done.error || doneOf(done.data)?.last !== true) return `setup: done: ${describe(done.error)}`
      const jobLevel = {
        p_job_id: meta.jobId,
        p_index: null as unknown as number,
        p_code: 'cid-mismatch',
        p_message: 'The pinning service returned a different CID.',
      }
      const notFinal = await callArt(admin, 'art_batch_failed', { ...jobLevel, p_final: false })
      const problem = expectSentence(notFinal.error, CHECK, 'A job-level failure must be final.')
      if (problem) return `not final: ${problem}`
      if ((await renderJob(meta.jobId)).state !== 'finalizing') return 'the refused call changed the job'
      const { error } = await callArt(admin, 'art_batch_failed', { ...jobLevel, p_final: true })
      if (error) return describe(error)
      const job = await renderJob(meta.jobId)
      const batch = (await batchesOf(meta.jobId))[0]
      const state = await lockState(meta.cid)
      return job.state === 'failed' &&
        job.error_code === 'cid-mismatch' &&
        job.error === 'The pinning service returned a different CID.' &&
        job.finished_at !== null &&
        batch?.state === 'done' &&
        batch.images_cid === CID('i') &&
        state.status === 'art_locked'
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(batch)} ${JSON.stringify(state)}`
    },
  )

  // Group 7: the retry.
  await check("art_render_retry: the owner's retry queues the failed batch and renders again", async () => {
    const { data, error } = await callArt(A.client, 'art_render_retry', { p_collection_id: one.cid })
    if (error) return describe(error)
    const job = await renderJob(one.jobId)
    const batch = (await batchesOf(one.jobId))[0]
    const status = (await lockState(one.cid)).status
    return (data as { id?: string } | null)?.id === one.jobId &&
      job.state === 'rendering' &&
      job.error === null &&
      job.error_code === null &&
      job.finished_at === null &&
      batch?.state === 'queued' &&
      batch.attempts === 1 &&
      status === 'rendering'
      ? null
      : `${JSON.stringify(job)} ${JSON.stringify(batch)} collection ${status}`
  })

  await check(
    'art_render_retry: after a partial render the finished batch keeps its CID and only the failed batch is queued',
    async () => {
      const set = await admin
        .from('render_jobs')
        .update({ batch_size: 2, batches_total: 2 })
        .eq('id', two.jobId)
      if (set.error) return `setup: ${describe(set.error as DbError)}`
      const { failed } = await runSteps(
        [
          ['art_claim_render', { p_job_id: two.jobId }],
          [
            'art_batch_done',
            { p_job_id: two.jobId, p_index: 0, p_images_cid: CID('f'), p_images_size: 4096 },
          ],
          ['art_batch_start', { p_job_id: two.jobId, p_index: 1 }],
          [
            'art_batch_failed',
            {
              p_job_id: two.jobId,
              p_index: 1,
              p_code: 'render-timeout',
              p_message: 'The batch took too long.',
              p_final: true,
            },
          ],
        ],
        async () => '',
      )
      if (failed) return `setup: ${failed}`
      const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: two.cid })
      if (retry.error) return describe(retry.error)
      const job = await renderJob(two.jobId)
      const batches = (await batchesOf(two.jobId))
        .map((b) => `${b.index}:${b.state}:${b.images_cid ?? '-'}:${b.attempts}:${b.error_code ?? '-'}`)
        .join(' ')
      const expected = `0:done:${CID('f')}:0:- 1:queued:-:1:render-timeout`
      if (job.state !== 'rendering' || job.batches_done !== 1 || batches !== expected)
        return `${JSON.stringify(job)} ${batches}`
      // The re-queued batch runs again: its attempts grow and its finish time is cleared.
      const start = await callArt(admin, 'art_batch_start', { p_job_id: two.jobId, p_index: 1 })
      if (start.error) return `restart: ${describe(start.error)}`
      const again = (await batchesOf(two.jobId))[1]
      return again?.state === 'running' && again.attempts === 2 && again.finished_at === null
        ? null
        : JSON.stringify(again)
    },
  )

  await check(
    'art_render_retry: after a job-level failure with every batch done, the job goes back to finalizing',
    async () => {
      const { error } = await callArt(A.client, 'art_render_retry', { p_collection_id: meta.cid })
      if (error) return describe(error)
      const job = await renderJob(meta.jobId)
      const batches = (await batchesOf(meta.jobId))
        .map((b) => `${b.index}:${b.state}:${b.images_cid ?? '-'}`)
        .join(' ')
      const status = (await lockState(meta.cid)).status
      return job.state === 'finalizing' &&
        job.error === null &&
        job.error_code === null &&
        job.finished_at === null &&
        job.batches_done === 1 &&
        batches === `0:done:${CID('i')}` &&
        status === 'rendering'
        ? null
        : `${JSON.stringify(job)} ${batches} collection ${status}`
    },
  )

  await check('art_claim_render: a claim redelivered for a finalizing job returns it unchanged', async () => {
    const before = await renderJob(meta.jobId)
    const { data, error } = await callArt(admin, 'art_claim_render', { p_job_id: meta.jobId })
    if (error) return describe(error)
    const after = await renderJob(meta.jobId)
    const count = await countRows('render_batches', 'job_id', meta.jobId)
    const status = (await lockState(meta.cid)).status
    return (data as { state?: string } | null)?.state === 'finalizing' &&
      after.state === 'finalizing' &&
      after.started_at === before.started_at &&
      count === 1 &&
      status === 'rendering'
      ? null
      : `${JSON.stringify(data)} ${JSON.stringify(after)} ${count} batches, collection ${status}`
  })

  await check('art_render_retry: a job that has not failed is refused', async () => {
    const { error } = await callArt(A.client, 'art_render_retry', { p_collection_id: one.cid })
    return expectSentence(error, CHECK, 'This job has not failed.')
  })

  await check("art_render_retry: B's session on A's collection is refused as not found", async () => {
    const { error } = await callArt(B.client, 'art_render_retry', { p_collection_id: one.cid })
    return expectSentence(error, PERMISSION, 'collection not found')
  })

  await check('art_render_retry: a job cancelled by an unlock is refused by name', async () => {
    const unlock = await callArt(A.client, 'art_unlock', { p_collection_id: due.cid })
    if (unlock.error) return `setup: ${describe(unlock.error)}`
    const { error } = await callArt(A.client, 'art_render_retry', { p_collection_id: due.cid })
    const refused = expectSentence(error, CHECK, 'This job was unlocked. Lock the art again to render it.')
    if (refused) return refused
    const job = await renderJob(due.jobId)
    return job.state === 'failed' && job.error === 'unlocked' && job.error_code === 'unlocked'
      ? null
      : JSON.stringify(job)
  })

  await check('art_render_retry: a job whose error code is unlocked is refused by name', async () => {
    // A worker message that happens to read "unlocked" is not an unlock; the code is the mark.
    const set = await admin
      .from('render_jobs')
      .update({ error: 'The art was unlocked.', error_code: 'unlocked' })
      .eq('id', due.jobId)
    if (set.error) return `setup: ${describe(set.error as DbError)}`
    const { error } = await callArt(A.client, 'art_render_retry', { p_collection_id: due.cid })
    return expectSentence(error, CHECK, 'This job was unlocked. Lock the art again to render it.')
  })

  await check('art_render_retry: a deployed collection is retried and stays deployed', async () => {
    const { data, error } = await callArt(A.client, 'art_render_retry', { p_collection_id: held.cid })
    if (error) return describe(error)
    const job = await renderJob(held.jobId)
    const status = (await lockState(held.cid)).status
    return (data as { id?: string } | null)?.id === held.jobId &&
      job.state !== 'failed' &&
      status === 'deployed'
      ? null
      : `${JSON.stringify(job)} collection ${status}`
  })

  await check(
    'art_render_retry: the sixth retry is refused, and the job stays failed with five retries counted',
    async () => {
      const claim = await callArt(admin, 'art_claim_render', { p_job_id: capped.jobId })
      if (claim.error) return `setup: claim: ${describe(claim.error)}`
      const failFinally = async (): Promise<string | null> => {
        const start = await callArt(admin, 'art_batch_start', { p_job_id: capped.jobId, p_index: 0 })
        if (start.error) return `start: ${describe(start.error)}`
        const failed = await callArt(admin, 'art_batch_failed', {
          p_job_id: capped.jobId,
          p_index: 0,
          p_code: 'render-timeout',
          p_message: 'The batch took too long.',
          p_final: true,
        })
        return failed.error ? `failed: ${describe(failed.error)}` : null
      }
      for (let round = 1; round <= 5; round++) {
        const problem = await failFinally()
        if (problem) return `round ${round}: ${problem}`
        const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: capped.cid })
        if (retry.error) return `retry ${round}: ${describe(retry.error)}`
      }
      const problem = await failFinally()
      if (problem) return `round 6: ${problem}`
      const { error } = await callArt(A.client, 'art_render_retry', { p_collection_id: capped.cid })
      const refused = expectSentence(
        error,
        CHECK,
        'This job has been retried too many times. Tell support about it.',
      )
      if (refused) return refused
      const row = await admin.from('render_jobs').select('state, retries').eq('id', capped.jobId).single()
      if (row.error) return describe(row.error as DbError)
      return row.data.state === 'failed' && row.data.retries === 5 ? null : JSON.stringify(row.data)
    },
  )

  await check(
    'art_render_retry: a job failed with payment-mismatch is refused with its sentence and stays failed',
    async () => {
      const { failed } = await runSteps(
        [
          ['art_claim_render', { p_job_id: unverified.jobId }],
          [
            'art_batch_failed',
            {
              p_job_id: unverified.jobId,
              p_index: null,
              p_code: 'payment-mismatch',
              p_message: 'The payment could not be verified on chain.',
              p_final: true,
            },
          ],
        ],
        async () => '',
      )
      if (failed) return `setup: ${failed}`
      const { error } = await callArt(A.client, 'art_render_retry', { p_collection_id: unverified.cid })
      const refused = expectSentence(
        error,
        CHECK,
        'The payment for this job could not be verified. Tell support about it.',
      )
      if (refused) return refused
      const job = await renderJob(unverified.jobId)
      return job.state === 'failed' && job.error_code === 'payment-mismatch' ? null : JSON.stringify(job)
    },
  )

  await check(
    'art_batch_failed: a code in mixed case with a trailing space is stored normalised and the retry is refused',
    async () => {
      const claim = await callArt(admin, 'art_claim_render', { p_job_id: codeBatch.jobId })
      if (claim.error) return `setup: ${describe(claim.error)}`
      const { error } = await callArt(admin, 'art_batch_failed', {
        p_job_id: codeBatch.jobId,
        p_index: 0,
        p_code: 'Payment-Mismatch ',
        p_message: 'The payment could not be verified on chain.',
        p_final: true,
      })
      if (error) return describe(error)
      const job = await renderJob(codeBatch.jobId)
      const batch = (await batchesOf(codeBatch.jobId))[0]
      // A payment mismatch is about the job: the batch it names is not read or changed.
      if (job.error_code !== 'payment-mismatch' || batch?.state !== 'queued' || batch.error_code !== null)
        return `${JSON.stringify(job)} ${JSON.stringify(batch)}`
      const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: codeBatch.cid })
      return expectSentence(
        retry.error,
        CHECK,
        'The payment for this job could not be verified. Tell support about it.',
      )
    },
  )

  await check(
    'art_batch_failed: a payment mismatch reported after another final failure replaces its code and the retry is refused',
    async () => {
      const claim = await callArt(admin, 'art_claim_render', { p_job_id: codeJob.jobId })
      if (claim.error) return `setup: ${describe(claim.error)}`
      const report = (code: string, message: string) =>
        callArt(admin, 'art_batch_failed', {
          p_job_id: codeJob.jobId,
          p_index: null,
          p_code: code,
          p_message: message,
          p_final: true,
        })
      const first = await report('dead-letter', 'The message ran out of deliveries.')
      if (first.error) return `setup: ${describe(first.error)}`
      const again = await report('dead-letter', 'Another delivery of the same report.')
      if (again.error) return `repeat: ${describe(again.error)}`
      if ((await renderJob(codeJob.jobId)).error_code !== 'dead-letter') return 'a repeat changed the code'
      const second = await report('payment-mismatch', 'The payment could not be verified on chain.')
      if (second.error) return describe(second.error)
      const job = await renderJob(codeJob.jobId)
      if (
        job.state !== 'failed' ||
        job.error_code !== 'payment-mismatch' ||
        job.error !== 'The payment could not be verified on chain.' ||
        (second.data as { error_code?: string } | null)?.error_code !== 'payment-mismatch'
      )
        return `${JSON.stringify(job)} ${JSON.stringify(second.data)}`
      const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: codeJob.cid })
      return expectSentence(
        retry.error,
        CHECK,
        'The payment for this job could not be verified. Tell support about it.',
      )
    },
  )

  await check(
    'art_batch_failed: a final failure reported again after the creator retried is ignored when it carries the older retries value',
    async () => {
      const claim = await callArt(admin, 'art_claim_render', { p_job_id: stale.jobId })
      if (claim.error) return `setup: ${describe(claim.error)}`
      const report = (retries: number) =>
        callArt(admin, 'art_batch_failed', {
          p_job_id: stale.jobId,
          p_index: 0,
          p_code: 'dead-letter',
          p_message: 'The message ran out of deliveries.',
          p_final: true,
          p_retries: retries,
        })
      const first = await report(0)
      if (first.error) return `first: ${describe(first.error)}`
      const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: stale.cid })
      if (retry.error) return `retry: ${describe(retry.error)}`
      const mid = await renderJob(stale.jobId)
      if (mid.state !== 'rendering' || mid.retries !== 1) return `setup: ${JSON.stringify(mid)}`
      const old = await report(0)
      if (old.error) return `stale: ${describe(old.error)}`
      const after = await renderJob(stale.jobId)
      const batch = (await batchesOf(stale.jobId))[0]
      if (
        (old.data as { state?: string } | null)?.state !== 'rendering' ||
        after.state !== 'rendering' ||
        after.retries !== 1 ||
        batch?.state !== 'queued'
      )
        return `${JSON.stringify(old.data)} ${JSON.stringify(after)} ${JSON.stringify(batch)}`
      const current = await report(1)
      if (current.error) return `current: ${describe(current.error)}`
      const failedNow = await renderJob(stale.jobId)
      return failedNow.state === 'failed' && failedNow.retries === 1 ? null : JSON.stringify(failedNow)
    },
  )

  await check(
    'art_batch_failed: a final payment mismatch carrying an older retries value still fails the job and the retry is refused',
    async () => {
      const claim = await callArt(admin, 'art_claim_render', { p_job_id: staleMismatch.jobId })
      if (claim.error) return `setup: ${describe(claim.error)}`
      const first = await callArt(admin, 'art_batch_failed', {
        p_job_id: staleMismatch.jobId,
        p_index: 0,
        p_code: 'dead-letter',
        p_message: 'The message ran out of deliveries.',
        p_final: true,
        p_retries: 0,
      })
      if (first.error) return `first: ${describe(first.error)}`
      const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: staleMismatch.cid })
      if (retry.error) return `retry: ${describe(retry.error)}`
      const mid = await renderJob(staleMismatch.jobId)
      if (mid.state !== 'rendering' || mid.retries !== 1) return `setup: ${JSON.stringify(mid)}`
      const { error } = await callArt(admin, 'art_batch_failed', {
        p_job_id: staleMismatch.jobId,
        p_index: null,
        p_code: 'payment-mismatch',
        p_message: 'The payment could not be verified on chain.',
        p_final: true,
        p_retries: 0,
      })
      if (error) return describe(error)
      const job = await renderJob(staleMismatch.jobId)
      const status = (await lockState(staleMismatch.cid)).status
      if (job.state !== 'failed' || job.error_code !== 'payment-mismatch' || status !== 'art_locked')
        return `${JSON.stringify(job)} collection ${status}`
      const again = await callArt(A.client, 'art_render_retry', { p_collection_id: staleMismatch.cid })
      return expectSentence(
        again.error,
        CHECK,
        'The payment for this job could not be verified. Tell support about it.',
      )
    },
  )

  await check(
    'art_batch_failed: a job-level failure on a paid job that was never claimed fails it and leaves the collection art_locked',
    async () => {
      const { data, error } = await callArt(admin, 'art_batch_failed', {
        p_job_id: preclaim.jobId,
        p_index: null,
        p_code: 'payment-mismatch',
        p_message: 'The payment could not be verified on chain.',
        p_final: true,
      })
      if (error) return describe(error)
      const job = await renderJob(preclaim.jobId)
      const status = (await lockState(preclaim.cid)).status
      if (
        (data as { state?: string } | null)?.state !== 'failed' ||
        job.state !== 'failed' ||
        job.error_code !== 'payment-mismatch' ||
        job.error !== 'The payment could not be verified on chain.' ||
        job.finished_at === null ||
        job.started_at !== null ||
        status !== 'art_locked'
      )
        return `${JSON.stringify(job)} collection ${status}`
      const claim = await callArt(admin, 'art_claim_render', { p_job_id: preclaim.jobId })
      const claimed = expectSentence(claim.error, CHECK, 'This job is not ready to render.')
      if (claimed) return `claim: ${claimed}`
      const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: preclaim.cid })
      return expectSentence(
        retry.error,
        CHECK,
        'The payment for this job could not be verified. Tell support about it.',
      )
    },
  )

  await check(
    'art_batch_failed: a final payment mismatch sent with the index of a finished batch still fails a finalizing job',
    async () => {
      const claim = await callArt(admin, 'art_claim_render', { p_job_id: indexed.jobId })
      if (claim.error) return `setup: ${describe(claim.error)}`
      const done = await callArt(admin, 'art_batch_done', {
        p_job_id: indexed.jobId,
        p_index: 0,
        p_images_cid: CID('c'),
        p_images_size: 10,
      })
      if (done.error) return `setup: ${describe(done.error)}`
      const mid = await renderJob(indexed.jobId)
      if (mid.state !== 'finalizing') return `setup: ${JSON.stringify(mid)}`
      const { error } = await callArt(admin, 'art_batch_failed', {
        p_job_id: indexed.jobId,
        p_index: 0,
        p_code: 'payment-mismatch',
        p_message: 'The payment could not be verified on chain.',
        p_final: true,
      })
      if (error) return describe(error)
      const job = await renderJob(indexed.jobId)
      const batch = (await batchesOf(indexed.jobId))[0]
      return job.state === 'failed' && job.error_code === 'payment-mismatch' && batch?.state === 'done'
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(batch)}`
    },
  )

  await check(
    'art_batch_failed: a payment mismatch reported for an unlocked job leaves it unlocked',
    async () => {
      const set = await admin
        .from('render_jobs')
        .update({ state: 'failed', error: 'unlocked', error_code: 'unlocked' })
        .eq('id', unlockedLate.jobId)
      if (set.error) return `setup: ${describe(set.error)}`
      const { error } = await callArt(admin, 'art_batch_failed', {
        p_job_id: unlockedLate.jobId,
        p_index: null,
        p_code: 'payment-mismatch',
        p_message: 'The payment could not be verified on chain.',
        p_final: true,
      })
      if (error) return describe(error)
      const job = await renderJob(unlockedLate.jobId)
      return job.state === 'failed' && job.error_code === 'unlocked' && job.error === 'unlocked'
        ? null
        : JSON.stringify(job)
    },
  )

  await check(
    'art_batch_failed: before a claim only a payment mismatch may fail the job; any other job-level failure is refused',
    async () => {
      const { error } = await callArt(admin, 'art_batch_failed', {
        p_job_id: preclaimOther.jobId,
        p_index: null,
        p_code: 'dead-letter',
        p_message: 'The message ran out of deliveries.',
        p_final: true,
      })
      const refused = expectSentence(error, CHECK, 'This job is not rendering.')
      if (refused) return refused
      const job = await renderJob(preclaimOther.jobId)
      return job.state === 'paid' && job.error_code === null ? null : JSON.stringify(job)
    },
  )

  await check(
    'art_batch_done: a batch that lands after a sibling failed for good is recorded without a flip, and the retry queues only the failed one',
    async () => {
      const set = await admin
        .from('render_jobs')
        .update({ batch_size: 1, batches_total: 3 })
        .eq('id', late.jobId)
      if (set.error) return `setup: ${describe(set.error as DbError)}`
      const { failed } = await runSteps(
        [
          ['art_claim_render', { p_job_id: late.jobId }],
          ['art_batch_done', { p_job_id: late.jobId, p_index: 0, p_images_cid: CID('r'), p_images_size: 1 }],
          ['art_batch_start', { p_job_id: late.jobId, p_index: 1 }],
          ['art_batch_start', { p_job_id: late.jobId, p_index: 2 }],
          [
            'art_batch_failed',
            {
              p_job_id: late.jobId,
              p_index: 2,
              p_code: 'render-timeout',
              p_message: 'The batch took too long.',
              p_final: true,
            },
          ],
        ],
        async () => '',
      )
      if (failed) return `setup: ${failed}`
      const { data, error } = await callArt(admin, 'art_batch_done', {
        p_job_id: late.jobId,
        p_index: 1,
        p_images_cid: CID('s'),
        p_images_size: 2,
      })
      if (error) return describe(error)
      const result = doneOf(data)
      const job = await renderJob(late.jobId)
      const batch = (await batchesOf(late.jobId))[1]
      if (
        result?.batches_done !== 2 ||
        result.last !== false ||
        job.state !== 'failed' ||
        job.batches_done !== 2 ||
        batch?.state !== 'done' ||
        batch.images_cid !== CID('s') ||
        batch.finished_at === null
      )
        return `${JSON.stringify(result)} ${JSON.stringify(job)} ${JSON.stringify(batch)}`
      const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: late.cid })
      if (retry.error) return `retry: ${describe(retry.error)}`
      const states = (await batchesOf(late.jobId)).map((b) => b.state).join(' ')
      return states === 'done done queued' ? null : `batches ${states}`
    },
  )

  await check(
    'art_render_retry: a batch left running is queued again with the failed one, and the done one keeps its CID',
    async () => {
      const set = await admin
        .from('render_jobs')
        .update({ batch_size: 1, batches_total: 3 })
        .eq('id', mixed.jobId)
      if (set.error) return `setup: ${describe(set.error as DbError)}`
      const { failed } = await runSteps(
        [
          ['art_claim_render', { p_job_id: mixed.jobId }],
          [
            'art_batch_done',
            { p_job_id: mixed.jobId, p_index: 0, p_images_cid: CID('g'), p_images_size: 2048 },
          ],
          ['art_batch_start', { p_job_id: mixed.jobId, p_index: 1 }],
          ['art_batch_start', { p_job_id: mixed.jobId, p_index: 2 }],
          [
            'art_batch_failed',
            {
              p_job_id: mixed.jobId,
              p_index: 2,
              p_code: 'render-timeout',
              p_message: 'The batch took too long.',
              p_final: true,
            },
          ],
        ],
        async () => '',
      )
      if (failed) return `setup: ${failed}`
      const before = (await batchesOf(mixed.jobId)).map((b) => b.state).join(' ')
      if (before !== 'done running failed') return `setup: batches ${before}`
      const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: mixed.cid })
      if (retry.error) return describe(retry.error)
      const job = await renderJob(mixed.jobId)
      const batches = (await batchesOf(mixed.jobId))
        .map((b) => `${b.index}:${b.state}:${b.images_cid ?? '-'}:${b.attempts}`)
        .join(' ')
      return job.state === 'rendering' && batches === `0:done:${CID('g')}:0 1:queued:-:1 2:queued:-:1`
        ? null
        : `${JSON.stringify(job)} ${batches}`
    },
  )

  await check('art_render_retry: a failed job with no batch rows and no unlock is not ready', async () => {
    const set = await admin
      .from('render_jobs')
      .update({ state: 'failed', error: 'The art could not be read.', error_code: 'layer-missing' })
      .eq('id', bare.jobId)
    if (set.error) return `setup: ${describe(set.error as DbError)}`
    const { error } = await callArt(A.client, 'art_render_retry', { p_collection_id: bare.cid })
    const refused = expectSentence(error, CHECK, 'This job is not ready to render.')
    if (refused) return refused
    const job = await renderJob(bare.jobId)
    return job.state === 'failed' ? null : `the refused call changed the job: ${job.state}`
  })

  await check(
    'art_batch_done: a failed job with no batch rows is still refused as not rendering',
    async () => {
      const { error } = await callArt(admin, 'art_batch_done', {
        p_job_id: bare.jobId,
        p_index: 0,
        p_images_cid: CID('t'),
        p_images_size: 1,
      })
      return expectSentence(error, CHECK, 'This job is not rendering.')
    },
  )

  // Group 8: who may call them. The five service functions take a job id and check nothing else, so
  // only the service role may run them.
  const renderCalls: [string, Record<string, unknown>][] = [
    ['art_claim_render', { p_job_id: three.jobId }],
    ['art_batch_start', { p_job_id: one.jobId, p_index: 0 }],
    ['art_batch_done', { p_job_id: one.jobId, p_index: 0, p_images_cid: CID('e'), p_images_size: 1 }],
    ['art_batch_failed', { p_job_id: one.jobId, p_index: 0, p_code: 'x', p_message: 'x', p_final: true }],
    [
      'art_render_finish',
      { p_job_id: three.jobId, p_metadata_cid: CID('m'), p_base_uri: `ipfs://${CID('m')}/` },
    ],
  ]
  await check(
    "render functions: the owner's own session cannot execute the five service functions",
    async () => {
      const problems: string[] = []
      for (const [fn, args] of renderCalls) {
        const { error } = await callArt(A.client, fn, args)
        const problem = expectSentence(error, PERMISSION, 'permission denied')
        if (problem) problems.push(`${fn}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    'art_render_retry: the service role cannot execute it; it runs as the signed-in owner',
    async () => {
      const { error } = await callArt(admin, 'art_render_retry', { p_collection_id: one.cid })
      return expectSentence(error, PERMISSION, 'permission denied')
    },
  )

  await check(
    'render functions: a signed-out caller cannot execute any of them, and nothing changed',
    async () => {
      const problems: string[] = []
      for (const [fn, args] of [
        ...renderCalls,
        ['art_render_retry', { p_collection_id: one.cid }] as [string, Record<string, unknown>],
      ]) {
        const { error } = await callArt(anon, fn, args)
        const problem = expectSentence(error, PERMISSION, 'permission denied')
        if (problem) problems.push(`${fn}: ${problem}`)
      }
      const job = await renderJob(one.jobId)
      const batch = (await batchesOf(one.jobId))[0]
      if (job.state !== 'rendering' || batch?.state !== 'queued')
        problems.push(`changed: ${JSON.stringify(job)} ${JSON.stringify(batch)}`)
      return problems.length ? problems.join('; ') : null
    },
  )

  // Group 9: deferred art. The placeholder job runs the same path and never moves the collection's status.
  const d = (await insertCollection(A.client)).row!.id
  const deferredSet = await A.client.from('collections').update({ art_deferred: true }).eq('id', d)
  if (deferredSet.error) throw new Error(`setup: ${describe(deferredSet.error as DbError)}`)
  const placeholderUpload = await recordUpload(A.client, d, { kind: 'placeholder' })
  if (!placeholderUpload.id) throw new Error(`setup: ${describe(placeholderUpload.error)}`)
  const placeholderLock = await callArt(A.client, 'art_lock_placeholder', {
    p_collection_id: d,
    p_placeholder_upload_id: placeholderUpload.id,
  })
  if (placeholderLock.error) throw new Error(`setup: ${describe(placeholderLock.error)}`)
  const placeholderJob = idOf(placeholderLock.data)

  await check('placeholder render: the claim seeds one batch and the collection stays draft', async () => {
    const { error } = await callArt(admin, 'art_claim_render', { p_job_id: placeholderJob })
    if (error) return describe(error)
    const job = await renderJob(placeholderJob)
    const batches = (await batchesOf(placeholderJob))
      .map((b) => `${b.index}:${b.first_token_id}-${b.last_token_id}`)
      .join(' ')
    const status = (await lockState(d)).status
    return job.state === 'rendering' && batches === '0:1-1' && status === 'draft'
      ? null
      : `${job.state} ${batches} ${status}`
  })

  await check(
    "placeholder render: a final failure and the owner's retry pick the placeholder job and leave the status alone",
    async () => {
      const start = await callArt(admin, 'art_batch_start', { p_job_id: placeholderJob, p_index: 0 })
      if (start.error) return `start: ${describe(start.error)}`
      const failed = await callArt(admin, 'art_batch_failed', {
        p_job_id: placeholderJob,
        p_index: 0,
        p_code: 'placeholder-unreadable',
        p_message: 'The placeholder file could not be read.',
        p_final: true,
      })
      if (failed.error) return `failed: ${describe(failed.error)}`
      const afterFailure = (await lockState(d)).status
      const failedJob = await renderJob(placeholderJob)
      const retry = await callArt(A.client, 'art_render_retry', { p_collection_id: d })
      if (retry.error) return `retry: ${describe(retry.error)}`
      const job = await renderJob(placeholderJob)
      const status = (await lockState(d)).status
      return (retry.data as { id?: string } | null)?.id === placeholderJob &&
        failedJob.state === 'failed' &&
        job.state === 'rendering' &&
        afterFailure === 'draft' &&
        status === 'draft'
        ? null
        : `${JSON.stringify(job)} after failure ${afterFailure}, after retry ${status}`
    },
  )

  await check(
    'placeholder render: its batch lands last and the job finishes on a metadata file with its image CID',
    async () => {
      const done = await callArt(admin, 'art_batch_done', {
        p_job_id: placeholderJob,
        p_index: 0,
        p_images_cid: CID('p'),
        p_images_size: 512,
      })
      if (done.error) return `done: ${describe(done.error)}`
      const finish = await callArt(admin, 'art_render_finish', {
        p_job_id: placeholderJob,
        p_metadata_cid: CID('q'),
        p_base_uri: `ipfs://${CID('q')}/metadata.json`,
        p_placeholder_image_cid: CID('p'),
      })
      if (finish.error) return `finish: ${describe(finish.error)}`
      const job = await renderJob(placeholderJob)
      const status = (await lockState(d)).status
      return doneOf(done.data)?.last === true &&
        job.state === 'done' &&
        job.metadata_cid === CID('q') &&
        job.base_uri === `ipfs://${CID('q')}/metadata.json` &&
        job.placeholder_image_cid === CID('p') &&
        status === 'draft'
        ? null
        : `${JSON.stringify(job)} collection ${status}`
    },
  )

  await check(
    'art_render_retry: a deferred collection whose real lock was unlocked retries its failed placeholder job',
    async () => {
      const unlock = await callArt(A.client, 'art_unlock', { p_collection_id: flipped.cid })
      if (unlock.error) return `setup: unlock: ${describe(unlock.error)}`
      const defer = await A.client.from('collections').update({ art_deferred: true }).eq('id', flipped.cid)
      if (defer.error) return `setup: defer: ${describe(defer.error as DbError)}`
      const upload = await recordUpload(A.client, flipped.cid, { kind: 'placeholder' })
      if (!upload.id) return `setup: upload: ${describe(upload.error)}`
      const lock = await callArt(A.client, 'art_lock_placeholder', {
        p_collection_id: flipped.cid,
        p_placeholder_upload_id: upload.id,
      })
      if (lock.error) return `setup: lock: ${describe(lock.error)}`
      const placeholder = idOf(lock.data)
      const { failed } = await runSteps(
        [
          ['art_claim_render', { p_job_id: placeholder }],
          ['art_batch_start', { p_job_id: placeholder, p_index: 0 }],
          [
            'art_batch_failed',
            {
              p_job_id: placeholder,
              p_index: 0,
              p_code: 'placeholder-unreadable',
              p_message: 'The placeholder file could not be read.',
              p_final: true,
            },
          ],
        ],
        async () => '',
      )
      if (failed) return `setup: ${failed}`
      const { data, error } = await callArt(A.client, 'art_render_retry', { p_collection_id: flipped.cid })
      if (error) return describe(error)
      const job = await renderJob(placeholder)
      return (data as { id?: string } | null)?.id === placeholder && job.state === 'rendering'
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(job)}`
    },
  )

  await check(
    'art_lock_placeholder: the eleventh placeholder lock is refused with its sentence',
    async () => {
      const col = await insertCollection(A.client)
      if (!col.row) return `setup: ${describe(col.error)}`
      const pid = col.row.id
      const defer = await A.client.from('collections').update({ art_deferred: true }).eq('id', pid)
      if (defer.error) return `setup: ${describe(defer.error as DbError)}`
      const upload = await recordUpload(A.client, pid, { kind: 'placeholder' })
      if (!upload.id) return `setup: upload: ${describe(upload.error)}`
      for (let round = 1; round <= 10; round++) {
        const lock = await callArt(A.client, 'art_lock_placeholder', {
          p_collection_id: pid,
          p_placeholder_upload_id: upload.id,
        })
        if (lock.error) return `lock ${round}: ${describe(lock.error)}`
        const metadata = CID(String.fromCharCode(96 + round))
        const done = await admin
          .from('render_jobs')
          .update({ state: 'done', metadata_cid: metadata, base_uri: `ipfs://${metadata}/metadata.json` })
          .eq('id', idOf(lock.data))
        if (done.error) return `finish ${round}: ${describe(done.error as DbError)}`
      }
      const { error } = await callArt(A.client, 'art_lock_placeholder', {
        p_collection_id: pid,
        p_placeholder_upload_id: upload.id,
      })
      const refused = expectSentence(
        error,
        CHECK,
        'The placeholder has been locked too many times. Tell support about it.',
      )
      if (refused) return refused
      const count = await countRows('render_jobs', 'collection_id', pid)
      return count === 10 ? null : `${count} jobs after the refusal`
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 9i. The render credit: art_unlock on a failed paid job, private.render_credit through
// art_render_credit, and art_lock recording a credited lock waived
// (docs/specs/2026-10-14-render-screen-wiring.md, section 4)
// ---------------------------------------------------------------------------------------------

/** Takes a paid one-batch job to `failed` the way the worker does: the claim, a start, a final failure. */
async function failRender(jobId: string, code: string, message: string): Promise<string | null> {
  const { failed } = await runSteps(
    [
      ['art_claim_render', { p_job_id: jobId }],
      ['art_batch_start', { p_job_id: jobId, p_index: 0 }],
      ['art_batch_failed', { p_job_id: jobId, p_index: 0, p_code: code, p_message: message, p_final: true }],
    ],
    async () => '',
  )
  return failed
}

type CreditRow = {
  id: string
  state: string
  error: string | null
  error_code: string | null
  finished_at: string | null
  retries: number
  payment_tx_hash: string | null
  waived_by: string | null
  waived_reason: string | null
  credit_job_id: string | null
  paid_at: string | null
  quote_total_wei: string
  quote_chain_id: number | null
  quote_payer: string | null
  quote_factory: string | null
  quote_expires_at: string | null
}

async function creditRow(id: string): Promise<CreditRow> {
  const { data, error } = await admin
    .from('render_jobs')
    .select(
      'id, state, error, error_code, finished_at, retries, payment_tx_hash, waived_by, waived_reason, credit_job_id, paid_at, quote_total_wei::text, quote_chain_id, quote_payer, quote_factory, quote_expires_at',
    )
    .eq('id', id)
    .single()
  if (error) throw new Error(`credit row: ${describe(error as DbError)}`)
  return data as unknown as CreditRow
}

const PINNED_ELSEWHERE = 'The pinning service answered with a different CID.'

const creditOf = async (client: SupabaseClient, cid: string, count: number) =>
  callArt(client, 'art_render_credit', { p_collection_id: cid, p_token_count: count })

async function artRenderCredit(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // A paid job failed by the worker, unlocked, then locked again on its credit.
  const paid = await renderFixture(A, payer, 131)
  // A paid job failed with payment-mismatch before the claim: no unlock, no credit.
  const mismatch = await renderFixture(A, payer, 132)
  // A paid job claimed and left rendering.
  const rendering = await renderFixture(A, payer, 133)
  // A paid job taken to done.
  const finished = await renderFixture(A, payer, 134)
  // A job waiting for payment, unlocked while unpaid.
  const unpaid = await renderFixture(A, payer, 135, false)
  let credited = ''

  await check('render credit: the column exists and a credit link needs a waiver', async () => {
    const row = await admin.from('render_jobs').select('credit_job_id').limit(1)
    if (row.error) return describe(row.error as DbError)
    const bad = await admin.from('render_jobs').update({ credit_job_id: paid.jobId }).eq('id', mismatch.jobId)
    return expectError(bad.error as DbError, CHECK)
  })

  await check(
    'art_unlock: a paid job the worker failed is unlocked, keeps its sentence and takes the code unlocked',
    async () => {
      const failed = await failRender(paid.jobId, 'cid-mismatch', PINNED_ELSEWHERE)
      if (failed) return `setup: ${failed}`
      const before = await creditRow(paid.jobId)
      if (before.state !== 'failed' || (await lockState(paid.cid)).status !== 'art_locked')
        return `setup: ${JSON.stringify(before)}`
      const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: paid.cid })
      if (error) return describe(error)
      const job = await creditRow(paid.jobId)
      const state = await lockState(paid.cid)
      const batch = (await batchesOf(paid.jobId))[0]
      return job.state === 'failed' &&
        job.error === PINNED_ELSEWHERE &&
        job.error_code === 'unlocked' &&
        job.finished_at === before.finished_at &&
        job.retries === before.retries &&
        job.payment_tx_hash === before.payment_tx_hash &&
        batch?.state === 'failed' &&
        state.art_locked_at === null &&
        state.status === 'draft' &&
        state.max_supply === null
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(batch)} ${JSON.stringify(state)}`
    },
  )

  await check(
    'art_render_credit: the owner sees the credit for the same count and a smaller one, none for a larger one',
    async () => {
      const same = await creditOf(A.client, paid.cid, 3)
      if (same.error) return describe(same.error)
      const smaller = await creditOf(A.client, paid.cid, 2)
      if (smaller.error) return describe(smaller.error)
      const larger = await creditOf(A.client, paid.cid, 4)
      if (larger.error) return describe(larger.error)
      return same.data === paid.jobId && smaller.data === paid.jobId && larger.data === null
        ? null
        : JSON.stringify({ same: same.data, smaller: smaller.data, larger: larger.data })
    },
  )

  await check("art_render_credit: B's session on A's collection is refused as not found", async () => {
    const { error } = await creditOf(B.client, paid.cid, 3)
    return expectSentence(error, PERMISSION, 'collection not found')
  })

  await check('art_render_credit: the service role and a signed-out caller cannot execute it', async () => {
    const problems: string[] = []
    for (const [who, client] of [
      ['service role', admin],
      ['signed out', anon],
    ] as const) {
      const { error } = await creditOf(client, paid.cid, 3)
      const problem = expectSentence(error, PERMISSION, 'permission denied')
      if (problem) problems.push(`${who}: ${problem}`)
    }
    return problems.length ? problems.join('; ') : null
  })

  await check(
    'art_lock: the next lock at the same count is waived on the credit, with the quote filled and the link set',
    async () => {
      const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, paid.cid, paid.list, payer))
      if (error) return describe(error)
      credited = idOf(data)
      const job = await creditRow(credited)
      const state = await lockState(paid.cid)
      return job.state === 'waived' &&
        job.waived_by === A.userId &&
        job.waived_reason === 'credit' &&
        job.credit_job_id === paid.jobId &&
        job.paid_at !== null &&
        job.payment_tx_hash === null &&
        job.quote_total_wei === '75000000000000' &&
        job.quote_chain_id === 31337 &&
        job.quote_payer === payer &&
        job.quote_factory === FACTORY_ADDRESS &&
        job.quote_expires_at !== null &&
        state.art_locked_at !== null &&
        state.status === 'art_locked'
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(state)}`
    },
  )

  await check('art_render_credit: a used credit is no longer offered', async () => {
    const { data, error } = await creditOf(A.client, paid.cid, 3)
    if (error) return describe(error)
    return data === null ? null : `still offered: ${JSON.stringify(data)}`
  })

  await check('art_unlock: a waived job waiting for a worker stays locked', async () => {
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: paid.cid })
    return expectSentence(error, CHECK, 'The art is paid for and stays locked.')
  })

  await check(
    'render credit: a credited job that fails and is unlocked is the next credit, and the one before it stays used',
    async () => {
      const failed = await failRender(credited, 'dead-letter', 'The render stopped after three tries.')
      if (failed) return `setup: ${failed}`
      const unlock = await callArt(A.client, 'art_unlock', { p_collection_id: paid.cid })
      if (unlock.error) return `unlock: ${describe(unlock.error)}`
      const job = await creditRow(credited)
      if (job.state !== 'failed' || job.error_code !== 'unlocked' || job.waived_reason !== 'credit')
        return JSON.stringify(job)
      const { data, error } = await creditOf(A.client, paid.cid, 3)
      if (error) return describe(error)
      return data === credited ? null : `credit ${JSON.stringify(data)}, expected the credited job`
    },
  )

  await check('art_unlock: an already unlocked job is refused as not locked', async () => {
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: paid.cid })
    return expectSentence(error, CHECK, 'The art is not locked.')
  })

  await check(
    'art_lock: a larger lock pays in full and leaves the credit for a later, smaller lock',
    async () => {
      // A fourth token, so the next lock asks for more than the credit covers.
      const first = await admin
        .from('tokens')
        .select('art_collection_id, dna')
        .eq('collection_id', paid.cid)
        .eq('token_id', 1)
        .single()
      if (first.error) return `setup: ${describe(first.error as DbError)}`
      const art = first.data.art_collection_id
      const dna = first.data.dna as string[]
      const insert = await A.client.from('tokens').insert(tokenRow(paid.cid, art, 4, dna))
      if (insert.error) return `setup: ${describe(insert.error as DbError)}`
      const list = [...paid.list, { id: 4, collectionId: art, dna }]
      const { data, error } = await callArt(admin, 'art_lock', lockArgs(A.userId, paid.cid, list, payer))
      if (error) return describe(error)
      const job = await creditRow(idOf(data))
      if (job.state !== 'payment_due' || job.credit_job_id !== null || job.waived_by !== null)
        return JSON.stringify(job)
      const offered = await creditOf(A.client, paid.cid, 3)
      if (offered.error) return describe(offered.error)
      if (offered.data !== credited)
        return `credit ${JSON.stringify(offered.data)} while a larger lock is open`
      // Cancelled unpaid: the lock opens again and the credit is untouched.
      const unlock = await callArt(A.client, 'art_unlock', { p_collection_id: paid.cid })
      if (unlock.error) return `unlock: ${describe(unlock.error)}`
      const cancelled = await creditRow(job.id)
      const again = await creditOf(A.client, paid.cid, 3)
      return cancelled.state === 'failed' &&
        cancelled.error === 'unlocked' &&
        cancelled.error_code === 'unlocked' &&
        cancelled.payment_tx_hash === null &&
        again.data === credited
        ? null
        : `${JSON.stringify(cancelled)} credit ${JSON.stringify(again.data)}`
    },
  )

  await check('art_unlock: a job failed with payment-mismatch is refused, and leaves no credit', async () => {
    const { error: fail } = await callArt(admin, 'art_batch_failed', {
      p_job_id: mismatch.jobId,
      p_index: null,
      p_code: 'payment-mismatch',
      p_message: 'The payment could not be verified on chain.',
      p_final: true,
    })
    if (fail) return `setup: ${describe(fail)}`
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: mismatch.cid })
    const refused = expectSentence(
      error,
      CHECK,
      'The payment for this job could not be verified. Tell support about it.',
    )
    if (refused) return refused
    const state = await lockState(mismatch.cid)
    const credit = await creditOf(A.client, mismatch.cid, 1)
    return state.art_locked_at !== null && credit.data === null
      ? null
      : `${JSON.stringify(state)} credit ${JSON.stringify(credit.data)}`
  })

  await check('art_unlock: a rendering job is refused as paid for', async () => {
    const claim = await callArt(admin, 'art_claim_render', { p_job_id: rendering.jobId })
    if (claim.error) return `setup: ${describe(claim.error)}`
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: rendering.cid })
    const refused = expectSentence(error, CHECK, 'The art is paid for and stays locked.')
    if (refused) return refused
    return (await lockState(rendering.cid)).status === 'rendering'
      ? null
      : 'the refused call changed the collection'
  })

  await check('art_unlock: a done job is refused as not locked', async () => {
    const { failed } = await runSteps(
      [
        ['art_claim_render', { p_job_id: finished.jobId }],
        ['art_batch_start', { p_job_id: finished.jobId, p_index: 0 }],
        [
          'art_batch_done',
          { p_job_id: finished.jobId, p_index: 0, p_images_cid: CID('k'), p_images_size: 64 },
        ],
        [
          'art_render_finish',
          { p_job_id: finished.jobId, p_metadata_cid: CID('l'), p_base_uri: `ipfs://${CID('l')}/` },
        ],
      ],
      async () => '',
    )
    if (failed) return `setup: ${failed}`
    const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: finished.cid })
    const refused = expectSentence(error, CHECK, 'The art is not locked.')
    if (refused) return refused
    const state = await lockState(finished.cid)
    return state.status === 'rendered' && state.art_locked_at !== null ? null : JSON.stringify(state)
  })

  await check(
    'art_unlock: an unpaid job is still cancelled with both fields unlocked, and is never a credit',
    async () => {
      const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: unpaid.cid })
      if (error) return describe(error)
      const job = await creditRow(unpaid.jobId)
      const state = await lockState(unpaid.cid)
      const credit = await creditOf(A.client, unpaid.cid, 1)
      return job.state === 'failed' &&
        job.error === 'unlocked' &&
        job.error_code === 'unlocked' &&
        job.finished_at !== null &&
        state.art_locked_at === null &&
        state.status === 'draft' &&
        credit.data === null
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(state)} credit ${JSON.stringify(credit.data)}`
    },
  )

  // Deferred art: a placeholder job the worker failed. A placeholder lock is free, sets no
  // art_locked_at and leaves no credit, so the unlock only releases the job for a new placeholder lock.
  const deferredId = (await insertCollection(A.client)).row!.id
  const deferredSet = await A.client.from('collections').update({ art_deferred: true }).eq('id', deferredId)
  if (deferredSet.error) throw new Error(`setup: ${describe(deferredSet.error as DbError)}`)
  const placeholderUpload = await recordUpload(A.client, deferredId, { kind: 'placeholder' })
  if (!placeholderUpload.id) throw new Error(`setup: ${describe(placeholderUpload.error)}`)
  const placeholderLock = await callArt(A.client, 'art_lock_placeholder', {
    p_collection_id: deferredId,
    p_placeholder_upload_id: placeholderUpload.id,
  })
  if (placeholderLock.error) throw new Error(`setup: ${describe(placeholderLock.error)}`)
  const placeholderJob = idOf(placeholderLock.data)
  const PLACEHOLDER_UNREADABLE = 'The placeholder file could not be decoded.'

  await check(
    "art_unlock: a deferred collection's failed placeholder job is released with the code unlocked, and nothing else changes",
    async () => {
      const failed = await failRender(placeholderJob, 'decode', PLACEHOLDER_UNREADABLE)
      if (failed) return `setup: ${failed}`
      const before = await creditRow(placeholderJob)
      const stateBefore = await lockState(deferredId)
      if (before.state !== 'failed' || stateBefore.art_locked_at !== null)
        return `setup: ${JSON.stringify(before)} ${JSON.stringify(stateBefore)}`
      const { error } = await callArt(A.client, 'art_unlock', { p_collection_id: deferredId })
      if (error) return describe(error)
      const job = await creditRow(placeholderJob)
      const state = await lockState(deferredId)
      const batch = (await batchesOf(placeholderJob))[0]
      const credit = await creditOf(A.client, deferredId, 1)
      return job.state === 'failed' &&
        job.error_code === 'unlocked' &&
        job.error === PLACEHOLDER_UNREADABLE &&
        job.finished_at === before.finished_at &&
        job.retries === before.retries &&
        batch?.state === 'failed' &&
        state.art_locked_at === null &&
        state.status === stateBefore.status &&
        credit.data === null
        ? null
        : `${JSON.stringify(job)} ${JSON.stringify(batch)} ${JSON.stringify(state)} credit ${JSON.stringify(credit.data)}`
    },
  )

  await check('art_lock_placeholder: a new placeholder lock is accepted after the release', async () => {
    const { data, error } = await callArt(A.client, 'art_lock_placeholder', {
      p_collection_id: deferredId,
      p_placeholder_upload_id: placeholderUpload.id,
    })
    if (error) return describe(error)
    const next = idOf(data)
    const job = await creditRow(next)
    const state = await lockState(deferredId)
    return next !== '' && next !== placeholderJob && job.state === 'paid' && state.art_locked_at === null
      ? null
      : `${next} ${JSON.stringify(job)} ${JSON.stringify(state)}`
  })
}

// ---------------------------------------------------------------------------------------------
// 9j. Deploy: the deployments table, collection_record_deploy, the guard's lock branch and
// collection_placeholder_ready (docs/specs/2026-10-14-deploy.md, section 4)
// ---------------------------------------------------------------------------------------------
type DeploymentRow = {
  collection_id: string
  chain_id: number
  factory: string
  deployer: string
  salt: string
  code_hash: string
  contract_address: string
  tx_hash: string
  base_uri: string
  payout_address: string
  royalty_bps: number
  royalty_receiver: string
  public_max_per_wallet: number
  mint_fee_flat_wei: string
  mint_fee_bps: number
  airdrop_fee_per_token_wei: string
  deployed_at: string
}

const DEPLOYMENT_COLUMNS =
  'collection_id, chain_id, factory, deployer, salt, code_hash, contract_address, tx_hash, base_uri, payout_address, royalty_bps, royalty_receiver, public_max_per_wallet, mint_fee_flat_wei::text, mint_fee_bps, airdrop_fee_per_token_wei::text, deployed_at'

async function deploymentOf(client: SupabaseClient, cid: string) {
  const { data, error } = await client
    .from('deployments')
    .select(DEPLOYMENT_COLUMNS)
    .eq('collection_id', cid)
    .maybeSingle()
  return { row: data as unknown as DeploymentRow | null, error: error as DbError }
}

type DeployedState = {
  status: string
  chain_id: number | null
  contract_address: string | null
  slug: string | null
  slug_reserved_at: string | null
  art_locked_at: string | null
}

async function deployedState(cid: string): Promise<DeployedState> {
  const { data, error } = await admin
    .from('collections')
    .select('status, chain_id, contract_address, slug, slug_reserved_at, art_locked_at')
    .eq('id', cid)
    .single()
  if (error) throw new Error(`deployed state: ${describe(error as DbError)}`)
  return data as DeployedState
}

type GroupRow = {
  onchain_id: number
  name: string
  price_wei: string
  max_supply: number
  start_at: string | null
}

async function groupsOf(cid: string): Promise<GroupRow[]> {
  const { data, error } = await admin
    .from('mint_groups')
    .select('onchain_id, name, price_wei::text, max_supply, start_at')
    .eq('collection_id', cid)
    .order('onchain_id')
  if (error) throw new Error(`groups: ${describe(error as DbError)}`)
  return data as unknown as GroupRow[]
}

/** Takes a paid (or placeholder) job through its one batch to done, as the worker would. */
async function finishRender(
  jobId: string,
  imagesCid: string,
  metadataCid: string,
  baseUri: string,
  placeholderImageCid: string | null = null,
): Promise<string | null> {
  const { failed } = await runSteps(
    [
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
    ],
    async () => '',
  )
  return failed
}

/** A generative collection of three tokens, locked, paid and rendered to done; with a live link unless `link` is false. */
async function renderedFixture(A: Creator, payer: string, tag: number, options: { link?: boolean } = {}) {
  const { cid, jobId, list } = await renderFixture(A, payer, tag)
  const failed = await finishRender(jobId, CID('d'), CID('e'), `ipfs://${CID('e')}/`)
  if (failed) throw new Error(`setup: render: ${failed}`)
  if (options.link !== false) {
    const error = await reserve(A.client, cid, slug())
    if (error) throw new Error(`setup: link: ${describe(error)}`)
  }
  return { cid, jobId, list }
}

/** A collection that finishes its art later, its placeholder locked and rendered to done, with a live link; a supply unless `withSupply` is false. */
async function deferredFixture(A: Creator, withSupply = true) {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const set = await A.client
    .from('collections')
    .update({ art_deferred: true, ...(withSupply ? { max_supply: 5 } : {}) })
    .eq('id', cid)
  if (set.error) throw new Error(`setup: deferred: ${describe(set.error as DbError)}`)
  const upload = await recordUpload(A.client, cid, { kind: 'placeholder', file_name: 'placeholder.png' })
  if (upload.error || !upload.id) throw new Error(`setup: placeholder upload: ${describe(upload.error)}`)
  const lock = await callArt(A.client, 'art_lock_placeholder', {
    p_collection_id: cid,
    p_placeholder_upload_id: upload.id,
  })
  if (lock.error) throw new Error(`setup: placeholder lock: ${describe(lock.error)}`)
  const jobId = idOf(lock.data)
  const failed = await finishRender(jobId, CID('p'), CID('q'), `ipfs://${CID('q')}/metadata.json`, CID('p'))
  if (failed) throw new Error(`setup: placeholder render: ${failed}`)
  const link = await reserve(A.client, cid, slug())
  if (link) throw new Error(`setup: link: ${describe(link)}`)
  return { cid, jobId }
}

const ADDRESS40 = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

/** The record function's arguments for a collection, every address lowercase, every wei a string. */
const recordArgs = (
  owner: string,
  cid: string,
  payer: string,
  n: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_collection_id: cid,
  p_owner: owner,
  p_chain_id: 31337,
  p_factory: FACTORY_ADDRESS,
  p_deployer: payer,
  p_salt: `0x${HEX64(n)}`,
  p_code_hash: `0x${HEX64(1000 + n)}`,
  p_args: {
    name: 'Verify',
    symbol: 'VFY',
    maxSupply: '3',
    groupSupplies: ['2', '1'],
    groupPrices: ['0', '1000000000000000'],
  },
  p_contract_address: ADDRESS40(n),
  p_tx_hash: `0x${HEX64(2000 + n)}`,
  p_base_uri: `ipfs://${CID('e')}/`,
  p_payout_address: payer,
  p_royalty_bps: 500,
  p_royalty_receiver: payer,
  p_public_max_per_wallet: 3,
  p_mint_fee_flat_wei: '0',
  p_mint_fee_bps: 0,
  p_airdrop_fee_per_token_wei: '0',
  p_groups: [
    { name: 'Public', price_wei: '0', max_supply: 2 },
    { name: 'Holders', price_wei: '1000000000000000', max_supply: 1 },
  ],
  ...overrides,
})

const BIG_FEE = '8000000000000000000123'
const LOCK_SENTENCE = 'The name, symbol and description cannot change while the art is locked.'

async function artDeploy(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // Rendered, linked: the deployment that lands.
  const rendered = await renderedFixture(A, payer, 141)
  // Rendered, no link, then a lapsed link: refusal (2).
  const unlinked = await renderedFixture(A, payer, 142, { link: false })
  // Deferred with its placeholder done: refusal (5) with the first deployment's hash, then its own deployment.
  const deferred = await deferredFixture(A)
  // Deferred without a supply: refusal (3).
  const bare = await deferredFixture(A, false)
  // A draft with a supply and a link but nothing rendered: refusal (4).
  const draft = await insertCollection(A.client)
  if (!draft.row) throw new Error(`setup: ${describe(draft.error)}`)
  const draftId = draft.row.id
  // Locked, waiting for payment: the guard's lock branch.
  const locked = await renderFixture(A, payer, 146, false)

  await check(
    'deployments: the owner reads nothing before deploy, and a client insert is refused',
    async () => {
      const read = await A.client.from('deployments').select('collection_id')
      if (read.error) return describe(read.error as DbError)
      if (read.data.length > 0) return `${read.data.length} row(s) before any deploy`
      const { data, error } = await A.client
        .from('deployments')
        .insert({
          collection_id: rendered.cid,
          chain_id: 31337,
          factory: FACTORY_ADDRESS,
          deployer: payer,
          salt: `0x${HEX64(1)}`,
          code_hash: `0x${HEX64(1001)}`,
          args: {},
          contract_address: ADDRESS40(1),
          tx_hash: `0x${HEX64(2001)}`,
          base_uri: `ipfs://${CID('e')}/`,
          payout_address: payer,
          royalty_bps: 500,
          royalty_receiver: payer,
          public_max_per_wallet: 3,
          mint_fee_flat_wei: 0,
          mint_fee_bps: 0,
          airdrop_fee_per_token_wei: 0,
        })
        .select()
      return expectError(error as DbError, PERMISSION, data)
    },
  )

  await check(
    "collection_record_deploy: the owner's session and a signed-out caller cannot execute it",
    async () => {
      const problems: string[] = []
      for (const [who, client] of [
        ['owner session', A.client],
        ['signed out', anon],
      ] as const) {
        const { error } = await callArt(
          client,
          'collection_record_deploy',
          recordArgs(A.userId, rendered.cid, payer, 1),
        )
        const problem = expectSentence(error, PERMISSION, 'permission denied')
        if (problem) problems.push(`${who}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    "collection_record_deploy: B's id as p_owner on A's collection is refused as not found",
    async () => {
      const { error } = await callArt(
        admin,
        'collection_record_deploy',
        recordArgs(B.userId, rendered.cid, payer, 1),
      )
      const problem = expectSentence(error, PERMISSION, 'collection not found')
      if (problem) return problem
      return (await deployedState(rendered.cid)).status === 'rendered' ? null : 'the collection changed'
    },
  )

  await check(
    'collection_record_deploy: a collection without a live link is refused, lapsed or missing',
    async () => {
      const missing = await callArt(
        admin,
        'collection_record_deploy',
        recordArgs(A.userId, unlinked.cid, payer, 2),
      )
      const first = expectSentence(missing.error, CHECK, 'Reserve your mint page link first.')
      if (first) return `no link: ${first}`
      const reserved = await reserve(A.client, unlinked.cid, slug())
      if (reserved) return `setup reserve: ${describe(reserved)}`
      const aged = await admin
        .from('collections')
        .update({ slug_reserved_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString() })
        .eq('id', unlinked.cid)
      if (aged.error) return `setup age: ${describe(aged.error as DbError)}`
      const lapsed = await callArt(
        admin,
        'collection_record_deploy',
        recordArgs(A.userId, unlinked.cid, payer, 2),
      )
      const second = expectSentence(lapsed.error, CHECK, 'Reserve your mint page link first.')
      if (second) return `lapsed link: ${second}`
      return (await deployedState(unlinked.cid)).status === 'rendered' ? null : 'the collection changed'
    },
  )

  await check('collection_record_deploy: a deferred collection without a supply is refused', async () => {
    const { error } = await callArt(
      admin,
      'collection_record_deploy',
      recordArgs(A.userId, bare.cid, payer, 3),
    )
    return expectSentence(error, CHECK, 'Set the supply in Art first.')
  })

  await check('collection_record_deploy: a collection with nothing rendered is refused', async () => {
    const supply = await A.client.from('collections').update({ max_supply: 3 }).eq('id', draftId)
    if (supply.error) return `setup supply: ${describe(supply.error as DbError)}`
    const link = await reserve(A.client, draftId, slug())
    if (link) return `setup link: ${describe(link)}`
    const { error } = await callArt(
      admin,
      'collection_record_deploy',
      recordArgs(A.userId, draftId, payer, 4),
    )
    return expectSentence(error, CHECK, 'Render the art before deploying.')
  })

  let deployedSlug: string | null = null
  await check(
    'collection_record_deploy: records the deployment, marks the collection deployed on its chain, makes the link permanent and writes the launch phases',
    async () => {
      const stale = await admin
        .from('mint_groups')
        .insert({ collection_id: rendered.cid, onchain_id: 7, name: 'Old draft' })
      if (stale.error) return `setup group: ${describe(stale.error as DbError)}`
      const before = await deployedState(rendered.cid)
      deployedSlug = before.slug
      const { data, error } = await callArt(
        admin,
        'collection_record_deploy',
        recordArgs(A.userId, rendered.cid, payer, 1, { p_mint_fee_flat_wei: BIG_FEE }),
      )
      if (error) return describe(error)
      const returned = data as { collection_id?: string; tx_hash?: string } | null
      if (returned?.collection_id !== rendered.cid || returned.tx_hash !== `0x${HEX64(2001)}`)
        return `returned ${JSON.stringify(returned)}`
      const state = await deployedState(rendered.cid)
      const problems = [
        state.status === 'deployed' ? null : `status ${state.status}`,
        state.chain_id === 31337 ? null : `chain ${state.chain_id}`,
        state.contract_address === ADDRESS40(1) ? null : `contract ${state.contract_address}`,
        state.slug === before.slug ? null : `slug ${state.slug}`,
        state.slug_reserved_at === null ? null : `slug_reserved_at ${state.slug_reserved_at}`,
      ].filter(Boolean)
      if (problems.length) return problems.join('; ')
      const groups = await groupsOf(rendered.cid)
      const want = [
        { onchain_id: 0, name: 'Public', price_wei: '0', max_supply: 2, start_at: null },
        { onchain_id: 1, name: 'Holders', price_wei: '1000000000000000', max_supply: 1, start_at: null },
      ]
      if (JSON.stringify(groups) !== JSON.stringify(want)) return `groups ${JSON.stringify(groups)}`
      const { row, error: readError } = await deploymentOf(A.client, rendered.cid)
      if (readError) return `read: ${describe(readError)}`
      if (!row) return 'no deployments row under the owner'
      const age = Date.now() - Date.parse(row.deployed_at)
      return row.chain_id === 31337 &&
        row.factory === FACTORY_ADDRESS &&
        row.deployer === payer &&
        row.salt === `0x${HEX64(1)}` &&
        row.code_hash === `0x${HEX64(1001)}` &&
        row.contract_address === ADDRESS40(1) &&
        row.base_uri === `ipfs://${CID('e')}/` &&
        row.royalty_bps === 500 &&
        row.public_max_per_wallet === 3 &&
        Math.abs(age) < 60_000
        ? null
        : JSON.stringify(row)
    },
  )

  await check('collection_record_deploy: the fee snapshot keeps every wei above 2^53', async () => {
    const { row, error } = await deploymentOf(A.client, rendered.cid)
    if (error) return describe(error)
    return row?.mint_fee_flat_wei === BIG_FEE ? null : `mint_fee_flat_wei ${row?.mint_fee_flat_wei}`
  })

  await check('collection_record_deploy: a second call for a deployed collection is refused', async () => {
    const { error } = await callArt(
      admin,
      'collection_record_deploy',
      recordArgs(A.userId, rendered.cid, payer, 5),
    )
    const problem = expectSentence(error, CHECK, 'The contract is already deployed.')
    if (problem) return problem
    const { row } = await deploymentOf(A.client, rendered.cid)
    return row?.tx_hash === `0x${HEX64(2001)}` ? null : `the row changed: ${row?.tx_hash}`
  })

  await check(
    'collection_record_deploy: a transaction hash recorded for another collection is refused',
    async () => {
      const { error } = await callArt(
        admin,
        'collection_record_deploy',
        recordArgs(A.userId, deferred.cid, payer, 6, { p_tx_hash: `0x${HEX64(2001)}` }),
      )
      const problem = expectSentence(error, CHECK, 'This transaction was recorded for another collection.')
      if (problem) return problem
      return (await deployedState(deferred.cid)).status === 'draft' ? null : 'the collection changed'
    },
  )

  await check(
    'collection_record_deploy: a deferred collection deploys on its placeholder base URI',
    async () => {
      const { error } = await callArt(
        admin,
        'collection_record_deploy',
        recordArgs(A.userId, deferred.cid, payer, 6, { p_base_uri: `ipfs://${CID('q')}/metadata.json` }),
      )
      if (error) return describe(error)
      const state = await deployedState(deferred.cid)
      const { row } = await deploymentOf(A.client, deferred.cid)
      return state.status === 'deployed' &&
        state.chain_id === 31337 &&
        state.art_locked_at === null &&
        row?.base_uri === `ipfs://${CID('q')}/metadata.json`
        ? null
        : `${JSON.stringify(state)} ${JSON.stringify(row)}`
    },
  )

  await check(
    "reserve_slug: a deployed collection's link is permanent, so another collection cannot take it",
    async () => {
      if (!deployedSlug) return 'no slug recorded'
      const other = await insertCollection(B.client)
      if (!other.row) return `setup: ${describe(other.error)}`
      const problem = expectError(await reserve(B.client, other.row.id, deployedSlug), UNIQUE)
      if (problem) return problem
      return (await deployedState(rendered.cid)).slug === deployedSlug ? null : 'the deployed link was lost'
    },
  )

  await check(
    "deployments: B cannot read A's deployment; A reads it and cannot update or delete it",
    async () => {
      const strangers = await B.client
        .from('deployments')
        .select('collection_id')
        .eq('collection_id', rendered.cid)
      const hidden = expectNothing(strangers.error as DbError, strangers.data)
      if (hidden) return `B: ${hidden}`
      const own = await deploymentOf(A.client, rendered.cid)
      if (own.error || !own.row) return `A: ${describe(own.error)}`
      const update = await A.client
        .from('deployments')
        .update({ royalty_bps: 1 })
        .eq('collection_id', rendered.cid)
        .select()
      const refused = expectError(update.error as DbError, PERMISSION, update.data)
      if (refused) return `update: ${refused}`
      const del = await A.client.from('deployments').delete().eq('collection_id', rendered.cid).select()
      const kept = expectNothing(del.error as DbError, del.data)
      if (kept) return `delete: ${kept}`
      return (await deploymentOf(A.client, rendered.cid)).row?.royalty_bps === 500 ? null : 'the row changed'
    },
  )

  await check('collection_placeholder_ready: true with a done placeholder job, false without', async () => {
    const ready = await A.client.rpc('collection_placeholder_ready', { p_collection_id: deferred.cid })
    if (ready.error) return describe(ready.error as DbError)
    const not = await A.client.rpc('collection_placeholder_ready', { p_collection_id: rendered.cid })
    if (not.error) return describe(not.error as DbError)
    return ready.data === true && not.data === false
      ? null
      : JSON.stringify({ ready: ready.data, not: not.data })
  })

  await check(
    "collection_placeholder_ready: B's session on A's collection is refused as not found; anon and the service role cannot execute it",
    async () => {
      const stranger = await B.client.rpc('collection_placeholder_ready', { p_collection_id: deferred.cid })
      const notFound = expectSentence(stranger.error as DbError, PERMISSION, 'collection not found')
      if (notFound) return `B: ${notFound}`
      const problems: string[] = []
      for (const [who, client] of [
        ['signed out', anon],
        ['service role', admin],
      ] as const) {
        const { error } = await client.rpc('collection_placeholder_ready', { p_collection_id: deferred.cid })
        const problem = expectSentence(error as DbError, PERMISSION, 'permission denied')
        if (problem) problems.push(`${who}: ${problem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    'collections_guard_frozen_fields: the name, symbol and description cannot change while the art is locked',
    async () => {
      const before = await stored(locked.cid)
      if (!before?.art_locked_at) return 'setup: the collection is not locked'
      const problems: string[] = []
      for (const patch of [{ name: 'Renamed' }, { symbol: 'NEW' }, { description: 'Changed' }]) {
        const { data, error } = await A.client.from('collections').update(patch).eq('id', locked.cid).select()
        const problem =
          expectError(error as DbError, CHECK, data) ?? expectSentence(error as DbError, CHECK, LOCK_SENTENCE)
        if (problem) problems.push(`${Object.keys(patch)[0]}: ${problem}`)
      }
      if (problems.length) return problems.join('; ')
      return sameStoredRow(before, await stored(locked.cid)) ? null : 'stored row changed'
    },
  )

  await check(
    'collections_guard_frozen_fields: the three still change on a draft, and again after an unlock',
    async () => {
      const changed = await A.client
        .from('collections')
        .update({ name: 'Draft renamed', symbol: 'DRF', description: 'A draft can change.' })
        .eq('id', draftId)
        .select()
      if (changed.error) return `draft: ${describe(changed.error as DbError)}`
      const unlock = await callArt(A.client, 'art_unlock', { p_collection_id: locked.cid })
      if (unlock.error) return `unlock: ${describe(unlock.error)}`
      const after = await A.client
        .from('collections')
        .update({ name: 'Unlocked renamed', description: 'Open again.' })
        .eq('id', locked.cid)
        .select()
      if (after.error) return `after unlock: ${describe(after.error as DbError)}`
      return (await stored(locked.cid))?.name === 'Unlocked renamed' ? null : 'the rename was not stored'
    },
  )

  await check(
    'collections_guard_frozen_fields: a deployed collection whose placeholder alone was locked keeps the deployment branch',
    async () => {
      const name = await A.client
        .from('collections')
        .update({ name: 'Too late' })
        .eq('id', deferred.cid)
        .select()
      const refused =
        expectError(name.error as DbError, CHECK, name.data) ??
        expectSentence(name.error as DbError, CHECK, 'The name and symbol cannot change after deployment.')
      if (refused) return `name: ${refused}`
      const description = await A.client
        .from('collections')
        .update({ description: 'The description still changes.' })
        .eq('id', deferred.cid)
        .select()
      if (description.error) return `description: ${describe(description.error as DbError)}`
      return description.data.length === 1 ? null : 'the description did not change'
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 9k. Phases: the off-chain columns of mint_groups and their checks, the owner's column grant, the
// positions, mint_group_move, mint_group_record and mint_groups_refresh
// (docs/specs/2026-10-15-phases.md, section 4)
// ---------------------------------------------------------------------------------------------
type PhaseCheckRow = {
  onchain_id: number
  name: string
  description: string
  visible: boolean
  position: number | null
  price_wei: string
  max_supply: number
  start_at: string | null
}

async function phaseRows(cid: string): Promise<PhaseCheckRow[]> {
  const { data, error } = await admin
    .from('mint_groups')
    .select('onchain_id, name, description, visible, position, price_wei::text, max_supply, start_at')
    .eq('collection_id', cid)
    .order('onchain_id')
  if (error) throw new Error(`phases: ${describe(error as DbError)}`)
  return data as unknown as PhaseCheckRow[]
}

type CopyState = { public_max_per_wallet: number; state_block: number | null; state_read_at: string | null }

async function copyState(cid: string): Promise<CopyState> {
  const { data, error } = await admin
    .from('deployments')
    .select('public_max_per_wallet, state_block, state_read_at')
    .eq('collection_id', cid)
    .single()
  if (error) throw new Error(`copy state: ${describe(error as DbError)}`)
  return data as CopyState
}

const NOT_DEPLOYED_SENTENCE = 'The contract is not deployed yet.'
/** 1 November 2026 00:00 UTC plus the block number in seconds: each test block has its own time. */
const blockTime = (block: number) => new Date((1_793_491_200 + block) * 1000).toISOString()

const phaseRecordArgs = (
  owner: string,
  cid: string,
  id: number,
  name: string,
  description = '',
  visible = true,
) => ({
  p_collection_id: cid,
  p_owner: owner,
  p_onchain_id: id,
  p_name: name,
  p_description: description,
  p_visible: visible,
})

const refreshArgs = (
  owner: string,
  cid: string,
  block: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_collection_id: cid,
  p_owner: owner,
  p_block: block,
  p_block_time: blockTime(block),
  p_public_max_per_wallet: 3,
  p_groups: [
    { onchain_id: 0, price_wei: '0', max_supply: 2, start: 0 },
    { onchain_id: 1, price_wei: '1000000000000000', max_supply: 1, start: 0 },
  ],
  ...overrides,
})

async function artPhases(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // Rendered and recorded as deployed with Public (0) and Holders (1), as collection_record_deploy writes them.
  const { cid } = await renderedFixture(A, payer, 151)
  const recorded = await callArt(admin, 'collection_record_deploy', recordArgs(A.userId, cid, payer, 11))
  if (recorded.error) throw new Error(`setup: record: ${describe(recorded.error)}`)
  // A draft without a deployment: the record functions refuse it.
  const draft = await insertCollection(A.client)
  if (!draft.row) throw new Error(`setup: ${describe(draft.error)}`)
  const draftId = draft.row.id
  const update = (onchainId: number, patch: Record<string, unknown>) =>
    A.client.from('mint_groups').update(patch).eq('collection_id', cid).eq('onchain_id', onchainId).select()
  const move = (client: SupabaseClient, onchainId: number, up: boolean) =>
    callArt(client, 'mint_group_move', { p_collection_id: cid, p_onchain_id: onchainId, p_up: up })
  const positions = async () =>
    (await phaseRows(cid)).map((row) => `${row.onchain_id}:${row.position}`).join(' ')

  await check(
    'mint_groups: the launch phases read positions 0 and 1, an empty description and shown',
    async () => {
      const rows = await phaseRows(cid)
      const got = rows.map((row) => [row.onchain_id, row.position, row.description, row.visible])
      return JSON.stringify(got) ===
        JSON.stringify([
          [0, 0, '', true],
          [1, 1, '', true],
        ])
        ? null
        : JSON.stringify(rows)
    },
  )

  await check(
    "mint_groups: a name of 41 characters, a name with outer spaces and another phase's name in other case are refused",
    async () => {
      const problems: string[] = []
      for (const [label, name, codes] of [
        ['41 characters', 'x'.repeat(41), CHECK],
        ['outer spaces', ' Holders ', CHECK],
        ["another phase's name in other case", 'PUBLIC', UNIQUE],
      ] as const) {
        const { data, error } = await update(1, { name })
        const problem = expectError(error as DbError, codes, data)
        if (problem) problems.push(`${label}: ${problem}`)
      }
      if (problems.length) return problems.join('; ')
      return (await phaseRows(cid))[1]?.name === 'Holders' ? null : 'the name changed'
    },
  )

  await check('mint_groups: a description of 501 characters is refused; 500 is kept', async () => {
    const long = await update(1, { description: 'd'.repeat(501) })
    const refused = expectError(long.error as DbError, CHECK, long.data)
    if (refused) return `501: ${refused}`
    const fits = await update(1, { description: 'd'.repeat(500) })
    if (fits.error) return `500: ${describe(fits.error as DbError)}`
    const kept = (await phaseRows(cid))[1]?.description.length
    const reset = await update(1, { description: '' })
    if (reset.error) return `reset: ${describe(reset.error as DbError)}`
    return kept === 500 ? null : `kept ${kept} characters`
  })

  await check('mint_groups: the public sale cannot be hidden; another phase can', async () => {
    const publicSale = await update(0, { visible: false })
    const refused = expectSentence(publicSale.error as DbError, CHECK, 'mint_groups_public_shown')
    if (refused) return `public sale: ${refused}`
    const other = await update(1, { visible: false })
    if (other.error) return `holders: ${describe(other.error as DbError)}`
    const rows = await phaseRows(cid)
    const back = await update(1, { visible: true })
    if (back.error) return `back: ${describe(back.error as DbError)}`
    return rows[0]?.visible === true && rows[1]?.visible === false ? null : JSON.stringify(rows)
  })

  await check('mint_groups: the owner updates the name, description, visibility and position', async () => {
    const changed = await update(1, {
      name: 'Holders club',
      description: 'For holders.',
      visible: false,
      position: 5,
    })
    if (changed.error) return describe(changed.error as DbError)
    const row = (await phaseRows(cid))[1]
    const back = await update(1, { name: 'Holders', description: '', visible: true, position: 1 })
    if (back.error) return `back: ${describe(back.error as DbError)}`
    return row?.name === 'Holders club' &&
      row.description === 'For holders.' &&
      row.visible === false &&
      row.position === 5
      ? null
      : JSON.stringify(row)
  })

  await check(
    'mint_groups: the owner is refused the copies, onchain_id, an insert and a delete',
    async () => {
      const problems: string[] = []
      for (const patch of [
        { price_wei: '1' },
        { max_supply: 0 },
        { start_at: new Date().toISOString() },
        { onchain_id: 5 },
      ]) {
        const { data, error } = await update(1, patch)
        const problem = expectError(error as DbError, PERMISSION, data)
        if (problem) problems.push(`${Object.keys(patch)[0]}: ${problem}`)
      }
      const insert = await A.client
        .from('mint_groups')
        .insert({ collection_id: cid, onchain_id: 5, name: 'Sneaky' })
        .select()
      const inserted = expectError(insert.error as DbError, PERMISSION, insert.data)
      if (inserted) problems.push(`insert: ${inserted}`)
      const removed = await A.client.from('mint_groups').delete().eq('collection_id', cid).select()
      const deleted = expectError(removed.error as DbError, PERMISSION, removed.data)
      if (deleted) problems.push(`delete: ${deleted}`)
      if (problems.length) return problems.join('; ')
      const rows = await phaseRows(cid)
      return rows.length === 2 && rows[1]?.price_wei === '1000000000000000' && rows[1]?.max_supply === 1
        ? null
        : JSON.stringify(rows)
    },
  )

  await check("mint_groups: B cannot update A's phases", async () => {
    const { data, error } = await B.client
      .from('mint_groups')
      .update({ name: 'Hijacked' })
      .eq('collection_id', cid)
      .select()
    const problem = expectNothing(error as DbError, data)
    if (problem) return problem
    return (await phaseRows(cid)).every((row) => row.name !== 'Hijacked') ? null : 'a name changed'
  })

  await check(
    'mint_group_move: moves a phase up and down by swapping positions; an end row stays',
    async () => {
      const up = await move(A.client, 1, true)
      if (up.error) return `up: ${describe(up.error)}`
      const afterUp = await positions()
      const down = await move(A.client, 1, false)
      if (down.error) return `down: ${describe(down.error)}`
      const afterDown = await positions()
      const top = await move(A.client, 0, true)
      const bottom = await move(A.client, 1, false)
      if (top.error || bottom.error) return `end rows: ${describe(top.error ?? bottom.error)}`
      const afterEnds = await positions()
      return afterUp === '0:1 1:0' && afterDown === '0:0 1:1' && afterEnds === '0:0 1:1'
        ? null
        : `${afterUp} | ${afterDown} | ${afterEnds}`
    },
  )

  await check(
    "mint_group_move: B's session on A's phase is refused as not found; a signed-out caller cannot execute it",
    async () => {
      const stranger = await move(B.client, 1, true)
      const notFound = expectSentence(stranger.error, PERMISSION, 'phase not found')
      if (notFound) return `B: ${notFound}`
      const signedOut = await move(anon, 1, true)
      const denied = expectSentence(signedOut.error, PERMISSION, 'permission denied')
      if (denied) return `signed out: ${denied}`
      return (await positions()) === '0:0 1:1' ? null : 'the positions changed'
    },
  )

  await check(
    "mint_group_record and mint_groups_refresh: the owner's session and a signed-out caller cannot execute them",
    async () => {
      const problems: string[] = []
      for (const [who, client] of [
        ['owner session', A.client],
        ['signed out', anon],
      ] as const) {
        const record = await callArt(
          client,
          'mint_group_record',
          phaseRecordArgs(A.userId, cid, 2, 'Allowlist'),
        )
        const recordProblem = expectSentence(record.error, PERMISSION, 'permission denied')
        if (recordProblem) problems.push(`${who} record: ${recordProblem}`)
        const refresh = await callArt(client, 'mint_groups_refresh', refreshArgs(A.userId, cid, 1))
        const refreshProblem = expectSentence(refresh.error, PERMISSION, 'permission denied')
        if (refreshProblem) problems.push(`${who} refresh: ${refreshProblem}`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    'mint_group_record and mint_groups_refresh: a draft is refused as not deployed, another owner as not found',
    async () => {
      const problems: string[] = []
      const draftRecord = await callArt(
        admin,
        'mint_group_record',
        phaseRecordArgs(A.userId, draftId, 1, 'Early'),
      )
      const recordDraft = expectSentence(draftRecord.error, CHECK, NOT_DEPLOYED_SENTENCE)
      if (recordDraft) problems.push(`record a draft: ${recordDraft}`)
      const draftRefresh = await callArt(admin, 'mint_groups_refresh', refreshArgs(A.userId, draftId, 1))
      const refreshDraft = expectSentence(draftRefresh.error, CHECK, NOT_DEPLOYED_SENTENCE)
      if (refreshDraft) problems.push(`refresh a draft: ${refreshDraft}`)
      const otherRecord = await callArt(
        admin,
        'mint_group_record',
        phaseRecordArgs(B.userId, cid, 2, 'Allowlist'),
      )
      const recordOther = expectSentence(otherRecord.error, PERMISSION, 'collection not found')
      if (recordOther) problems.push(`record for another owner: ${recordOther}`)
      const otherRefresh = await callArt(admin, 'mint_groups_refresh', refreshArgs(B.userId, cid, 1))
      const refreshOther = expectSentence(otherRefresh.error, PERMISSION, 'collection not found')
      if (refreshOther) problems.push(`refresh for another owner: ${refreshOther}`)
      if (problems.length) return problems.join('; ')
      return (await countRows('mint_groups', 'collection_id', draftId)) === 0
        ? null
        : 'a row was written for the draft'
    },
  )

  await check(
    'mint_group_record: records a new phase at the next position with its name, description and visibility',
    async () => {
      const { data, error } = await callArt(
        admin,
        'mint_group_record',
        phaseRecordArgs(A.userId, cid, 2, 'Allowlist', 'Friends of the project.', false),
      )
      if (error) return describe(error)
      const returned = data as { onchain_id?: number; position?: number } | null
      if (returned?.onchain_id !== 2 || returned.position !== 2) return `returned ${JSON.stringify(returned)}`
      const added = (await phaseRows(cid))[2]
      return added?.name === 'Allowlist' &&
        added.description === 'Friends of the project.' &&
        added.visible === false &&
        added.price_wei === '0' &&
        added.max_supply === 0 &&
        added.start_at === null
        ? null
        : JSON.stringify(added)
    },
  )

  await check(
    'mint_group_record: on a phase that has a row it updates the name, description and visibility and keeps the position',
    async () => {
      const moved = await move(A.client, 2, true)
      if (moved.error) return `setup move: ${describe(moved.error)}`
      const { error } = await callArt(
        admin,
        'mint_group_record',
        phaseRecordArgs(A.userId, cid, 2, 'Allowlist two', 'Renamed.', true),
      )
      if (error) return describe(error)
      const rows = await phaseRows(cid)
      const back = await move(A.client, 2, false)
      if (back.error) return `move back: ${describe(back.error)}`
      const two = rows[2]
      return two?.name === 'Allowlist two' &&
        two.description === 'Renamed.' &&
        two.visible === true &&
        two.position === 1 &&
        rows[1]?.position === 2
        ? null
        : JSON.stringify(rows)
    },
  )

  await check(
    'mint_group_record: a taken name and a hidden public sale are refused as the index and the check raise them',
    async () => {
      const taken = await callArt(admin, 'mint_group_record', phaseRecordArgs(A.userId, cid, 3, 'holders'))
      const nameProblem = expectSentence(taken.error, UNIQUE, 'mint_groups_name_key')
      if (nameProblem) return `taken name: ${nameProblem}`
      const hidden = await callArt(
        admin,
        'mint_group_record',
        phaseRecordArgs(A.userId, cid, 0, 'Public', '', false),
      )
      const hiddenProblem = expectSentence(hidden.error, CHECK, 'mint_groups_public_shown')
      if (hiddenProblem) return `hidden public sale: ${hiddenProblem}`
      const rows = await phaseRows(cid)
      return rows.length === 3 && rows[0]?.visible === true ? null : JSON.stringify(rows)
    },
  )

  await check(
    'mint_groups_refresh: writes the copies that differ, the cap, state_block and state_read_at, and answers true',
    async () => {
      const { data, error } = await callArt(
        admin,
        'mint_groups_refresh',
        refreshArgs(A.userId, cid, 100, {
          p_public_max_per_wallet: 5,
          p_groups: [
            { onchain_id: 0, price_wei: '2000', max_supply: 2, start: 1_793_491_260 },
            { onchain_id: 1, price_wei: '1000000000000000', max_supply: 1, start: 0 },
            { onchain_id: 2, price_wei: '5', max_supply: 0, start: 0 },
            { onchain_id: 9, price_wei: '1', max_supply: 1, start: 0 },
          ],
        }),
      )
      if (error) return describe(error)
      if (data !== true) return `answered ${JSON.stringify(data)}`
      const rows = await phaseRows(cid)
      const state = await copyState(cid)
      const publicSale = rows[0]
      const problems = [
        publicSale?.price_wei === '2000' &&
        publicSale.start_at !== null &&
        Date.parse(publicSale.start_at) === 1_793_491_260_000
          ? null
          : `public sale ${JSON.stringify(publicSale)}`,
        rows[2]?.price_wei === '5' ? null : `allowlist ${JSON.stringify(rows[2])}`,
        rows.length === 3 ? null : `${rows.length} rows: the refresh inserted one`,
        state.public_max_per_wallet === 5 ? null : `cap ${state.public_max_per_wallet}`,
        state.state_block === 100 ? null : `state_block ${state.state_block}`,
        state.state_read_at !== null && Date.parse(state.state_read_at) === Date.parse(blockTime(100))
          ? null
          : `state_read_at ${state.state_read_at}`,
      ].filter(Boolean)
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    'mint_groups_refresh: an older block writes nothing and answers false; the same block writes again, a cap of 0 included',
    async () => {
      const older = await callArt(
        admin,
        'mint_groups_refresh',
        refreshArgs(A.userId, cid, 99, { p_public_max_per_wallet: 7 }),
      )
      if (older.error) return `older: ${describe(older.error)}`
      if (older.data !== false) return `the older block answered ${JSON.stringify(older.data)}`
      const unchanged = await copyState(cid)
      if (unchanged.public_max_per_wallet !== 5 || unchanged.state_block !== 100)
        return `the older block wrote ${JSON.stringify(unchanged)}`
      if ((await phaseRows(cid))[0]?.price_wei !== '2000') return 'the older block wrote a copy'
      const same = await callArt(
        admin,
        'mint_groups_refresh',
        refreshArgs(A.userId, cid, 100, { p_public_max_per_wallet: 0 }),
      )
      if (same.error) return `same block: ${describe(same.error)}`
      const after = await copyState(cid)
      const publicSale = (await phaseRows(cid))[0]
      return same.data === true &&
        after.public_max_per_wallet === 0 &&
        publicSale?.price_wei === '0' &&
        publicSale.start_at === null
        ? null
        : `${JSON.stringify(after)} ${JSON.stringify(publicSale)}`
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 9l. Whitelist: a quota of 0, the owner's column grants, the copies and their checks,
// whitelist_entries_add and whitelist_chunk_record (docs/specs/2026-10-15-whitelist.md, section 4)
// ---------------------------------------------------------------------------------------------
type EntryCheckRow = {
  wallet_address: string
  quota: number
  written_quota: number | null
  written_tx: string | null
  written_at: string | null
}

/** A group's entries in address order, as the service role reads them. */
async function entryRows(groupId: string): Promise<EntryCheckRow[]> {
  const { data, error } = await admin
    .from('whitelist_entries')
    .select('wallet_address, quota, written_quota, written_tx, written_at')
    .eq('mint_group_id', groupId)
    .order('wallet_address')
  if (error) throw new Error(`entries: ${describe(error as DbError)}`)
  return data as EntryCheckRow[]
}

/** The row id of a collection's group, as the service role reads it. */
async function groupRowId(cid: string, onchainId: number): Promise<string> {
  const { data, error } = await admin
    .from('mint_groups')
    .select('id')
    .eq('collection_id', cid)
    .eq('onchain_id', onchainId)
    .single()
  if (error) throw new Error(`group ${onchainId}: ${describe(error as DbError)}`)
  return (data as { id: string }).id
}

type Pair = { address: string; quota: number }

/** A whitelist address no other section uses: lowercase, 40 hex digits. */
const WL = (n: number) => ADDRESS40(0x5000_0000 + n)
/** The hash of a chunk the checks record. */
const CHUNK_TX = (n: number) => `0x${HEX64(0xc0de_0000 + n)}`
const QUOTA_SENTENCE = 'The quota must be 1 to 10,000.'
const PUBLIC_SALE_SENTENCE = 'The public sale has no whitelist.'
const FULL_SENTENCE = 'A whitelist holds up to 10,000 addresses.'
const NOT_THIS_CHANGE_SENTENCE = 'The transaction did not make this change.'

const addArgs = (cid: string, onchainId: number, rows: Pair[]) => ({
  p_collection_id: cid,
  p_onchain_id: onchainId,
  p_rows: rows,
})

const chunkArgs = (owner: string, cid: string, onchainId: number, tx: string, rows: Pair[]) => ({
  p_collection_id: cid,
  p_owner: owner,
  p_onchain_id: onchainId,
  p_tx: tx,
  p_rows: rows,
})

async function artWhitelist(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // Rendered and recorded as deployed with Public (0) and Holders (1), as 9k records one, and a third group
  // recorded for the cap.
  const { cid } = await renderedFixture(A, payer, 161)
  const recorded = await callArt(admin, 'collection_record_deploy', recordArgs(A.userId, cid, payer, 12))
  if (recorded.error) throw new Error(`setup: record: ${describe(recorded.error)}`)
  const third = await callArt(admin, 'mint_group_record', phaseRecordArgs(A.userId, cid, 2, 'Full list'))
  if (third.error) throw new Error(`setup: group 2: ${describe(third.error)}`)
  const holders = await groupRowId(cid, 1)
  const full = await groupRowId(cid, 2)
  // A draft with a group the service role seeds: both functions refuse it as not deployed.
  const draft = await insertCollection(A.client)
  if (!draft.row) throw new Error(`setup: ${describe(draft.error)}`)
  const draftId = draft.row.id
  const draftGroup = await admin
    .from('mint_groups')
    .insert({ collection_id: draftId, onchain_id: 1, name: 'Early' })
  if (draftGroup.error) throw new Error(`setup: draft group: ${describe(draftGroup.error as DbError)}`)

  const entry = (address: string, quota: number, extra: Record<string, unknown> = {}) => ({
    mint_group_id: holders,
    collection_id: cid,
    wallet_address: address,
    quota,
    ...extra,
  })
  const add = (client: SupabaseClient, onchainId: number, rows: Pair[], collection = cid) =>
    callArt(client, 'whitelist_entries_add', addArgs(collection, onchainId, rows))
  const record = (onchainId: number, tx: string, rows: Pair[], owner = A.userId, collection = cid) =>
    callArt(admin, 'whitelist_chunk_record', chunkArgs(owner, collection, onchainId, tx, rows))
  const rowOf = async (address: string) =>
    (await entryRows(holders)).find((row) => row.wallet_address === address)
  const nowhere = async (address: string) =>
    (await countRows('whitelist_entries', 'wallet_address', address)) === 0

  await check(
    'whitelist_entries: the owner inserts an entry with a quota of 0 (a staged removal)',
    async () => {
      const { data, error } = await A.client
        .from('whitelist_entries')
        .insert(entry(WL(1), 0))
        .select()
      if (error) return describe(error as DbError)
      return data.length === 1 ? null : `${data.length} row(s)`
    },
  )

  await check('whitelist_entries: an owner insert carrying a copy is refused', async () => {
    const problems: string[] = []
    for (const copy of [
      { written_quota: 1 },
      { written_tx: CHUNK_TX(1) },
      { written_at: new Date().toISOString() },
    ]) {
      const { data, error } = await A.client
        .from('whitelist_entries')
        .insert(entry(WL(2), 1, copy))
        .select()
      const problem = expectError(error as DbError, PERMISSION, data)
      if (problem) problems.push(`${Object.keys(copy)[0]}: ${problem}`)
    }
    if (problems.length) return problems.join('; ')
    return (await nowhere(WL(2))) ? null : 'a row was written'
  })

  await check(
    'whitelist_entries: the owner updates quota and is refused the copies, wallet_address and mint_group_id',
    async () => {
      const quota = await A.client
        .from('whitelist_entries')
        .update({ quota: 3 })
        .eq('mint_group_id', holders)
        .eq('wallet_address', WL(1))
        .select()
      if (quota.error) return `quota: ${describe(quota.error as DbError)}`
      if (quota.data.length !== 1) return `quota: ${quota.data.length} row(s)`
      const problems: string[] = []
      for (const patch of [
        { written_quota: 3 },
        { written_tx: CHUNK_TX(1) },
        { written_at: new Date().toISOString() },
        { wallet_address: WL(3) },
        { mint_group_id: full },
      ]) {
        const { data, error } = await A.client
          .from('whitelist_entries')
          .update(patch)
          .eq('mint_group_id', holders)
          .eq('wallet_address', WL(1))
          .select()
        const problem = expectError(error as DbError, PERMISSION, data)
        if (problem) problems.push(`${Object.keys(patch)[0]}: ${problem}`)
      }
      if (problems.length) return problems.join('; ')
      const row = await rowOf(WL(1))
      return row?.quota === 3 && row.written_quota === null ? null : JSON.stringify(row)
    },
  )

  await check('whitelist_entries: a negative, malformed or partial copy is refused', async () => {
    const at = new Date().toISOString()
    const problems: string[] = []
    for (const [label, copy] of [
      ['negative', { written_quota: -1, written_tx: CHUNK_TX(1), written_at: at }],
      ['malformed', { written_quota: 1, written_tx: `0x${'AB'.repeat(32)}`, written_at: at }],
      ['partial', { written_quota: 1 }],
    ] as const) {
      const { data, error } = await admin
        .from('whitelist_entries')
        .update(copy)
        .eq('mint_group_id', holders)
        .eq('wallet_address', WL(1))
        .select()
      const problem = expectError(error as DbError, CHECK, data)
      if (problem) problems.push(`${label}: ${problem}`)
    }
    if (problems.length) return problems.join('; ')
    return (await rowOf(WL(1)))?.written_quota === null ? null : 'a copy was written'
  })

  await check('whitelist_entries_add: a signed-out caller cannot execute it', async () => {
    const { error } = await add(anon, 1, [{ address: WL(4), quota: 1 }])
    const problem = expectSentence(error, PERMISSION, 'permission denied')
    if (problem) return problem
    return (await nowhere(WL(4))) ? null : 'a row was written'
  })

  await check('whitelist_entries_add: a draft is refused as not deployed', async () => {
    const { error } = await add(A.client, 1, [{ address: WL(4), quota: 1 }], draftId)
    const problem = expectSentence(error, CHECK, NOT_DEPLOYED_SENTENCE)
    if (problem) return problem
    return (await nowhere(WL(4))) ? null : 'a row was written'
  })

  await check("whitelist_entries_add: B's session on A's group is refused as not found", async () => {
    const { error } = await add(B.client, 1, [{ address: WL(4), quota: 1 }])
    const problem = expectSentence(error, PERMISSION, 'phase not found')
    if (problem) return problem
    return (await nowhere(WL(4))) ? null : 'a row was written'
  })

  await check('whitelist_entries_add: a quota of 0 or 10,001 is refused', async () => {
    const problems: string[] = []
    for (const quota of [0, 10_001]) {
      const { error } = await add(A.client, 1, [{ address: WL(4), quota }])
      const problem = expectSentence(error, CHECK, QUOTA_SENTENCE)
      if (problem) problems.push(`${quota}: ${problem}`)
    }
    if (problems.length) return problems.join('; ')
    return (await nowhere(WL(4))) ? null : 'a row was written'
  })

  await check('whitelist_entries_add: the public sale is refused', async () => {
    const { error } = await add(A.client, 0, [{ address: WL(4), quota: 1 }])
    const problem = expectSentence(error, CHECK, PUBLIC_SALE_SENTENCE)
    if (problem) return problem
    return (await nowhere(WL(4))) ? null : 'a row was written'
  })

  await check(
    'whitelist_entries_add: the 10,001st address is refused and nothing of that add is kept',
    async () => {
      const rows = (from: number, count: number): Pair[] =>
        Array.from({ length: count }, (_, index) => ({ address: WL(10_000 + from + index), quota: 1 }))
      const filled = await add(A.client, 2, rows(0, 9_999))
      if (filled.error) return `9,999: ${describe(filled.error)}`
      const over = await add(A.client, 2, rows(9_999, 2))
      const problem = expectSentence(over.error, CHECK, FULL_SENTENCE)
      if (problem) return problem
      const kept = await countRows('whitelist_entries', 'mint_group_id', full)
      return kept === 9_999 ? null : `${kept} rows`
    },
  )

  await check(
    'whitelist_entries_add: answers the rows it added and changed; a listed quota changes, its copies do not',
    async () => {
      const first = await add(A.client, 1, [
        { address: WL(5), quota: 2 },
        { address: WL(6), quota: 3 },
      ])
      if (first.error) return `first: ${describe(first.error)}`
      const copy = await admin
        .from('whitelist_entries')
        .update({ written_quota: 2, written_tx: CHUNK_TX(2), written_at: new Date().toISOString() })
        .eq('mint_group_id', holders)
        .eq('wallet_address', WL(5))
      if (copy.error) return `copy: ${describe(copy.error as DbError)}`
      const second = await add(A.client, 1, [
        { address: WL(5), quota: 5 },
        { address: WL(6), quota: 3 },
        { address: WL(7), quota: 1 },
      ])
      if (second.error) return `second: ${describe(second.error)}`
      const counts = `${JSON.stringify(first.data)} ${JSON.stringify(second.data)}`
      const five = await rowOf(WL(5))
      return counts === '[{"added":2,"updated":0}] [{"added":1,"updated":1}]' &&
        five?.quota === 5 &&
        five.written_quota === 2 &&
        five.written_tx === CHUNK_TX(2)
        ? null
        : `${counts} ${JSON.stringify(five)}`
    },
  )

  await check(
    "whitelist_chunk_record: the owner's session, a signed-out caller, a draft, another owner, an unknown group and a malformed hash are refused",
    async () => {
      const pair: Pair[] = [{ address: WL(8), quota: 1 }]
      const problems: string[] = []
      for (const [who, client] of [
        ['owner session', A.client],
        ['signed out', anon],
      ] as const) {
        const { error } = await callArt(
          client,
          'whitelist_chunk_record',
          chunkArgs(A.userId, cid, 1, CHUNK_TX(3), pair),
        )
        const problem = expectSentence(error, PERMISSION, 'permission denied')
        if (problem) problems.push(`${who}: ${problem}`)
      }
      const refusals: [string, DbError, string[], string][] = [
        [
          'draft',
          (await record(1, CHUNK_TX(3), pair, A.userId, draftId)).error,
          CHECK,
          NOT_DEPLOYED_SENTENCE,
        ],
        [
          'another owner',
          (await record(1, CHUNK_TX(3), pair, B.userId)).error,
          PERMISSION,
          'collection not found',
        ],
        ['unknown group', (await record(9, CHUNK_TX(3), pair)).error, PERMISSION, 'phase not found'],
        [
          'malformed hash',
          (await record(1, `0x${'AB'.repeat(32)}`, pair)).error,
          CHECK,
          NOT_THIS_CHANGE_SENTENCE,
        ],
      ]
      for (const [label, error, codes, sentence] of refusals) {
        const problem = expectSentence(error, codes, sentence)
        if (problem) problems.push(`${label}: ${problem}`)
      }
      if (problems.length) return problems.join('; ')
      return (await nowhere(WL(8))) ? null : 'a row was written'
    },
  )

  await check(
    'whitelist_chunk_record: writes the three copies of each pair above 0 and answers how many',
    async () => {
      const { data, error } = await record(1, CHUNK_TX(4), [
        { address: WL(5), quota: 5 },
        { address: WL(6), quota: 3 },
      ])
      if (error) return describe(error)
      const five = await rowOf(WL(5))
      const six = await rowOf(WL(6))
      return data === 2 &&
        five?.written_quota === 5 &&
        five.written_tx === CHUNK_TX(4) &&
        five.written_at !== null &&
        six?.written_quota === 3 &&
        six.written_tx === CHUNK_TX(4)
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify([five, six])}`
    },
  )

  await check(
    'whitelist_chunk_record: a pair for an address Cobweb does not list creates its row, written',
    async () => {
      const { data, error } = await record(1, CHUNK_TX(5), [{ address: WL(9), quota: 4 }])
      if (error) return describe(error)
      const row = await rowOf(WL(9))
      return data === 1 && row?.quota === 4 && row.written_quota === 4 && row.written_tx === CHUNK_TX(5)
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(row)}`
    },
  )

  await check(
    'whitelist_chunk_record: a written zero deletes its staged removal, keeps an address re-added meanwhile, and creates nothing for an unlisted zero',
    async () => {
      const staged = await A.client
        .from('whitelist_entries')
        .update({ quota: 0 })
        .eq('mint_group_id', holders)
        .in('wallet_address', [WL(5), WL(6)])
      if (staged.error) return `stage: ${describe(staged.error as DbError)}`
      const readded = await add(A.client, 1, [{ address: WL(6), quota: 2 }])
      if (readded.error) return `re-add: ${describe(readded.error)}`
      const { data, error } = await record(1, CHUNK_TX(6), [
        { address: WL(5), quota: 0 },
        { address: WL(6), quota: 0 },
        { address: WL(10), quota: 0 },
      ])
      if (error) return describe(error)
      const six = await rowOf(WL(6))
      return data === 2 &&
        (await nowhere(WL(5))) &&
        (await nowhere(WL(10))) &&
        six?.quota === 2 &&
        six.written_quota === 0 &&
        six.written_tx === CHUNK_TX(6)
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(await entryRows(holders))}`
    },
  )

  await check(
    'whitelist_chunk_record: the same transaction recorded twice answers 0 and keeps written_at',
    async () => {
      const before = await rowOf(WL(9))
      const { data, error } = await record(1, CHUNK_TX(5), [{ address: WL(9), quota: 4 }])
      if (error) return describe(error)
      const after = await rowOf(WL(9))
      return data === 0 && before?.written_at !== null && after?.written_at === before?.written_at
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify([before, after])}`
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 9m. Airdrop and Settings: the deployments copies, airdrops and withdrawals with airdrop_record and
// withdrawal_record, and settings_refresh (docs/specs/2026-10-15-airdrop-settings.md, section 4)
// ---------------------------------------------------------------------------------------------
type AirdropCheckRow = {
  tx_hash: string
  kind: string
  recipients: number
  tokens: number
  fee_paid_wei: string
  first_token_id: number
  last_token_id: number
  block: number
  sent_by: string
}

/** A collection's airdrop rows, as the service role reads them. */
async function airdropRows(cid: string): Promise<AirdropCheckRow[]> {
  const { data, error } = await admin
    .from('airdrops')
    .select(
      'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, sent_by',
    )
    .eq('collection_id', cid)
  if (error) throw new Error(`airdrops: ${describe(error as DbError)}`)
  return data as unknown as AirdropCheckRow[]
}

type WithdrawalCheckRow = { tx_hash: string; amount_wei: string; payout_address: string; block: number }

/** A collection's withdrawal rows, as the service role reads them. */
async function withdrawalRows(cid: string): Promise<WithdrawalCheckRow[]> {
  const { data, error } = await admin
    .from('withdrawals')
    .select('tx_hash, amount_wei::text, payout_address, block')
    .eq('collection_id', cid)
  if (error) throw new Error(`withdrawals: ${describe(error as DbError)}`)
  return data as unknown as WithdrawalCheckRow[]
}

type SettingsCopyRow = {
  payout_address: string
  royalty_bps: number
  royalty_receiver: string
  base_uri: string
  transfer_validator: string | null
  mint_on_behalf: boolean
  state_block: number | null
  state_read_at: string | null
}

/** The deployment's settings copies and the read they came from, as the service role reads them. */
async function settingsCopy(cid: string): Promise<SettingsCopyRow> {
  const { data, error } = await admin
    .from('deployments')
    .select(
      'payout_address, royalty_bps, royalty_receiver, base_uri, transfer_validator, mint_on_behalf, state_block, state_read_at',
    )
    .eq('collection_id', cid)
    .single()
  if (error) throw new Error(`settings copy: ${describe(error as DbError)}`)
  return data as SettingsCopyRow
}

/** Each refusal as [label, error, codes, words]: null when every one was refused with its code and words. */
function refusedAll(cases: [string, DbError, string[], string][]): string | null {
  const problems = cases.flatMap(([label, error, codes, words]) => {
    const problem = expectSentence(error, codes, words)
    return problem ? [`${label}: ${problem}`] : []
  })
  return problems.length ? problems.join('; ') : null
}

/** An airdrop's hash for the checks. */
const DROP_TX = (n: number) => `0x${HEX64(0xd209_0000 + n)}`
/** A withdrawal's hash for the checks. */
const WITHDRAW_TX = (n: number) => `0x${HEX64(0x3170_0000 + n)}`
/** Limit Break's default validator, lowercase as the copy holds it. */
const VALIDATOR = '0x721c008fdff27bf06e7e123956e2fe03b63342e3'

const dropArgs = (
  owner: string,
  cid: string,
  tx: string,
  sentBy: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_collection_id: cid,
  p_owner: owner,
  p_tx: tx,
  p_kind: 'airdrop',
  p_recipients: 2,
  p_tokens: 3,
  p_fee_paid_wei: '300000000000000',
  p_first_token_id: 1,
  p_last_token_id: 3,
  p_block: 40,
  p_sent_by: sentBy,
  ...overrides,
})

const withdrawArgs = (
  owner: string,
  cid: string,
  tx: string,
  payout: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_collection_id: cid,
  p_owner: owner,
  p_tx: tx,
  p_amount_wei: '1000000000000000',
  p_payout_address: payout,
  p_block: 41,
  ...overrides,
})

const settingsArgs = (
  owner: string,
  cid: string,
  block: number,
  settings: Record<string, unknown> = {},
): Record<string, unknown> => ({
  p_collection_id: cid,
  p_owner: owner,
  p_block: block,
  p_block_time: blockTime(block),
  p_settings: {
    payout_address: ADDRESS40(0x5e77_0001),
    royalty_bps: 750,
    royalty_receiver: ADDRESS40(0x5e77_0002),
    base_uri: `ipfs://${CID('f')}/`,
    transfer_validator: VALIDATOR,
    mint_on_behalf: true,
    ...settings,
  },
})

async function artAirdropSettings(A: Creator, B: Creator): Promise<void> {
  const payer = A.account.address.toLowerCase()
  // Rendered and recorded as deployed, as 9k records one.
  const { cid } = await renderedFixture(A, payer, 171)
  const recorded = await callArt(admin, 'collection_record_deploy', recordArgs(A.userId, cid, payer, 13))
  if (recorded.error) throw new Error(`setup: record: ${describe(recorded.error)}`)
  // A draft without a deployment: the three functions refuse it.
  const draft = await insertCollection(A.client)
  if (!draft.row) throw new Error(`setup: ${describe(draft.error)}`)
  const draftId = draft.row.id
  const drop = (
    client: SupabaseClient,
    overrides: Record<string, unknown> = {},
    owner = A.userId,
    at = cid,
  ) => callArt(client, 'airdrop_record', dropArgs(owner, at, DROP_TX(2), payer, overrides))
  const withdraw = (
    client: SupabaseClient,
    overrides: Record<string, unknown> = {},
    owner = A.userId,
    at = cid,
  ) => callArt(client, 'withdrawal_record', withdrawArgs(owner, at, WITHDRAW_TX(2), payer, overrides))
  const refresh = (
    client: SupabaseClient,
    block: number,
    settings: Record<string, unknown> = {},
    owner = A.userId,
    at = cid,
  ) => callArt(client, 'settings_refresh', settingsArgs(owner, at, block, settings))
  const recordedRows = async () =>
    (await countRows('airdrops', 'collection_id', cid)) +
    (await countRows('withdrawals', 'collection_id', cid))
  /** The owner's insert (when a row is given), update and delete on a table, each refused for want of a grant. */
  const writesRefused = async (table: string, row: Record<string, unknown> | null) => {
    const results: [string, { data: unknown; error: unknown }][] = []
    if (row) results.push(['insert', await A.client.from(table).insert(row).select()])
    results.push([
      'update',
      await A.client.from(table).update({ block: 99 }).eq('collection_id', cid).select(),
    ])
    results.push(['delete', await A.client.from(table).delete().eq('collection_id', cid).select()])
    return results.flatMap(([label, result]) => {
      const problem = expectError(result.error as DbError, PERMISSION, result.data)
      return problem ? [`${table} ${label}: ${problem}`] : []
    })
  }
  const ownerReads = async (client: SupabaseClient, table: string) => {
    const { data, error } = await client.from(table).select('tx_hash').eq('collection_id', cid)
    if (error) throw new Error(`${table}: ${describe(error as DbError)}`)
    return data.length
  }

  await check(
    'deployments: a new deployment reads transfer_validator null and mint_on_behalf false',
    async () => {
      const { data, error } = await A.client
        .from('deployments')
        .select('transfer_validator, mint_on_behalf')
        .eq('collection_id', cid)
        .single()
      if (error) return describe(error as DbError)
      return data.transfer_validator === null && data.mint_on_behalf === false ? null : JSON.stringify(data)
    },
  )

  await check(
    'airdrops and withdrawals: the owner reads nothing before a record, and a client insert, update or delete is refused',
    async () => {
      if ((await ownerReads(A.client, 'airdrops')) + (await ownerReads(A.client, 'withdrawals')) > 0)
        return 'the owner read a row'
      const problems = [
        ...(await writesRefused('airdrops', {
          tx_hash: DROP_TX(1),
          collection_id: cid,
          kind: 'airdrop',
          recipients: 1,
          tokens: 1,
          fee_paid_wei: 0,
          first_token_id: 1,
          last_token_id: 1,
          block: 1,
          sent_by: payer,
        })),
        ...(await writesRefused('withdrawals', {
          tx_hash: WITHDRAW_TX(1),
          collection_id: cid,
          amount_wei: 1,
          payout_address: payer,
          block: 1,
        })),
      ]
      if (problems.length) return problems.join('; ')
      return (await recordedRows()) === 0 ? null : 'a row was written'
    },
  )

  await check("airdrop_record: a signed-out caller and the owner's session cannot execute it", async () => {
    const problem = refusedAll([
      ['signed out', (await drop(anon)).error, PERMISSION, 'permission denied'],
      ['owner session', (await drop(A.client)).error, PERMISSION, 'permission denied'],
    ])
    if (problem) return problem
    return (await recordedRows()) === 0 ? null : 'a row was written'
  })

  await check('airdrop_record: a draft is refused as not deployed, another owner as not found', async () => {
    const problem = refusedAll([
      ['draft', (await drop(admin, {}, A.userId, draftId)).error, CHECK, NOT_DEPLOYED_SENTENCE],
      ['another owner', (await drop(admin, {}, B.userId)).error, PERMISSION, 'collection not found'],
    ])
    if (problem) return problem
    return (await recordedRows()) === 0 ? null : 'a row was written'
  })

  await check('airdrop_record: a malformed hash, sender or kind is refused as not this change', async () => {
    const problem = refusedAll([
      ['hash', (await drop(admin, { p_tx: `0x${'AB'.repeat(32)}` })).error, CHECK, NOT_THIS_CHANGE_SENTENCE],
      [
        'sender',
        (await drop(admin, { p_sent_by: `0x${'AB'.repeat(20)}` })).error,
        CHECK,
        NOT_THIS_CHANGE_SENTENCE,
      ],
      ['kind', (await drop(admin, { p_kind: 'mint' })).error, CHECK, NOT_THIS_CHANGE_SENTENCE],
    ])
    if (problem) return problem
    return (await recordedRows()) === 0 ? null : 'a row was written'
  })

  await check(
    'airdrop_record: a burn to two recipients, an id range that does not match the tokens, or a negative fee is refused',
    async () => {
      const problem = refusedAll([
        ['burn', (await drop(admin, { p_kind: 'burn' })).error, CHECK, 'airdrops_burn_one_recipient'],
        ['range', (await drop(admin, { p_last_token_id: 4 })).error, CHECK, 'airdrops_token_range'],
        ['fee', (await drop(admin, { p_fee_paid_wei: '-1' })).error, CHECK, 'airdrops_fee_paid_wei_check'],
      ])
      if (problem) return problem
      return (await recordedRows()) === 0 ? null : 'a row was written'
    },
  )

  await check(
    'airdrop_record: records the batch and answers true; the owner reads it and B reads nothing',
    async () => {
      const { data, error } = await drop(admin)
      if (error) return describe(error)
      const rows = await airdropRows(cid)
      const expected: AirdropCheckRow = {
        tx_hash: DROP_TX(2),
        kind: 'airdrop',
        recipients: 2,
        tokens: 3,
        fee_paid_wei: '300000000000000',
        first_token_id: 1,
        last_token_id: 3,
        block: 40,
        sent_by: payer,
      }
      return data === true &&
        JSON.stringify(rows) === JSON.stringify([expected]) &&
        (await ownerReads(A.client, 'airdrops')) === 1 &&
        (await ownerReads(B.client, 'airdrops')) === 0
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(rows)}`
    },
  )

  await check('airdrops: anon reads nothing from the recorded airdrop', async () => {
    // With the row present, reading nothing proves anon cannot read it.
    if ((await countRows('airdrops', 'tx_hash', DROP_TX(2))) !== 1) return 'no recorded airdrop to read'
    const { data, error } = await anon.from('airdrops').select('tx_hash').eq('tx_hash', DROP_TX(2))
    return expectNothing(error, data)
  })

  await check('airdrop_record: a second record of the hash answers false and changes nothing', async () => {
    const { data, error } = await drop(admin, { p_block: 99, p_tokens: 1, p_last_token_id: 1 })
    if (error) return describe(error)
    const rows = await airdropRows(cid)
    return data === false && rows.length === 1 && rows[0]?.block === 40 && rows[0].tokens === 3
      ? null
      : `${JSON.stringify(data)} ${JSON.stringify(rows)}`
  })

  await check('airdrops: the owner cannot update or delete a recorded row', async () => {
    const problems = await writesRefused('airdrops', null)
    if (problems.length) return problems.join('; ')
    const rows = await airdropRows(cid)
    return rows.length === 1 && rows[0]?.block === 40 ? null : JSON.stringify(rows)
  })

  await check(
    "withdrawal_record: a signed-out caller and the owner's session cannot execute it",
    async () => {
      const problem = refusedAll([
        ['signed out', (await withdraw(anon)).error, PERMISSION, 'permission denied'],
        ['owner session', (await withdraw(A.client)).error, PERMISSION, 'permission denied'],
      ])
      if (problem) return problem
      return (await countRows('withdrawals', 'collection_id', cid)) === 0 ? null : 'a row was written'
    },
  )

  await check(
    'withdrawal_record: a draft is refused as not deployed, another owner as not found, a malformed hash or payout address as not this change',
    async () => {
      const problem = refusedAll([
        ['draft', (await withdraw(admin, {}, A.userId, draftId)).error, CHECK, NOT_DEPLOYED_SENTENCE],
        ['another owner', (await withdraw(admin, {}, B.userId)).error, PERMISSION, 'collection not found'],
        [
          'hash',
          (await withdraw(admin, { p_tx: `0x${'AB'.repeat(32)}` })).error,
          CHECK,
          NOT_THIS_CHANGE_SENTENCE,
        ],
        [
          'payout address',
          (await withdraw(admin, { p_payout_address: `0x${'AB'.repeat(20)}` })).error,
          CHECK,
          NOT_THIS_CHANGE_SENTENCE,
        ],
      ])
      if (problem) return problem
      return (await countRows('withdrawals', 'collection_id', cid)) === 0 ? null : 'a row was written'
    },
  )

  await check('withdrawal_record: an amount of 0 is refused', async () => {
    const problem = expectSentence(
      (await withdraw(admin, { p_amount_wei: '0' })).error,
      CHECK,
      'withdrawals_amount_wei_check',
    )
    if (problem) return problem
    return (await countRows('withdrawals', 'collection_id', cid)) === 0 ? null : 'a row was written'
  })

  await check(
    'withdrawal_record: records the withdrawal and answers true; the owner reads it and B reads nothing',
    async () => {
      const { data, error } = await withdraw(admin)
      if (error) return describe(error)
      const rows = await withdrawalRows(cid)
      const expected: WithdrawalCheckRow = {
        tx_hash: WITHDRAW_TX(2),
        amount_wei: '1000000000000000',
        payout_address: payer,
        block: 41,
      }
      return data === true &&
        JSON.stringify(rows) === JSON.stringify([expected]) &&
        (await ownerReads(A.client, 'withdrawals')) === 1 &&
        (await ownerReads(B.client, 'withdrawals')) === 0
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(rows)}`
    },
  )

  await check('withdrawals: anon reads nothing from the recorded withdrawal', async () => {
    // With the row present, reading nothing proves anon cannot read it.
    if ((await countRows('withdrawals', 'tx_hash', WITHDRAW_TX(2))) !== 1)
      return 'no recorded withdrawal to read'
    const { data, error } = await anon.from('withdrawals').select('tx_hash').eq('tx_hash', WITHDRAW_TX(2))
    return expectNothing(error, data)
  })

  await check(
    'withdrawal_record: a second record of the hash answers false and changes nothing; the owner cannot update or delete the row',
    async () => {
      const { data, error } = await withdraw(admin, { p_amount_wei: '5', p_block: 99 })
      if (error) return describe(error)
      const problems = await writesRefused('withdrawals', null)
      if (problems.length) return problems.join('; ')
      const rows = await withdrawalRows(cid)
      return data === false &&
        rows.length === 1 &&
        rows[0]?.amount_wei === '1000000000000000' &&
        rows[0].block === 41
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(rows)}`
    },
  )

  await check("settings_refresh: a signed-out caller and the owner's session cannot execute it", async () => {
    const problem = refusedAll([
      ['signed out', (await refresh(anon, 100)).error, PERMISSION, 'permission denied'],
      ['owner session', (await refresh(A.client, 100)).error, PERMISSION, 'permission denied'],
    ])
    if (problem) return problem
    return (await settingsCopy(cid)).state_block === null ? null : 'a copy was written'
  })

  await check(
    'settings_refresh: a draft is refused as not deployed, another owner as not found',
    async () => {
      const problem = refusedAll([
        ['draft', (await refresh(admin, 100, {}, A.userId, draftId)).error, CHECK, NOT_DEPLOYED_SENTENCE],
        [
          'another owner',
          (await refresh(admin, 100, {}, B.userId)).error,
          PERMISSION,
          'collection not found',
        ],
      ])
      if (problem) return problem
      return (await settingsCopy(cid)).state_block === null ? null : 'a copy was written'
    },
  )

  await check(
    'settings_refresh: writes the six copies, state_block and state_read_at, and answers true',
    async () => {
      const { data, error } = await refresh(admin, 100)
      if (error) return describe(error)
      const copy = await settingsCopy(cid)
      return data === true &&
        copy.payout_address === ADDRESS40(0x5e77_0001) &&
        copy.royalty_bps === 750 &&
        copy.royalty_receiver === ADDRESS40(0x5e77_0002) &&
        copy.base_uri === `ipfs://${CID('f')}/` &&
        copy.transfer_validator === VALIDATOR &&
        copy.mint_on_behalf === true &&
        copy.state_block === 100 &&
        copy.state_read_at !== null &&
        Date.parse(copy.state_read_at) === Date.parse(blockTime(100))
        ? null
        : `${JSON.stringify(data)} ${JSON.stringify(copy)}`
    },
  )

  await check(
    'settings_refresh: an older block answers false and writes nothing; the same block is accepted',
    async () => {
      const older = await refresh(admin, 99, { mint_on_behalf: false, base_uri: `ipfs://${CID('g')}/` })
      if (older.error) return `older: ${describe(older.error)}`
      const unchanged = await settingsCopy(cid)
      if (older.data !== false || unchanged.mint_on_behalf !== true || unchanged.state_block !== 100)
        return `the older block answered ${JSON.stringify(older.data)} and left ${JSON.stringify(unchanged)}`
      const same = await refresh(admin, 100, { mint_on_behalf: false })
      if (same.error) return `same block: ${describe(same.error)}`
      const after = await settingsCopy(cid)
      return same.data === true && after.mint_on_behalf === false && after.state_block === 100
        ? null
        : `${JSON.stringify(same.data)} ${JSON.stringify(after)}`
    },
  )

  await check(
    'settings_refresh: a royalty of 1,500 is copied; 10,001, a malformed address or a missing key is refused; the owner cannot update a copy',
    async () => {
      const copied = await refresh(admin, 101, { royalty_bps: 1500 })
      if (copied.error) return `1,500: ${describe(copied.error)}`
      if ((await settingsCopy(cid)).royalty_bps !== 1500) return 'a royalty of 1,500 was not copied'
      const problem = refusedAll([
        [
          '10,001',
          (await refresh(admin, 102, { royalty_bps: 10_001 })).error,
          CHECK,
          'deployments_royalty_bps_check',
        ],
        [
          'malformed address',
          (await refresh(admin, 102, { payout_address: `0x${'AB'.repeat(20)}` })).error,
          CHECK,
          'deployments_payout_address_check',
        ],
        [
          'missing key',
          (await refresh(admin, 102, { transfer_validator: undefined })).error,
          ['23502'],
          'Every setting is required.',
        ],
      ])
      if (problem) return problem
      const update = await A.client
        .from('deployments')
        .update({ royalty_bps: 100 })
        .eq('collection_id', cid)
        .select()
      const refused = expectError(update.error as DbError, PERMISSION, update.data)
      if (refused) return `owner update: ${refused}`
      const copy = await settingsCopy(cid)
      return copy.royalty_bps === 1500 && copy.state_block === 101 ? null : JSON.stringify(copy)
    },
  )
}

// ---------------------------------------------------------------------------------------------
// 10. Cleanup
// ---------------------------------------------------------------------------------------------
async function cleanup(): Promise<void> {
  await check('cleanup: delete render jobs created by this run', async () => {
    if (createdJobIds.size === 0) return null
    // A credited lock points at the job it rests on (on delete restrict): clear the links first.
    const unlinked = await admin
      .from('render_jobs')
      .update({ credit_job_id: null })
      .in('id', [...createdJobIds])
    if (unlinked.error) return describe(unlinked.error)
    const { error } = await admin
      .from('render_jobs')
      .delete()
      .in('id', [...createdJobIds])
    return error ? describe(error) : null
  })

  await check('cleanup: delete collections created by this run', async () => {
    const owners = [...createdUserIds]
    const { error } = await admin.from('collections').delete().in('owner_id', owners)
    if (error) return describe(error)
    const { data } = await admin.from('collections').select('id').in('owner_id', owners)
    return data && data.length > 0 ? `${data.length} left` : null
  })
  await check('cleanup: delete auth users created by this run', async () => {
    const problems: string[] = []
    for (const id of createdUserIds) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) problems.push(`${id}: ${error.message}`)
    }
    return problems.length ? problems.join('; ') : null
  })
  await check('cleanup: profiles of deleted users are gone', async () => {
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .in('id', [...createdUserIds])
    if (error) return describe(error)
    return data.length ? `${data.length} left` : null
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

console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
