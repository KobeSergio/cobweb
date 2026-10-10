// Checks lock and pay against a LOCAL Anvil chain and LOCAL Supabase (docs/specs/2026-10-09-lock-and-pay.md,
// section 10): a signed-in creator locks a seeded generative collection through the same core the
// lockArt action runs, pays payForArt from the quote's wallet with the exact total, and the
// confirmArtPayment core marks the job paid; then the refusals: another wallet, a short payment,
// the same hash again, a hash that was never sent. Start the chain first:
//
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:chain
//
// Supabase settings come from the environment or `supabase status -o env`; RPC_URL_31337 and
// FACTORY_ADDRESS_31337 from the environment or apps/web/.env.local. Refuses non-local endpoints.
// Never prints a key. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
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
import type { RenderJob } from '../src/lib/demo/types.ts'

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

function config(envName: string, statusNames: string[]): string {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const status = supabaseStatus()
  for (const name of statusNames) if (status[name]) return status[name]
  throw new Error(`${envName} is unset and \`supabase status\` did not report ${statusNames.join(' or ')}`)
}

const { factoryAbi, isLocalUrl } = await import('@cobweb/shared')

const url = config('NEXT_PUBLIC_SUPABASE_URL', ['API_URL'])
const publishableKey = config('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['PUBLISHABLE_KEY', 'ANON_KEY'])
const serviceKey = config('SUPABASE_SERVICE_ROLE_KEY', ['SERVICE_ROLE_KEY', 'SECRET_KEY'])
const rpc = process.env.RPC_URL_31337
const factoryEnv = process.env.FACTORY_ADDRESS_31337
if (!rpc || !factoryEnv) {
  console.error(
    'Set RPC_URL_31337 and FACTORY_ADDRESS_31337: run `pnpm --filter @cobweb/web chain:local` and copy its two lines into apps/web/.env.local.',
  )
  process.exit(2)
}
for (const endpoint of [url, rpc])
  if (!isLocalUrl(endpoint)) {
    console.error(`Refusing to run: ${endpoint} is not local (expected localhost or 127.0.0.1).`)
    process.exit(2)
  }
const factory = getAddress(factoryEnv)

// Imported after the environment is set, so the shared clients read the local chain settings.
const { confirmCore, lockCore } = await import('../src/lib/art/lock-core.ts')
const { readLockCollection } = await import('../src/lib/art/lock-collection.ts')
const { quoteTotalWei } = await import('../src/lib/art/quote.ts')
const { NOT_CONFIRMED, OTHER_WALLET, PAYMENT_USED, SHORT_PAYMENT } = await import('../src/lib/art/result.ts')
type LockContext = import('../src/lib/art/lock-core.ts').LockContext
type LockOutcome<T> = import('../src/lib/art/lock-core.ts').LockOutcome<T>

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient<Database>(url, serviceKey, clientOptions)
const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(publicActions)

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

async function signIn(account: PrivateKeyAccount) {
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
  const signature = await account.signMessage({ message })
  const { data, error } = await client.auth.signInWithWeb3({ chain: 'ethereum', message, signature })
  if (error || !data.user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`)
  userIds.push(data.user.id)
  return { client, userId: data.user.id }
}

const HEX64 = (n: number) => n.toString(16).padStart(64, '0')
let fileCount = 0

/** A generative collection of three tokens over two layers of two traits, owned by the client's creator. */
async function seededCollection(client: ReturnType<typeof createClient<Database>>): Promise<string> {
  const { data: col, error } = await client
    .from('collections')
    .insert({ name: `Chain check ${Date.now()} ${++fileCount}`, symbol: 'CHK', project_type: 'generative' })
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
  for (const [position, name] of ['Background', 'Eyes'].entries()) {
    const layer = await client
      .from('layers')
      .insert({ collection_id: cid, art_collection_id: artId, name, position })
      .select('id')
      .single()
    if (layer.error || !layer.data) throw new Error(`layer: ${layer.error?.message ?? 'no row'}`)
    const ids: string[] = []
    for (const [index, traitName] of ['One', 'Two'].entries()) {
      const hash = HEX64(++fileCount)
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

/** The context `lockWrite` builds: the creator's RLS client, the service client, the owner's id. */
async function contextFor(
  client: ReturnType<typeof createClient<Database>>,
  owner: string,
  wallet: string,
  cid: string,
): Promise<LockContext> {
  const collection = await readLockCollection(client, cid)
  if (!collection || collection.owner_id !== owner) throw new Error('the creator cannot read the collection')
  return { supabase: client, service: () => admin, owner, wallet: wallet.toLowerCase(), collection }
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

async function main(): Promise<void> {
  console.log(`Verifying lock and pay on ${rpc} against ${url}`)
  await check('chain: Anvil answers as 31337 and the factory has code and a rate', async () => {
    if ((await chain.getChainId()) !== 31337) return 'not chain 31337'
    const code = await chain.getCode({ address: factory })
    if (!code || code === '0x') return `no contract at ${factory}; run chain:local again`
    const rate = await chain.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: 'artFeePerToken',
    })
    return rate > 0n ? null : 'the factory rate is 0'
  })

  const creator = privateKeyToAccount(generatePrivateKey())
  const stranger = privateKeyToAccount(generatePrivateKey())
  await chain.setBalance({ address: creator.address, value: parseEther('10') })
  await chain.setBalance({ address: stranger.address, value: parseEther('10') })
  const { client, userId } = await signIn(creator)

  const first = await contextFor(client, userId, creator.address, await seededCollection(client))
  let job1: RenderJob | null = null
  let paidHash: Hex | null = null

  await check('lockArt: the creator locks a three-token set, quoted from the factory rate', async () => {
    const outcome = await lockCore(first, { allowDuplicates: false, chainId: 31337 })
    if (!('data' in outcome)) return refusal(outcome)
    job1 = outcome.data
    const rate = await chain.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: 'artFeePerToken',
    })
    const want = quoteTotalWei('generative', rate, 3).toString()
    return job1.state === 'payment_due' &&
      job1.quote.totalWei === want &&
      job1.quote.payer === creator.address.toLowerCase() &&
      job1.quote.factory === factory
      ? null
      : JSON.stringify({ state: job1.state, quote: job1.quote, want })
  })

  await check(
    'pay: payForArt from the quote wallet with the exact total; confirm marks the job paid',
    async () => {
      if (!job1) return 'no job'
      paidHash = await pay(creator, job1.jobId, BigInt(job1.quote.totalWei))
      const outcome = await confirmCore(first, job1.id, paidHash)
      if (!('data' in outcome)) return refusal(outcome)
      const job = outcome.data
      return job.state === 'paid' &&
        'payment' in job &&
        job.payment?.txHash === paidHash &&
        job.payment.amountWei === job1.quote.totalWei
        ? null
        : JSON.stringify(job)
    },
  )

  const second = await contextFor(client, userId, creator.address, await seededCollection(client))
  let job2: RenderJob | null = null
  await check('lockArt: a second collection locks for the refusals', async () => {
    const outcome = await lockCore(second, { allowDuplicates: false, chainId: 31337 })
    if (!('data' in outcome)) return refusal(outcome)
    job2 = outcome.data
    return job2.state === 'payment_due' ? null : job2.state
  })

  await check('confirm: a payment from another wallet is refused', async () => {
    if (!job2) return 'no job'
    const hash = await pay(stranger, job2.jobId, BigInt(job2.quote.totalWei))
    const outcome = await confirmCore(second, job2.id, hash)
    return refusal(outcome) === OTHER_WALLET ? null : refusal(outcome)
  })

  await check(
    'confirm: a payment short of the quote is refused and recorded, the job stays due',
    async () => {
      if (!job2) return 'no job'
      const hash = await pay(creator, job2.jobId, BigInt(job2.quote.totalWei) - 1n)
      const outcome = await confirmCore(second, job2.id, hash)
      const sentence = refusal(outcome)
      if (!sentence.startsWith(SHORT_PAYMENT)) return sentence
      if (!sentence.includes(job2.jobId)) return `the sentence does not name the job: ${sentence}`
      const row = await admin.from('render_jobs').select('state, payment_tx_hash').eq('id', job2.id).single()
      if (row.error) return row.error.message
      return row.data.state === 'payment_due' && row.data.payment_tx_hash === hash.toLowerCase()
        ? null
        : JSON.stringify(row.data)
    },
  )

  await check('confirm: the same hash a second time is refused', async () => {
    if (!job1 || !paidHash) return 'no payment'
    const outcome = await confirmCore(first, job1.id, paidHash)
    return refusal(outcome) === PAYMENT_USED ? null : refusal(outcome)
  })

  await check('confirm: a hash that was never sent is not confirmed', async () => {
    if (!job2) return 'no job'
    const outcome = await confirmCore(second, job2.id, `0x${'ab'.repeat(32)}`)
    return refusal(outcome) === NOT_CONFIRMED ? null : refusal(outcome)
  })
}

async function cleanup(): Promise<void> {
  await check('cleanup: the run leaves no job, collection or user behind', async () => {
    if (collectionIds.length) {
      const jobs = await admin.from('render_jobs').delete().in('collection_id', collectionIds)
      if (jobs.error) return `jobs: ${jobs.error.message}`
      const cols = await admin.from('collections').delete().in('id', collectionIds)
      if (cols.error) return `collections: ${cols.error.message}`
    }
    for (const id of userIds) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) return error.message
    }
    return null
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
