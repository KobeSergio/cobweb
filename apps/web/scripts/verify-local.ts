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
  // something to (not) see in every table.
  const groupInsert = await A.client
    .from('mint_groups')
    .insert({ collection_id: colA.id, onchain_id: 1, name: 'Allowlist', price_wei: '1000000000000000' })
    .select()
    .single()
  await check('mint_groups: A creates a group under their own collection', async () =>
    groupInsert.error ? describe(groupInsert.error) : null,
  )
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

  for (const table of ['profiles', 'collections', 'mint_groups', 'whitelist_entries']) {
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
    ? await B.client
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
  await check('whitelist_entries: quota 0 rejected', async () => {
    if (!groupA) return 'no group'
    const { data, error } = await A.client
      .from('whitelist_entries')
      .insert({
        mint_group_id: groupA.id,
        collection_id: colA.id,
        wallet_address: '0x' + 'd'.repeat(40),
        quota: 0,
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

  {
    const deployed = await insertCollection(A.client)
    if (deployed.row) {
      await admin
        .from('collections')
        .update({ status: 'deployed', max_supply: 100, chain_id: 1, contract_address: '0x' + '4'.repeat(40) })
        .eq('id', deployed.row.id)
      const upd = await A.client
        .from('collections')
        .update({ max_supply: 5 })
        .eq('id', deployed.row.id)
        .select()
      const grp = await A.client
        .from('mint_groups')
        .insert({ collection_id: deployed.row.id, onchain_id: 9, name: 'Late' })
        .select()
      info(
        `on a deployed collection the owner can still change max_supply: ${!upd.error && upd.data.length === 1}` +
          `, add mint groups: ${!grp.error}`,
      )
    }
  }

  await artFoundation(A, B)
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
      storage_key: `${first.storage_key}-again`,
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
// 10. Cleanup
// ---------------------------------------------------------------------------------------------
async function cleanup(): Promise<void> {
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
