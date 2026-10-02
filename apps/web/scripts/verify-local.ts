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

type Collection = {
  id: string
  owner_id: string
  name: string
  slug: string
  status: string
  chain_id: number | null
  contract_address: string | null
  max_supply: number
  updated_at: string
}

function collectionInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Verify',
    symbol: 'VFY',
    slug: slug(),
    project_type: 'generative',
    max_supply: 100,
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

async function slugExists(value: string): Promise<boolean> {
  const { data } = await admin.from('collections').select('id').eq('slug', value)
  return (data?.length ?? 0) > 0
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
  if (await slugExists(input.slug as string)) return 'error returned but a row was stored'
  return null
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
        slug: `verify-${runId}-nowallet`,
        project_type: 'generative',
        max_supply: 10,
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

  // 6. Constraints -----------------------------------------------------------------------------
  await check('constraints: reserved slug "collections" rejected', () =>
    expectRejectedInsert(A.client, { slug: 'collections' }, CHECK),
  )
  await check('constraints: malformed slug rejected', () =>
    expectRejectedInsert(A.client, { slug: `Bad_Slug-${runId}` }, CHECK),
  )
  await check('constraints: slug with trailing hyphen rejected', () =>
    expectRejectedInsert(A.client, { slug: `verify-${runId}-` }, CHECK),
  )
  await check('constraints: lowercase symbol rejected', () =>
    expectRejectedInsert(A.client, { symbol: 'vfy' }, CHECK),
  )
  await check('constraints: duplicate slug rejected', async () => {
    const { data, error } = await A.client
      .from('collections')
      .insert(collectionInput({ slug: colA.slug }))
      .select()
    return expectError(error, UNIQUE, data)
  })
  await check("constraints: duplicate of B's slug rejected for A too", async () => {
    const own = await insertCollection(B.client)
    if (own.error || !own.row) return `B setup: ${describe(own.error)}`
    const { data, error } = await A.client
      .from('collections')
      .insert(collectionInput({ slug: own.row.slug }))
      .select()
    return expectError(error, UNIQUE, data)
  })
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
    const set = await admin.from('collections').update({ status: 'art_locked' }).eq('id', locked.row.id)
    if (set.error) return `service role could not set status: ${describe(set.error)}`
    const { data, error } = await A.client.from('collections').delete().eq('id', locked.row.id).select()
    const problem = expectNothing(error, data)
    if (problem) return problem
    return (await stored(locked.row.id)) ? null : 'row is gone'
  })
  await check('collections: A cannot move a non-draft back to draft (and then delete it)', async () => {
    const locked = await insertCollection(A.client)
    if (!locked.row) return `setup: ${describe(locked.error)}`
    const set = await admin.from('collections').update({ status: 'art_locked' }).eq('id', locked.row.id)
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
        .update({ status: 'deployed', chain_id: 1, contract_address: '0x' + '4'.repeat(40) })
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
}

// ---------------------------------------------------------------------------------------------
// 10. Cleanup
// ---------------------------------------------------------------------------------------------
async function cleanup(): Promise<void> {
  await check('cleanup: delete collections created by this run', async () => {
    const { error } = await admin.from('collections').delete().like('slug', `verify-${runId}-%`)
    if (error) return describe(error)
    const { data } = await admin.from('collections').select('id').like('slug', `verify-${runId}-%`)
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
