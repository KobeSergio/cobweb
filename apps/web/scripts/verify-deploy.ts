// Checks Deploy against a LOCAL Anvil chain and LOCAL Supabase (docs/specs/2026-10-14-deploy.md,
// section 10): a signed-in creator's generative collection is locked, paid and rendered to done through
// the same cores and functions the app uses; prepareCore answers the paid chain, the prediction (which
// the factory's own view agrees with) and the fees; the script wallet sends deployCollection with the
// prepared bytes; confirmDeployCore records the contract, the launch phases and the permanent link from
// the factory's event; the contract's views match the arguments; then the refusals: another chain, a
// draft with nothing rendered, an unrelated transaction, a contract deployed with other arguments, a
// second confirm (idempotent), a deployed collection, a hash recorded for another collection; and a
// deferred collection deploying on its placeholder base URI. Fifteen PASS lines with the cleanup.
//
//   supabase start
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:deploy
//
// Settings come from scripts/render-deps.ts (the environment, `supabase status -o env` and
// apps/web/.env.local); it refuses non-local endpoints. Never prints a key. Deletes every row it
// creates. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { createClient } from '@supabase/supabase-js'
import {
  createTestClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  publicActions,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { RenderQueue } from '@cobweb/shared/render-queue'
import type { Database } from '../src/lib/database.types.ts'
import { adminClient, clientOptions, localConfig, type LocalClient } from './render-deps.ts'

// Every local setting, with non-local endpoints refused (scripts/render-deps.ts). It also fills the
// environment the shared chain clients read (RPC_URL_31337, FACTORY_ADDRESS_31337).
const settings = localConfig()
const { url, publishableKey, rpc, factory } = settings

// Imported after the environment is set, so the shared clients read the local chain settings.
const { collectionSalt, encodeCollectionArgs, factoryAbi, predictCollectionAddress } =
  await import('@cobweb/shared')
const { COLLECTION_CODE_HASH, COLLECTION_CREATION_CODE, collectionAbi } =
  await import('@cobweb/shared/collection')
const { confirmCore, lockCore } = await import('../src/lib/art/lock-core.ts')
const { readLockCollection } = await import('../src/lib/art/lock-collection.ts')
const { confirmDeployCore, prepareCore, readDeployment } = await import('../src/lib/deploy/deploy-core.ts')
const { collectionArgsOf } = await import('../src/lib/deploy/deploy-args.ts')
const { ALREADY_DEPLOYED, DEPLOY_USED, NOT_RENDERED, NOT_THIS_DEPLOY, OTHER_CONTRACT, WRONG_CHAIN } =
  await import('../src/lib/art/result.ts')
type LockContext = import('../src/lib/art/lock-core.ts').LockContext
type DeployContext = import('../src/lib/deploy/deploy-core.ts').DeployContext
type DeployOutcome<T> = import('../src/lib/deploy/deploy-core.ts').DeployOutcome<T>
type DeployForm = import('../src/lib/deploy/deploy-types.ts').DeployForm
type Prepared = import('../src/lib/deploy/deploy-types.ts').Prepared
type DeployRecord = import('../src/lib/deploy/deploy-types.ts').DeployRecord

const admin: LocalClient = adminClient(settings)
const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(publicActions)
/** A queue that sends nothing: the render is driven by hand below, not by a worker. */
const silentQueue: RenderQueue = { send: async () => {} }
const CID = (letter: string) => `bafybei${letter.repeat(52)}`
/** The factory's approval view, which the shipped ABI leaves out (the app never asks it); one entry for check 1. */
const approvalAbi = parseAbi(['function isCreationCodeApproved(bytes32 codeHash) view returns (bool)'])

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
  const client: LocalClient = createClient<Database>(url, publishableKey, clientOptions)
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
async function seededCollection(client: LocalClient, name: string): Promise<string> {
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

/** The context `lockWrite` builds, re-read from the row each time so the status is current. */
async function lockContextFor(
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

/** The context `deployWrite` builds: the same read, without the queue. */
async function deployContextFor(
  client: LocalClient,
  owner: string,
  wallet: string,
  cid: string,
): Promise<DeployContext> {
  const { queue: _queue, ...context } = await lockContextFor(client, owner, wallet, cid)
  void _queue
  return context
}

const refusal = <T>(outcome: DeployOutcome<T>) =>
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

/** The render functions with the service role, from a paid (or placeholder) job to done, as the worker would. */
async function finishRender(
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
async function deploy(account: PrivateKeyAccount, encodedArgs: Hex, salt: Hex): Promise<Hex> {
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

type CollectionState = {
  status: string
  chain_id: number | null
  contract_address: string | null
  slug: string | null
  slug_reserved_at: string | null
}

async function collectionState(cid: string): Promise<CollectionState> {
  const { data, error } = await admin
    .from('collections')
    .select('status, chain_id, contract_address, slug, slug_reserved_at')
    .eq('id', cid)
    .single()
  if (error) throw new Error(`collection state: ${error.message}`)
  return data
}

async function main(): Promise<void> {
  console.log(`Verifying deploy on ${rpc} against ${url}`)
  await check(
    '1. chain: Anvil answers as 31337 and the factory approves the shipped creation code hash',
    async () => {
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
    },
  )

  const creator = privateKeyToAccount(generatePrivateKey())
  const stranger = privateKeyToAccount(generatePrivateKey())
  await chain.setBalance({ address: creator.address, value: parseEther('10') })
  await chain.setBalance({ address: stranger.address, value: parseEther('10') })
  const { client, userId } = await signIn(creator)
  const slugFor = (cid: string) => `deploy-${cid.slice(0, 8)}`

  // The rendered collection.
  const rendered = await seededCollection(client, 'rendered')
  await check('2. seed: a generative collection is locked, paid, rendered to done and linked', async () => {
    const lockCtx = await lockContextFor(client, userId, creator.address, rendered)
    const locked = await lockCore(lockCtx, { allowDuplicates: false, chainId: 31337 })
    if (!('data' in locked)) return `lock: ${refusal(locked)}`
    const job = locked.data
    const paidHash = await pay(creator, job.jobId, BigInt(job.quote.totalWei))
    const confirmed = await confirmCore(lockCtx, job.id, paidHash)
    if (!('data' in confirmed)) return `pay: ${refusal(confirmed)}`
    if (confirmed.data.state !== 'paid') return `job ${confirmed.data.state}`
    const rendering = await finishRender(job.id, CID('d'), CID('e'), `ipfs://${CID('e')}/`)
    if (rendering) return rendering
    const link = await client.rpc('reserve_slug', { p_collection_id: rendered, p_slug: slugFor(rendered) })
    if (link.error) return `link: ${link.error.message}`
    const state = await collectionState(rendered)
    return state.status === 'rendered' && state.slug === slugFor(rendered) ? null : JSON.stringify(state)
  })

  const form: DeployForm = {
    chainId: 31337,
    payout: creator.address,
    royaltyBps: 500,
    royaltyReceiver: stranger.address,
    publicMaxPerWallet: 2,
    groups: [
      { name: 'Public', priceWei: '0', maxSupply: 2 },
      { name: 'Holders', priceWei: '1000000000000000', maxSupply: 1 },
    ],
  }
  let prepared: Prepared | null = null
  let ctx = await deployContextFor(client, userId, creator.address, rendered)

  await check(
    '3. prepareCore: answers the paid chain, the prediction the factory agrees with, the base URI and the fees, and refuses another chain',
    async () => {
      const outcome = await prepareCore(ctx, form)
      if (!('data' in outcome)) return refusal(outcome)
      prepared = outcome.data
      const fromFactory = await chain.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'predictCollectionAddress',
        args: [creator.address, COLLECTION_CREATION_CODE, prepared.encodedArgs, prepared.salt],
      })
      const [flat, bps, airdrop] = await chain.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'collectionFees',
      })
      const problems = [
        prepared.chainId === 31337 ? null : `chain ${prepared.chainId}`,
        prepared.factory === factory ? null : `factory ${prepared.factory}`,
        prepared.deployer === creator.address ? null : `deployer ${prepared.deployer}`,
        prepared.salt === collectionSalt(rendered) ? null : `salt ${prepared.salt}`,
        prepared.codeHash === COLLECTION_CODE_HASH ? null : `code hash ${prepared.codeHash}`,
        prepared.predicted === fromFactory
          ? null
          : `predicted ${prepared.predicted}, the factory says ${fromFactory}`,
        prepared.baseUri === `ipfs://${CID('e')}/` ? null : `base URI ${prepared.baseUri}`,
        prepared.revealsTo === null ? null : `reveals to ${prepared.revealsTo}`,
        prepared.fees.mintFeeFlatWei === flat.toString() &&
        prepared.fees.mintFeeBps === Number(bps) &&
        prepared.fees.airdropFeePerTokenWei === airdrop.toString()
          ? null
          : `fees ${JSON.stringify(prepared.fees)}`,
        prepared.args.name !== '' && prepared.args.symbol === 'DPL' && prepared.args.maxSupply === '3'
          ? null
          : `args ${JSON.stringify(prepared.args)}`,
      ].filter(Boolean)
      if (problems.length) return problems.join('; ')
      const elsewhere = await prepareCore(ctx, { ...form, chainId: 1 })
      return refusal(elsewhere) === WRONG_CHAIN ? null : `another chain: ${refusal(elsewhere)}`
    },
  )

  await check('4. prepareCore: a draft collection with nothing rendered is refused', async () => {
    const draft = await seededCollection(client, 'draft')
    const supply = await client.from('collections').update({ max_supply: 3 }).eq('id', draft)
    if (supply.error) return `supply: ${supply.error.message}`
    const link = await client.rpc('reserve_slug', { p_collection_id: draft, p_slug: slugFor(draft) })
    if (link.error) return `link: ${link.error.message}`
    const outcome = await prepareCore(await deployContextFor(client, userId, creator.address, draft), form)
    return refusal(outcome) === NOT_RENDERED ? null : refusal(outcome)
  })

  await check('5. confirmDeployCore: a transaction that deployed nothing is refused', async () => {
    const wallet = createWalletClient({ account: creator, chain: anvil, transport: http(rpc) })
    const hash = await wallet.sendTransaction({ to: stranger.address, value: 1n })
    await chain.waitForTransactionReceipt({ hash })
    const outcome = await confirmDeployCore(ctx, hash, form)
    return refusal(outcome) === NOT_THIS_DEPLOY ? null : refusal(outcome)
  })

  let otherHash: Hex | null = null
  await check(
    '6. confirmDeployCore: a contract deployed from the prepared bytes with other arguments is refused and never recorded',
    async () => {
      if (!prepared) return 'not prepared'
      const otherArgs = encodeCollectionArgs(collectionArgsOf({ ...prepared.args, royaltyBps: 600 }))
      otherHash = await deploy(creator, otherArgs, prepared.salt)
      const outcome = await confirmDeployCore(ctx, otherHash, form)
      if (refusal(outcome) !== OTHER_CONTRACT) return refusal(outcome)
      const record = await readDeployment(client, rendered)
      if (record) return `recorded ${record.contractAddress}`
      return (await collectionState(rendered)).status === 'rendered' ? null : 'the collection changed'
    },
  )

  let deployHash: Hex | null = null
  await check(
    '7. deploy: the script wallet sends deployCollection with the prepared bytes and the factory records the predicted address',
    async () => {
      if (!prepared) return 'not prepared'
      deployHash = await deploy(creator, prepared.encodedArgs, prepared.salt)
      const isCollection = await chain.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'isCollection',
        args: [prepared.predicted],
      })
      return isCollection ? null : `the factory does not know ${prepared.predicted}`
    },
  )

  let record: DeployRecord | null = null
  await check(
    '8. confirmDeployCore: records the contract, the launch phases and the permanent link; the collection reads deployed on its chain',
    async () => {
      if (!prepared || !deployHash) return 'not deployed'
      const outcome = await confirmDeployCore(ctx, deployHash, form)
      if (!('data' in outcome)) return refusal(outcome)
      record = outcome.data
      const state = await collectionState(rendered)
      const problems = [
        record.chainId === 31337 ? null : `chain ${record.chainId}`,
        record.contractAddress === prepared.predicted ? null : `address ${record.contractAddress}`,
        record.txHash === deployHash.toLowerCase() ? null : `hash ${record.txHash}`,
        record.deployer === creator.address ? null : `deployer ${record.deployer}`,
        record.baseUri === prepared.baseUri ? null : `base URI ${record.baseUri}`,
        record.payout === creator.address &&
        record.royaltyReceiver === stranger.address &&
        record.royaltyBps === 500
          ? null
          : 'payout or royalty',
        record.publicMaxPerWallet === 2 ? null : `cap ${record.publicMaxPerWallet}`,
        JSON.stringify(record.fees) === JSON.stringify(prepared.fees)
          ? null
          : `fees ${JSON.stringify(record.fees)}`,
        JSON.stringify(record.groups) ===
        JSON.stringify([
          { onchainId: 0, name: 'Public', priceWei: '0', maxSupply: 2 },
          { onchainId: 1, name: 'Holders', priceWei: '1000000000000000', maxSupply: 1 },
        ])
          ? null
          : `groups ${JSON.stringify(record.groups)}`,
        state.status === 'deployed' && state.chain_id === 31337
          ? null
          : `collection ${JSON.stringify(state)}`,
        state.contract_address === prepared.predicted.toLowerCase()
          ? null
          : `contract ${state.contract_address}`,
        state.slug === slugFor(rendered) && state.slug_reserved_at === null
          ? null
          : `link ${state.slug} ${state.slug_reserved_at}`,
      ].filter(Boolean)
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    '9. contract: name, symbol, maxSupply, baseURI, owner, payout, publicMaxMintPerWallet, royaltyInfo and collectionState match the arguments',
    async () => {
      if (!prepared) return 'not prepared'
      const address = prepared.predicted
      const name = await chain.readContract({ address, abi: collectionAbi, functionName: 'name' })
      const symbol = await chain.readContract({ address, abi: collectionAbi, functionName: 'symbol' })
      const maxSupply = await chain.readContract({ address, abi: collectionAbi, functionName: 'maxSupply' })
      const baseURI = await chain.readContract({ address, abi: collectionAbi, functionName: 'baseURI' })
      const owner = await chain.readContract({ address, abi: collectionAbi, functionName: 'owner' })
      const payout = await chain.readContract({
        address,
        abi: collectionAbi,
        functionName: 'ownerPayoutAddress',
      })
      const cap = await chain.readContract({
        address,
        abi: collectionAbi,
        functionName: 'publicMaxMintPerWallet',
      })
      const [receiver, royalty] = await chain.readContract({
        address,
        abi: collectionAbi,
        functionName: 'royaltyInfo',
        args: [1n, 10_000n],
      })
      const state = await chain.readContract({ address, abi: collectionAbi, functionName: 'collectionState' })
      const problems = [
        name === prepared.args.name ? null : `name ${name}`,
        symbol === 'DPL' ? null : `symbol ${symbol}`,
        maxSupply === 3n ? null : `maxSupply ${maxSupply}`,
        baseURI === prepared.baseUri ? null : `baseURI ${baseURI}`,
        owner === creator.address ? null : `owner ${owner}`,
        payout === creator.address ? null : `payout ${payout}`,
        cap === 2n ? null : `cap ${cap}`,
        receiver === stranger.address && royalty === 500n ? null : `royalty ${receiver} ${royalty}`,
        state.groups.length === 2 &&
        state.groups[0]?.price === 0n &&
        state.groups[0]?.maxSupply === 2n &&
        state.groups[1]?.price === 1_000_000_000_000_000n &&
        state.groups[1]?.maxSupply === 1n &&
        state.groups.every((group) => !group.active && !group.activeFlag)
          ? null
          : `groups ${JSON.stringify(state.groups, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
        state.maxSupply === 3n && state.totalMinted === 0n ? null : 'state supply',
      ].filter(Boolean)
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    '10. confirmDeployCore: a second confirm with the same hash answers the record unchanged',
    async () => {
      if (!deployHash || !record) return 'not recorded'
      ctx = await deployContextFor(client, userId, creator.address, rendered)
      const again = await confirmDeployCore(ctx, deployHash, form)
      if (!('data' in again)) return refusal(again)
      return JSON.stringify(again.data) === JSON.stringify(record)
        ? null
        : `changed: ${JSON.stringify(again.data)}`
    },
  )

  await check(
    '11. prepareCore and confirmDeployCore: a deployed collection is refused as already deployed',
    async () => {
      if (!otherHash) return 'no other hash'
      const prepare = await prepareCore(ctx, form)
      if (refusal(prepare) !== ALREADY_DEPLOYED) return `prepare: ${refusal(prepare)}`
      const confirm = await confirmDeployCore(ctx, otherHash, form)
      return refusal(confirm) === ALREADY_DEPLOYED ? null : `confirm: ${refusal(confirm)}`
    },
  )

  // The deferred collection.
  let deferred = ''
  await check(
    '12. seed: a deferred collection with its placeholder rendered, a supply and a live link',
    async () => {
      const { data: col, error } = await client
        .from('collections')
        .insert({ name: `Deploy check deferred ${Date.now()}`, symbol: 'DPL', project_type: 'generative' })
        .select('id')
        .single()
      if (error || !col) return `collection: ${error?.message ?? 'no row'}`
      deferred = col.id
      collectionIds.push(deferred)
      const set = await client
        .from('collections')
        .update({ art_deferred: true, max_supply: 5 })
        .eq('id', deferred)
      if (set.error) return `deferred: ${set.error.message}`
      const hash = HEX64(++fileCount)
      const upload = await client.rpc('record_upload', {
        p_collection_id: deferred,
        p_kind: 'placeholder',
        p_storage_key: `${deferred}/placeholder/${hash}.png`,
        p_content_hash: hash,
        p_mime: 'image/png',
        p_media_type: 'image',
        p_bytes: 1234,
        p_width: 1000,
        p_height: 1000,
        p_file_name: 'placeholder.png',
      })
      if (upload.error) return `upload: ${upload.error.message}`
      const lock = await client.rpc('art_lock_placeholder', {
        p_collection_id: deferred,
        p_placeholder_upload_id: upload.data as string,
      })
      if (lock.error) return `placeholder lock: ${lock.error.message}`
      const jobId = (lock.data as { id: string }).id
      const rendering = await finishRender(
        jobId,
        CID('p'),
        CID('q'),
        `ipfs://${CID('q')}/metadata.json`,
        CID('p'),
      )
      if (rendering) return rendering
      const link = await client.rpc('reserve_slug', { p_collection_id: deferred, p_slug: slugFor(deferred) })
      if (link.error) return `link: ${link.error.message}`
      const ready = await client.rpc('collection_placeholder_ready', { p_collection_id: deferred })
      if (ready.error) return `ready: ${ready.error.message}`
      return ready.data === true ? null : 'the placeholder is not ready'
    },
  )

  const deferredForm: DeployForm = { ...form, groups: [{ name: 'Public', priceWei: '0', maxSupply: 5 }] }
  await check('13. confirmDeployCore: a transaction recorded for another collection is refused', async () => {
    if (!deployHash) return 'not deployed'
    const dctx = await deployContextFor(client, userId, creator.address, deferred)
    const outcome = await confirmDeployCore(dctx, deployHash, deferredForm)
    if (refusal(outcome) !== DEPLOY_USED) return refusal(outcome)
    return (await collectionState(deferred)).status === 'draft' ? null : 'the collection changed'
  })

  await check(
    '14. deploy: the deferred collection deploys on the chain the creator picked, on its placeholder base URI, with nothing to reveal to',
    async () => {
      const dctx = await deployContextFor(client, userId, creator.address, deferred)
      const outcome = await prepareCore(dctx, deferredForm)
      if (!('data' in outcome)) return `prepare: ${refusal(outcome)}`
      const dprepared = outcome.data
      if (dprepared.chainId !== 31337) return `chain ${dprepared.chainId}`
      if (dprepared.baseUri !== `ipfs://${CID('q')}/metadata.json`) return `base URI ${dprepared.baseUri}`
      if (dprepared.revealsTo !== null) return `reveals to ${dprepared.revealsTo}`
      const expected = predictCollectionAddress({
        factory,
        deployer: creator.address,
        salt: collectionSalt(deferred),
        creationCode: COLLECTION_CREATION_CODE,
        args: dprepared.encodedArgs,
      })
      if (dprepared.predicted !== expected) return `predicted ${dprepared.predicted}, expected ${expected}`
      const hash = await deploy(creator, dprepared.encodedArgs, dprepared.salt)
      const confirmed = await confirmDeployCore(dctx, hash, deferredForm)
      if (!('data' in confirmed)) return `confirm: ${refusal(confirmed)}`
      const onChain = await chain.readContract({
        address: confirmed.data.contractAddress,
        abi: collectionAbi,
        functionName: 'baseURI',
      })
      const state = await collectionState(deferred)
      return confirmed.data.contractAddress === dprepared.predicted &&
        onChain === `ipfs://${CID('q')}/metadata.json` &&
        state.status === 'deployed' &&
        state.chain_id === 31337 &&
        confirmed.data.groups.length === 1
        ? null
        : `${JSON.stringify(confirmed.data)} ${onChain} ${JSON.stringify(state)}`
    },
  )
}

async function cleanup(): Promise<void> {
  await check('15. cleanup: the run leaves no job, deployment, collection or user behind', async () => {
    if (collectionIds.length) {
      const jobs = await admin.from('render_jobs').delete().in('collection_id', collectionIds)
      if (jobs.error) return `jobs: ${jobs.error.message}`
      const cols = await admin.from('collections').delete().in('id', collectionIds)
      if (cols.error) return `collections: ${cols.error.message}`
      const left = await admin.from('deployments').select('collection_id').in('collection_id', collectionIds)
      if (left.error) return `deployments: ${left.error.message}`
      if (left.data.length) return `${left.data.length} deployment(s) left`
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
