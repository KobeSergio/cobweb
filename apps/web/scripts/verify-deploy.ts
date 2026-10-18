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
// The fixture (scripts/deploy-fixture.ts, shared with verify:phases) reads the settings from the
// environment, `supabase status -o env` and apps/web/.env.local, and refuses non-local endpoints. Never
// prints a key. Deletes every row it creates. Runs under
// `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { createWalletClient, http, parseEther, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  admin,
  CID,
  COLLECTION_CODE_HASH,
  COLLECTION_CREATION_CODE,
  chain,
  chainReady,
  check,
  collectionArgsOf,
  collectionRow,
  collectionSalt,
  confirmDeployCore,
  deploy,
  deployContextFor,
  encodeCollectionArgs,
  factory,
  factoryAbi,
  finishRender,
  nextFileHash,
  predictCollectionAddress,
  prepareCore,
  readDeployment,
  refusal,
  removeFixtures,
  renderCollection,
  rpc,
  runChecks,
  seededCollection,
  settings,
  signIn,
  slugFor,
  trackCollection,
  type DeployForm,
  type DeployRecord,
  type Prepared,
} from './deploy-fixture.ts'

const { ALREADY_DEPLOYED, DEPLOY_USED, NOT_RENDERED, NOT_THIS_DEPLOY, OTHER_CONTRACT, WRONG_CHAIN } =
  await import('../src/lib/art/result.ts')

async function main(): Promise<void> {
  console.log(`Verifying deploy on ${rpc} against ${settings.url}`)
  await check(
    '1. chain: Anvil answers as 31337 and the factory approves the shipped creation code hash',
    chainReady,
  )

  const creatorKey = privateKeyToAccount(generatePrivateKey())
  const stranger = privateKeyToAccount(generatePrivateKey())
  // A third address for the payout, so check 9 tells the payout from the owner (the deployer).
  const payee = privateKeyToAccount(generatePrivateKey())
  await chain.setBalance({ address: creatorKey.address, value: parseEther('10') })
  await chain.setBalance({ address: stranger.address, value: parseEther('10') })
  const creator = await signIn(creatorKey)
  const { client, userId } = creator

  // The rendered collection.
  const rendered = await seededCollection(client, 'rendered')
  await check('2. seed: a generative collection is locked, paid, rendered to done and linked', async () => {
    await renderCollection(creator, rendered)
    const state = await collectionRow(rendered)
    return state.status === 'rendered' && state.slug === slugFor(rendered) ? null : JSON.stringify(state)
  })

  const form: DeployForm = {
    chainId: 31337,
    payout: payee.address,
    royaltyBps: 500,
    royaltyReceiver: stranger.address,
    publicMaxPerWallet: 2,
    groups: [
      { name: 'Public', priceWei: '0', maxSupply: 2 },
      { name: 'Holders', priceWei: '1000000000000000', maxSupply: 1 },
    ],
  }
  let prepared: Prepared | null = null
  let ctx = await deployContextFor(client, userId, creatorKey.address, rendered)

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
        args: [creatorKey.address, COLLECTION_CREATION_CODE, prepared.encodedArgs, prepared.salt],
      })
      const [flat, bps, airdrop] = await chain.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'collectionFees',
      })
      const problems = [
        prepared.chainId === 31337 ? null : `chain ${prepared.chainId}`,
        prepared.factory === factory ? null : `factory ${prepared.factory}`,
        prepared.deployer === creatorKey.address ? null : `deployer ${prepared.deployer}`,
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
    const outcome = await prepareCore(await deployContextFor(client, userId, creatorKey.address, draft), form)
    return refusal(outcome) === NOT_RENDERED ? null : refusal(outcome)
  })

  await check('5. confirmDeployCore: a transaction that deployed nothing is refused', async () => {
    const wallet = createWalletClient({ account: creatorKey, chain: anvil, transport: http(rpc) })
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
      otherHash = await deploy(creatorKey, otherArgs, prepared.salt)
      const outcome = await confirmDeployCore(ctx, otherHash, form)
      if (refusal(outcome) !== OTHER_CONTRACT) return refusal(outcome)
      const record = await readDeployment(client, rendered)
      if (record) return `recorded ${record.contractAddress}`
      return (await collectionRow(rendered)).status === 'rendered' ? null : 'the collection changed'
    },
  )

  let deployHash: Hex | null = null
  await check(
    '7. deploy: the script wallet sends deployCollection with the prepared bytes and the factory records the predicted address',
    async () => {
      if (!prepared) return 'not prepared'
      deployHash = await deploy(creatorKey, prepared.encodedArgs, prepared.salt)
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
      const state = await collectionRow(rendered)
      const problems = [
        record.chainId === 31337 ? null : `chain ${record.chainId}`,
        record.contractAddress === prepared.predicted ? null : `address ${record.contractAddress}`,
        record.txHash === deployHash.toLowerCase() ? null : `hash ${record.txHash}`,
        record.deployer === creatorKey.address ? null : `deployer ${record.deployer}`,
        record.baseUri === prepared.baseUri ? null : `base URI ${record.baseUri}`,
        record.payout === payee.address &&
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
    '9. contract: name, symbol, maxSupply, baseURI, owner (the deployer), payout (a third address), publicMaxMintPerWallet, royaltyInfo and collectionState match the arguments',
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
        owner === creatorKey.address ? null : `owner ${owner}, not the deployer`,
        payout === payee.address ? null : `payout ${payout}, not the third address`,
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
      ctx = await deployContextFor(client, userId, creatorKey.address, rendered)
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
      trackCollection(deferred)
      const set = await client
        .from('collections')
        .update({ art_deferred: true, max_supply: 5 })
        .eq('id', deferred)
      if (set.error) return `deferred: ${set.error.message}`
      const hash = nextFileHash()
      // As the upload action records it: through the service role, for the collection's owner.
      const upload = await admin.rpc('record_upload', {
        p_owner_id: userId,
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
    const dctx = await deployContextFor(client, userId, creatorKey.address, deferred)
    const outcome = await confirmDeployCore(dctx, deployHash, deferredForm)
    if (refusal(outcome) !== DEPLOY_USED) return refusal(outcome)
    return (await collectionRow(deferred)).status === 'draft' ? null : 'the collection changed'
  })

  await check(
    '14. deploy: the deferred collection deploys on the chain the creator picked, on its placeholder base URI, with nothing to reveal to',
    async () => {
      const dctx = await deployContextFor(client, userId, creatorKey.address, deferred)
      const outcome = await prepareCore(dctx, deferredForm)
      if (!('data' in outcome)) return `prepare: ${refusal(outcome)}`
      const dprepared = outcome.data
      if (dprepared.chainId !== 31337) return `chain ${dprepared.chainId}`
      if (dprepared.baseUri !== `ipfs://${CID('q')}/metadata.json`) return `base URI ${dprepared.baseUri}`
      if (dprepared.revealsTo !== null) return `reveals to ${dprepared.revealsTo}`
      const expected = predictCollectionAddress({
        factory,
        deployer: creatorKey.address,
        salt: collectionSalt(deferred),
        creationCode: COLLECTION_CREATION_CODE,
        args: dprepared.encodedArgs,
      })
      if (dprepared.predicted !== expected) return `predicted ${dprepared.predicted}, expected ${expected}`
      const hash = await deploy(creatorKey, dprepared.encodedArgs, dprepared.salt)
      const confirmed = await confirmDeployCore(dctx, hash, deferredForm)
      if (!('data' in confirmed)) return `confirm: ${refusal(confirmed)}`
      const onChain = await chain.readContract({
        address: confirmed.data.contractAddress,
        abi: collectionAbi,
        functionName: 'baseURI',
      })
      const state = await collectionRow(deferred)
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
  await check('15. cleanup: the run leaves no job, deployment, collection or user behind', removeFixtures)
}

await runChecks(main, cleanup)
