// Checks the indexer in the freshness server against LOCAL Supabase, a LOCAL Anvil chain and the server in process
// (docs/specs/2026-10-16-indexer-overview.md, section 10): a creator deploys a collection of three tokens through
// the cores with Public (0.001 ETH, 2, 1 per wallet) and Holders (free, 1); the server runs with its indexer on
// fast intervals; then a mint, an airdrop through Cobweb, a burn and a withdrawal sent straight from the creator's
// wallet, and a transfer, each read back from the indexer's tables, the state body, the Overview's and Airdrop's
// cores; then a replay, a restart and a backfill over 1,200 empty blocks, /health and the stop. Fifteen PASS
// lines with the cleanup.
//
//   supabase start
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:indexer
//
// The fixture (scripts/deploy-fixture.ts) reads the settings from the environment, `supabase status -o env` and
// apps/web/.env.local, and refuses non-local endpoints. The server's database is the local one, with the service
// role key the fixture read; the script prints no key and no URL, and a thrown error prints viem's short message
// or its first line (chain-fixture.ts). Stop any other indexer on the same database first (a running
// `pnpm --filter @cobweb/freshness dev` with the two variables set): it would race checks 11, 13 and 15. The
// indexer reads every collection deployed on Anvil the database lists, the earlier walks' among them, so each
// server start logs once each one whose deploy is not on this chain, and the cursors it starts or moves for them
// stay. The cleanup closes the server and deletes the run's own rows: its collection's, with the indexer's for
// it. What stays is on Anvil: the collection with its mint, airdrop, burn, withdrawal and two transfers, the three
// fresh accounts, 1,200 more blocks and the chain's clock about 1,200 s ahead. Runs under
// `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { isAddressEqual, parseEther, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { statePath, type StateBody } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  startFreshness,
  type Freshness,
  type HealthBody,
  type IndexerOptions,
} from '@cobweb/freshness/server'
import type { PhasesContext } from '../src/lib/manage/phases-core.ts'
import {
  admin,
  chain,
  chainReady,
  check,
  deployedCollection,
  failureLine,
  readLockCollection,
  removeFixtures,
  rpc,
  runChecks,
  sendCall,
  sendRequest,
  setAirdropFee,
  settings,
  signIn,
  type Creator,
  type Deployed,
  type DeployForm,
} from './deploy-fixture.ts'

const { activityViewCore } = await import('../src/lib/manage/activity-core.ts')
const { paidByMintersOf } = await import('../src/lib/manage/activity-view.ts')
const { airdropRecipientsAllCore, airdropRecipientsCore, airdropViewCore, confirmAirdropCore } =
  await import('../src/lib/manage/airdrop-core.ts')
const { BURN_ADDRESS, recipientsCsvRows } = await import('../src/lib/manage/airdrop-view.ts')
const { airdropCalls, phaseCalls, settingsCalls } = await import('../src/lib/manage/phase-calls.ts')
const { phasesViewCore } = await import('../src/lib/manage/phases-core.ts')
const { settingsViewCore } = await import('../src/lib/manage/settings-core.ts')
const { NOT_FOUND } = await import('../src/lib/art/result.ts')

/** The launch groups: Public (id 0) and Holders (id 1). */
const PUBLIC = 0
const PUBLIC_PRICE = 1_000_000_000_000_000n
/** The airdrop fee the platform admin sets (`setAirdropFee`): 0.0001 ETH a token, so the burn pays one. */
const FEE = 100_000_000_000_000n
/** The indexer on fast intervals, so each change is read within about a second. */
const INDEXER: IndexerOptions = {
  supabaseUrl: settings.url,
  serviceRoleKey: settings.serviceKey,
  passMs: { behind: 200, fast: 500, idle: 500 },
  targetsEveryMs: 1_000,
}
/** How long a change may take to reach the tables: a pass, a write and the reads. */
const RECORDED_WITHIN_MS = 5_000
/** How long a server started again may take to answer the activity. */
const ACTIVITY_WITHIN_MS = 2_000
/** How long one request to the server may take. */
const REQUEST_TIMEOUT_MS = 5_000
const DEAD = BURN_ADDRESS.toLowerCase()

const creatorKey = privateKeyToAccount(generatePrivateKey())
const holderKey = privateKeyToAccount(generatePrivateKey())
const strangerKey = privateKeyToAccount(generatePrivateKey())
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const lower = (address: Address) => address.toLowerCase()
const sameTime = (a: string | null | undefined, seconds: number) => !!a && Date.parse(a) === seconds * 1_000

/** The value `read` answers within `ms`, polled every 100 ms, or null. */
async function until<T>(read: () => Promise<T | null | undefined | false>, ms: number): Promise<T | null> {
  const end = performance.now() + ms
  for (;;) {
    const value = await read()
    if (value) return value
    if (performance.now() >= end) return null
    await wait(100)
  }
}

let freshness: Freshness | null = null

/** The freshness server in process, serving Anvil alone, with its indexer on. */
async function startServer(): Promise<Freshness> {
  freshness = await startFreshness({ port: 0, host: '127.0.0.1', chainIds: [31337], indexer: INDEXER })
  return freshness
}

async function stopServer(): Promise<void> {
  const server = freshness
  freshness = null
  await server?.close()
}

/** The running server, or a throw. */
function server(): Freshness {
  if (!freshness) throw new Error('the freshness server is not running')
  return freshness
}

type StateAnswer = { status: number; etag: string | null; body: StateBody | null }

async function stateOf(contract: Address): Promise<StateAnswer> {
  const response = await fetch(`${server().url}${statePath(31337, contract)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = response.status === 200 ? ((await response.json()) as StateBody) : null
  return { status: response.status, etag: response.headers.get('etag'), body }
}

async function healthOf(): Promise<{ text: string; body: HealthBody }> {
  const response = await fetch(`${server().url}/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const text = await response.text()
  return { text, body: JSON.parse(text) as HealthBody }
}

type CursorRow = { from_block: number; indexed_block: number; synced_at: string | null; holders: number }

async function cursorOf(cid: string): Promise<CursorRow | null> {
  const { data, error } = await admin
    .from('indexer_cursors')
    .select('from_block, indexed_block, synced_at, holders')
    .eq('collection_id', cid)
    .maybeSingle()
  if (error) throw new Error(`the cursor: ${error.message}`)
  return data
}

/**
 * Every row the indexer keeps for the collection, and its cursor's start and holders, as one string to compare.
 * The airdrops' and withdrawals' confirmed_at, set when a row is inserted, show a row kept rather than written
 * again.
 */
async function indexedRows(cid: string): Promise<string> {
  const reads = await Promise.all([
    admin
      .from('mints')
      .select('tx_hash, log_index, block, block_time, recipient, vault, group_id, amount, first_token_id')
      .eq('collection_id', cid)
      .order('tx_hash'),
    admin
      .from('token_owners')
      .select('token_id, owner, block, log_index')
      .eq('collection_id', cid)
      .order('token_id'),
    admin
      .from('airdrops')
      .select(
        'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, sent_by, block_time, confirmed_at',
      )
      .eq('collection_id', cid)
      .order('tx_hash'),
    admin
      .from('airdrop_recipients')
      .select('tx_hash, first_token_id, recipient, tokens, block, block_time')
      .eq('collection_id', cid)
      .order('first_token_id'),
    admin
      .from('withdrawals')
      .select('tx_hash, amount_wei::text, payout_address, block, confirmed_at')
      .eq('collection_id', cid)
      .order('tx_hash'),
    admin.from('indexer_cursors').select('from_block, holders').eq('collection_id', cid),
  ])
  for (const { error } of reads) if (error) throw new Error(`the indexed rows: ${error.message}`)
  return JSON.stringify(reads.map(({ data }) => data))
}

/** The time of a transaction's block (Unix seconds). */
async function blockTimeOf(hash: Hex): Promise<number> {
  const receipt = await chain.getTransactionReceipt({ hash })
  return Number((await chain.getBlock({ blockNumber: receipt.blockNumber })).timestamp)
}

/** The owner check the actions run first (`ownedCollection`): the collection's owner, else not found. */
async function ownership(creator: Creator, cid: string): Promise<string> {
  const collection = await readLockCollection(creator.client, cid)
  return collection && collection.owner_id === creator.userId ? 'owned' : NOT_FOUND
}

/** What main set up, for the cleanup's check. */
let subject: { deployed: Deployed } | null = null

async function main(): Promise<void> {
  console.log(
    `Verifying the indexer on chain 31337 at ${new URL(rpc).host} against Supabase at ${new URL(settings.url).host}`,
  )
  for (const key of [creatorKey, holderKey, strangerKey])
    await chain.setBalance({ address: key.address, value: parseEther('10') })
  const creator = await signIn(creatorKey)
  const stranger = await signIn(strangerKey)
  const form: DeployForm = {
    chainId: 31337,
    payout: creatorKey.address,
    royaltyBps: 500,
    royaltyReceiver: creatorKey.address,
    publicMaxPerWallet: 1,
    groups: [
      { name: 'Public', priceWei: PUBLIC_PRICE.toString(), maxSupply: 2 },
      { name: 'Holders', priceWei: '0', maxSupply: 1 },
    ],
  }
  let deployed: Deployed | null = null
  let before: { counted: boolean } | null = null

  await check(
    '1. setup: Anvil answers as 31337 with the factory approving the shipped code hash, Supabase answers, and the freshness server serves 31337 with its indexer on',
    async () => {
      const unready = await chainReady()
      if (unready) return unready
      const cursors = await admin.from('indexer_cursors').select('*', { count: 'exact', head: true })
      if (cursors.error) return `Supabase: ${cursors.error.message}; run supabase migration up --local`
      deployed = await deployedCollection(creator, form, 'indexer')
      subject = { deployed }
      await setAirdropFee(deployed.record.contractAddress, FEE)
      // The Overview's view before any indexer has read the collection, for check 2.
      const view = await activityViewCore(deployed.ctx)
      if (!('data' in view)) return `the view before: ${JSON.stringify(view)}`
      before = view.data
      await startServer()
      const { body } = await healthOf()
      const entry = body.chains.find((chainHealth) => chainHealth.chainId === 31337)
      return body.chains.length === 1 && entry?.indexer
        ? null
        : `serves ${body.chains.map((chainHealth) => chainHealth.chainId).join(' ')}, indexer ${JSON.stringify(entry?.indexer)}`
    },
  )
  const run = deployed as Deployed | null
  if (!run || !freshness) throw new Error('the collection or the server did not start')
  const { cid, ctx } = run
  const contract = run.record.contractAddress
  const deployBlock = Number((await chain.getTransactionReceipt({ hash: run.hash })).blockNumber)

  await check(
    "2. counting: before the server starts the owner's activity view reads not counted; after it starts the cursor is at the deploy block within one targets read, and the view reads counted with 0 holders and no mint",
    async () => {
      if (!before || before.counted) return `before the server: ${JSON.stringify(before)}`
      const cursor = await until(async () => {
        const row = await cursorOf(cid)
        return row?.from_block === deployBlock ? row : null
      }, INDEXER.targetsEveryMs! + 1_000)
      if (!cursor)
        return `no cursor at the deploy block ${deployBlock}: ${JSON.stringify(await cursorOf(cid))}`
      const counted = await until(async () => {
        const view = await activityViewCore(ctx)
        return 'data' in view && view.data.counted ? view.data : null
      }, RECORDED_WITHIN_MS)
      return counted?.holders === 0 && counted.recentMints.length === 0
        ? null
        : `view ${JSON.stringify(counted)}`
    },
  )

  // The holder mints 1 from Public, opened by the creator.
  await sendCall(creatorKey, contract, phaseCalls.open(PUBLIC))
  const [total] = await chain.readContract({
    address: contract,
    abi: collectionAbi,
    functionName: 'quoteBatchMint',
    args: [BigInt(PUBLIC), 1n],
  })
  const { request: mintRequest } = await chain.simulateContract({
    address: contract,
    abi: collectionAbi,
    functionName: 'batchMint',
    args: [1n, BigInt(PUBLIC)],
    value: total,
    account: holderKey,
  })
  const mintHash = await sendRequest(holderKey, mintRequest)
  const mintTime = await blockTimeOf(mintHash)

  await check(
    "3. mint: the holder's mint of 1 from Public is recorded once with its recipient, group 0, amount 1, token 1 and its block's time; token 1's owner is the holder and holders read 1",
    async () => {
      const mints = await until(async () => {
        const { data } = await admin.from('mints').select('*').eq('collection_id', cid)
        return data?.length ? data : null
      }, RECORDED_WITHIN_MS)
      const [mint] = mints ?? []
      if (
        mints?.length !== 1 ||
        mint?.tx_hash !== mintHash ||
        mint.recipient !== lower(holderKey.address) ||
        mint.vault !== null ||
        mint.group_id !== 0 ||
        mint.amount !== 1 ||
        mint.first_token_id !== 1 ||
        !sameTime(mint.block_time, mintTime)
      )
        return `mints ${JSON.stringify(mints)}`
      const owner = await admin
        .from('token_owners')
        .select('owner')
        .eq('collection_id', cid)
        .eq('token_id', 1)
        .maybeSingle()
      if (owner.data?.owner !== lower(holderKey.address)) return `token 1 ${JSON.stringify(owner.data)}`
      const cursor = await until(async () => {
        const row = await cursorOf(cid)
        return row?.holders === 1 ? row : null
      }, RECORDED_WITHIN_MS)
      return cursor ? null : `holders ${(await cursorOf(cid))?.holders}`
    },
  )

  let mintedEtag: string | null = null
  await check(
    "4. state: the state endpoint's activity reads 1 holder and the mint, and an empty block leaves its ETag unchanged",
    async () => {
      const read = await until(async () => {
        const answer = await stateOf(contract)
        return answer.body?.activity?.holders === 1 ? answer : null
      }, RECORDED_WITHIN_MS)
      const mint = read?.body?.activity?.recentMints[0]
      if (
        !read?.etag ||
        read.body?.activity?.recentMints.length !== 1 ||
        mint?.txHash !== mintHash ||
        mint.recipient !== holderKey.address ||
        mint.groupId !== 0 ||
        mint.amount !== 1 ||
        mint.firstTokenId !== 1 ||
        mint.blockTimestamp !== mintTime
      )
        return `state ${read?.status} ${JSON.stringify(read?.body?.activity)}`
      await chain.mine({ blocks: 1 })
      const head = Number(await chain.getBlockNumber())
      // One reader tick reads the empty block, then one indexer pass moves the cursor past it.
      const later = await until(async () => {
        const answer = await stateOf(contract)
        return answer.body && answer.body.block >= head ? answer : null
      }, RECORDED_WITHIN_MS)
      await wait(1_000)
      const after = await stateOf(contract)
      mintedEtag = read.etag
      return later && after.etag === read.etag && after.body?.block === head
        ? null
        : `the tag ${read.etag} then ${after.etag} at block ${after.body?.block}, head ${head}`
    },
  )

  // Confirmed through Cobweb while no indexer runs, so Cobweb's record lands first, as it does in the app.
  await stopServer()
  const airdropHash = await sendCall(
    creatorKey,
    contract,
    airdropCalls.batch([{ address: strangerKey.address, amount: 1 }], FEE.toString()),
  )
  const confirmed = await confirmAirdropCore(ctx, airdropHash)
  await startServer()
  const airdropTime = await blockTimeOf(airdropHash)

  await check(
    '5. airdrop through Cobweb: a batch of 1 to the stranger confirmed by confirmAirdropCore keeps its sender, gains its block time and has one recipient row',
    async () => {
      if (!('data' in confirmed)) return `confirm ${JSON.stringify(confirmed)}`
      const row = await until(async () => {
        const { data } = await admin.from('airdrops').select('*').eq('tx_hash', airdropHash).maybeSingle()
        return data?.block_time ? data : null
      }, RECORDED_WITHIN_MS)
      if (row?.sent_by !== lower(creatorKey.address) || !sameTime(row.block_time, airdropTime))
        return `airdrop ${JSON.stringify(row)}`
      const { data } = await admin.from('airdrop_recipients').select('*').eq('tx_hash', airdropHash)
      const [recipientRow] = data ?? []
      return data?.length === 1 &&
        recipientRow?.recipient === lower(strangerKey.address) &&
        recipientRow.tokens === 1 &&
        recipientRow.first_token_id === 2
        ? null
        : `recipients ${JSON.stringify(data)}`
    },
  )

  const burnHash = await sendCall(creatorKey, contract, airdropCalls.burn(1, FEE.toString()))
  const burnTime = await blockTimeOf(burnHash)

  await check(
    "6. burn outside Cobweb: airdropNFTs to the dead address sent straight from the creator's wallet is recorded as a burn with no sender, its fee, token 3 and one recipient row; holders still read 2",
    async () => {
      const row = await until(async () => {
        const { data } = await admin
          .from('airdrops')
          .select(
            'kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, sent_by, block_time',
          )
          .eq('tx_hash', burnHash)
          .maybeSingle()
        return data
      }, RECORDED_WITHIN_MS)
      if (
        row?.kind !== 'burn' ||
        row.sent_by !== null ||
        row.recipients !== 1 ||
        row.tokens !== 1 ||
        row.fee_paid_wei !== FEE.toString() ||
        row.first_token_id !== 3 ||
        row.last_token_id !== 3 ||
        !sameTime(row.block_time, burnTime)
      )
        return `burn ${JSON.stringify(row)}`
      const { data } = await admin
        .from('airdrop_recipients')
        .select('recipient, tokens, first_token_id')
        .eq('tx_hash', burnHash)
      if (JSON.stringify(data) !== JSON.stringify([{ recipient: DEAD, tokens: 1, first_token_id: 3 }]))
        return `recipients ${JSON.stringify(data)}`
      const cursor = await cursorOf(cid)
      return cursor?.holders === 2 ? null : `holders ${cursor?.holders}`
    },
  )

  await check(
    "7. transfer: the holder's transfer of token 1 to the stranger makes the stranger its owner, holders read 1, and the state answers a new ETag",
    async () => {
      const prior = await until(async () => {
        const answer = await stateOf(contract)
        return answer.body?.activity?.holders === 2 ? answer : null
      }, RECORDED_WITHIN_MS)
      if (!prior?.etag || prior.etag === mintedEtag)
        return `the state before ${JSON.stringify(prior?.body?.activity)}`
      const { request } = await chain.simulateContract({
        address: contract,
        abi: collectionAbi,
        functionName: 'transferFrom',
        args: [holderKey.address, strangerKey.address, 1n],
        account: holderKey,
      })
      await sendRequest(holderKey, request)
      const owner = await until(async () => {
        const { data } = await admin
          .from('token_owners')
          .select('owner')
          .eq('collection_id', cid)
          .eq('token_id', 1)
          .maybeSingle()
        return data?.owner === lower(strangerKey.address) ? data : null
      }, RECORDED_WITHIN_MS)
      if (!owner) return 'token 1 did not move to the stranger'
      if ((await cursorOf(cid))?.holders !== 1) return `holders ${(await cursorOf(cid))?.holders}`
      const after = await until(async () => {
        const answer = await stateOf(contract)
        return answer.body?.activity?.holders === 1 ? answer : null
      }, RECORDED_WITHIN_MS)
      return after?.etag && after.etag !== prior.etag ? null : `the tag ${prior.etag} then ${after?.etag}`
    },
  )

  const withdrawHash = await sendCall(creatorKey, contract, settingsCalls.withdraw())

  await check(
    "8. withdrawal outside Cobweb: withdrawMintFunds sent straight from the creator's wallet is recorded with the event's amount, the settings view's withdrawn sum includes it, and Paid by minters equals Public's price",
    async () => {
      const row = await until(async () => {
        // Keyed by the transaction and the collection: this collection's row of the transaction.
        const { data } = await admin
          .from('withdrawals')
          .select('amount_wei::text, payout_address')
          .eq('tx_hash', withdrawHash)
          .eq('collection_id', cid)
          .maybeSingle()
        return data
      }, RECORDED_WITHIN_MS)
      if (row?.amount_wei !== PUBLIC_PRICE.toString() || row.payout_address !== lower(creatorKey.address))
        return `withdrawal ${JSON.stringify(row)}`
      const settingsView = await settingsViewCore(ctx)
      if (!('data' in settingsView)) return `settings ${JSON.stringify(settingsView)}`
      if (
        settingsView.data.withdrawnWei !== PUBLIC_PRICE.toString() ||
        settingsView.data.creatorBalanceWei !== '0'
      )
        return `withdrawn ${settingsView.data.withdrawnWei}, balance ${settingsView.data.creatorBalanceWei}`
      const activity = await activityViewCore(ctx)
      if (!('data' in activity)) return `activity ${JSON.stringify(activity)}`
      const paid = paidByMintersOf(settingsView.data, activity.data)
      return paid.kind === 'wei' && paid.wei === PUBLIC_PRICE.toString()
        ? null
        : `paid ${JSON.stringify(paid)}`
    },
  )

  await check(
    "9. Overview: the owner's activity view reads counted, 1 holder and the mint under Public's name; another creator's read is refused as not found",
    async () => {
      const view = await activityViewCore(ctx)
      if (!('data' in view)) return `view ${JSON.stringify(view)}`
      const [mint] = view.data.recentMints
      if (
        !view.data.counted ||
        view.data.holders !== 1 ||
        view.data.recentMints.length !== 1 ||
        mint?.txHash !== mintHash ||
        mint.minter !== holderKey.address ||
        mint.amount !== 1 ||
        mint.firstTokenId !== 1 ||
        mint.at !== mintTime
      )
        return `view ${JSON.stringify(view.data)}`
      const phases = await phasesViewCore(ctx)
      if (!('data' in phases)) return `phases ${JSON.stringify(phases)}`
      const name = phases.data.groups.find((group) => group.id === mint.groupId)?.name
      if (name !== 'Public') return `the mint's phase ${name}`
      // The action refuses another creator at its owner check; the core on that creator's client reads nothing.
      if ((await ownership(stranger, cid)) !== NOT_FOUND) return 'the stranger owns the collection'
      const forged: PhasesContext = { ...ctx, supabase: stranger.client, owner: stranger.userId }
      const theirs = await activityViewCore(forged)
      return 'data' in theirs && !theirs.data.counted && theirs.data.recentMints.length === 0
        ? null
        : `another creator reads ${JSON.stringify(theirs)}`
    },
  )

  await check(
    '10. Airdrop: the history lists the burn and the airdrop newest first with their block times and reads counted; the recipients search finds the stranger by four characters of the address, a page past the last reads none, and the export has a row per recipient',
    async () => {
      const view = await airdropViewCore(ctx)
      if (!('data' in view)) return `view ${JSON.stringify(view)}`
      const history = view.data.history.map((row) => [row.txHash, row.kind, row.confirmedAt])
      if (
        !view.data.counted ||
        JSON.stringify(history) !==
          JSON.stringify([
            [burnHash, 'burn', burnTime],
            [airdropHash, 'airdrop', airdropTime],
          ])
      )
        return `history ${JSON.stringify(history)}, counted ${view.data.counted}`
      // Four of the stranger's hex digits the dead address does not hold, typed in capitals.
      const digits = lower(strangerKey.address).slice(2)
      let part = ''
      for (let at = 0; at + 4 <= digits.length && !part; at++)
        if (!DEAD.includes(digits.slice(at, at + 4))) part = digits.slice(at, at + 4)
      const found = await airdropRecipientsCore(ctx, { search: part.toUpperCase(), page: 0 })
      if (!('data' in found)) return `search ${JSON.stringify(found)}`
      const strangerRow = found.data.rows.find((row) => row.wallet === strangerKey.address)
      if (
        !strangerRow ||
        strangerRow.tokens !== 1 ||
        strangerRow.firstTokenId !== 2 ||
        !found.data.rows.every((row) => lower(row.wallet).includes(part))
      )
        return `search ${part}: ${JSON.stringify(found.data)}`
      const past = await airdropRecipientsCore(ctx, { search: '', page: 3 })
      if (!('data' in past) || past.data.rows.length !== 0 || past.data.total !== 2)
        return `a page past the last: ${JSON.stringify(past)}`
      const all = await airdropRecipientsAllCore(ctx)
      if (!('data' in all)) return `export ${JSON.stringify(all)}`
      const rows = all.data.map((row) => [row.wallet, row.tokens, row.firstTokenId, row.burn])
      return JSON.stringify(rows) ===
        JSON.stringify([
          [BURN_ADDRESS, 1, 3, true],
          [strangerKey.address, 1, 2, false],
        ]) && recipientsCsvRows(all.data).length === 3
        ? null
        : `export ${JSON.stringify(rows)}`
    },
  )

  await check(
    '11. replay: with the server stopped and the cursor set back to the deploy block, a server started again reads the collection again and every table keeps the same rows and holders; a write starting two blocks past the cursor is refused as skipping blocks',
    async () => {
      const rows = await indexedRows(cid)
      await stopServer()
      const back = await admin
        .from('indexer_cursors')
        .update({ indexed_block: deployBlock - 1 })
        .eq('collection_id', cid)
        .select('indexed_block')
      if (back.error || back.data[0]?.indexed_block !== deployBlock - 1)
        return `setting the cursor back: ${back.error?.message ?? JSON.stringify(back.data)}`
      const skipped = await admin.rpc('indexer_record', {
        p_chain_id: 31337,
        p_from_block: deployBlock + 1,
        p_to_block: deployBlock + 2,
        p_synced_at: null as unknown as string,
        p_collections: [cid],
        p_records: {},
      })
      if (skipped.error?.code !== '23514' || skipped.error.message !== 'The indexer would skip blocks.')
        return `a write past the cursor: ${skipped.error ? `${skipped.error.code} ${skipped.error.message}` : 'accepted'}`
      await startServer()
      const head = Number(await chain.getBlockNumber())
      const read = await until(async () => {
        const cursor = await cursorOf(cid)
        return cursor && cursor.indexed_block >= head ? cursor : null
      }, RECORDED_WITHIN_MS)
      if (!read) return `the cursor at ${(await cursorOf(cid))?.indexed_block}, head ${head}`
      return (await indexedRows(cid)) === rows ? null : 'the rows changed when the collection was read again'
    },
  )

  await check(
    '12. restart: a server started again answers the activity within 2 s, before any new record, and writes no new row',
    async () => {
      const rows = await indexedRows(cid)
      await stopServer()
      await startServer()
      const startedAt = performance.now()
      const answer = await until(async () => {
        const state = await stateOf(contract)
        return state.body?.activity?.holders === 1 ? state : null
      }, ACTIVITY_WITHIN_MS)
      const took = Math.round(performance.now() - startedAt)
      if (!answer) return `no activity within ${ACTIVITY_WITHIN_MS} ms`
      await wait(2_000)
      return (await indexedRows(cid)) === rows ? null : `a new row after the restart (activity in ${took} ms)`
    },
  )

  await check(
    '13. backfill: with the server stopped, the cursor, mints, owners and recipient rows removed and 1,200 empty blocks mined, a server started again rebuilds the same rows from the deploy block and reads counted again',
    async () => {
      const rows = await indexedRows(cid)
      await stopServer()
      try {
        // The rows checks 3 to 8 left: the cursor, the mint, tokens 1 to 3, and the airdrop's and the burn's
        // recipient rows.
        for (const [table, want] of [
          ['indexer_cursors', 1],
          ['mints', 1],
          ['token_owners', 3],
          ['airdrop_recipients', 2],
        ] as const) {
          const removed = await admin.from(table).delete({ count: 'exact' }).eq('collection_id', cid)
          if (removed.error) return `removing ${table}: ${removed.error.message}`
          if (removed.count !== want) return `removed ${removed.count} ${table} rows, not ${want}`
        }
        // In steps of 100, each well under viem's 10 s request timeout: a local Anvil can take 25 ms a block.
        for (let mined = 0; mined < 1_200; mined += 100) await chain.mine({ blocks: 100 })
        const head = Number(await chain.getBlockNumber())
        await startServer()
        const cursor = await until(async () => {
          const row = await cursorOf(cid)
          return row?.synced_at && row.indexed_block >= head ? row : null
        }, RECORDED_WITHIN_MS * 2)
        if (cursor?.from_block !== deployBlock) return `the cursor ${JSON.stringify(await cursorOf(cid))}`
        if ((await indexedRows(cid)) !== rows) return 'the rows rebuilt differ'
        const view = await activityViewCore(ctx)
        return 'data' in view && view.data.counted && view.data.holders === 1
          ? null
          : `view ${JSON.stringify(view)}`
      } finally {
        // Check 14 reads the server: a failure here that left it stopped would fail that check for this reason.
        if (!freshness) await startServer()
      }
    },
  )

  await check(
    "14. health: /health reports chain 31337's indexer with every collection the database indexes there (this one among them), none behind, its block and last pass, no failed pass and nothing unpaired, its reader with no failure either, and no key, URL or host anywhere in the body",
    async () => {
      const head = Number(await chain.getBlockNumber())
      const cursors = await admin.from('indexer_cursors').select('collection_id').eq('chain_id', 31337)
      if (cursors.error) return `cursors: ${cursors.error.message}`
      if (!cursors.data.some((row) => row.collection_id === cid)) return 'no cursor for the collection'
      const health = await until(async () => {
        const read = await healthOf()
        const indexer = read.body.chains.find((entry) => entry.chainId === 31337)?.indexer
        return indexer && indexer.block === head && indexer.behind === 0 ? { ...read, indexer } : null
      }, RECORDED_WITHIN_MS)
      if (!health) return `health ${JSON.stringify((await healthOf()).body.chains)}`
      const { indexer, text, body } = health
      const recent = indexer.lastPassAt !== null && Date.now() - Date.parse(indexer.lastPassAt) < 5_000
      if (
        indexer.collections !== cursors.data.length ||
        !recent ||
        indexer.failedPasses !== 0 ||
        indexer.lastError !== null ||
        indexer.unpaired !== 0
      )
        return `indexer ${JSON.stringify(indexer)} for ${cursors.data.length} cursors`
      const reader = body.chains.find((entry) => entry.chainId === 31337)
      if (reader?.lastError !== null) return `the reader's last error ${reader?.lastError}`
      // Neither the key nor either URL, nor a scheme or either host, anywhere in the body.
      const leaked = [
        settings.serviceKey,
        settings.url,
        rpc,
        '://',
        new URL(settings.url).host,
        new URL(rpc).host,
      ].filter((secret) => text.includes(secret))
      return leaked.length ? `/health carries ${leaked.length} of the key, the URLs and their hosts` : null
    },
  )
}

/** Runs a cleanup step whatever failed before it: its problem (a string it answers or a throw), or null. */
async function attempt(label: string, fn: () => Promise<unknown>): Promise<string | null> {
  try {
    const problem = await fn()
    return typeof problem === 'string' ? problem : null
  } catch (error) {
    return `${label} threw ${failureLine(error)}`
  }
}

/** Each indexer table's rows for the collection, as counts. */
async function indexerCounts(cid: string): Promise<string> {
  const counts: string[] = []
  for (const table of ['indexer_cursors', 'mints', 'token_owners', 'airdrop_recipients'] as const) {
    const { count, error } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('collection_id', cid)
    counts.push(error ? `${table}: ${error.message}` : `${table} ${count}`)
  }
  return counts.join(', ')
}

/** Every cursor of chain 31337 with the time of its last write, as one string to compare. */
async function cursorWrites(): Promise<string> {
  const { data, error } = await admin
    .from('indexer_cursors')
    .select('collection_id, indexed_block, updated_at')
    .eq('chain_id', 31337)
    .order('collection_id')
  if (error) throw new Error(`the cursors: ${error.message}`)
  return JSON.stringify(data)
}

async function cleanup(): Promise<void> {
  await check(
    '15. stop: close() ends the indexer: a transfer sent after it changes no row and no cursor is written for 3 s; and the fixtures are removed',
    async () => {
      const run = subject
      const problems: (string | null)[] = [
        await attempt('closing the freshness server', async () => {
          // A server already down cannot show that close() stops its indexer.
          if (!freshness) return 'the freshness server was not running at the stop'
          await stopServer()
          const writes = await cursorWrites()
          const rows = run ? await indexedRows(run.deployed.cid) : null
          if (run) {
            // A change a running indexer records within a pass: token 1 handed on by whichever of the holder and
            // the stranger holds it (the stranger, since check 7).
            const contract = run.deployed.record.contractAddress
            const owner = await chain.readContract({
              address: contract,
              abi: collectionAbi,
              functionName: 'ownerOf',
              args: [1n],
            })
            const [from, to] = isAddressEqual(owner, strangerKey.address)
              ? [strangerKey, holderKey]
              : [holderKey, strangerKey]
            const { request } = await chain.simulateContract({
              address: contract,
              abi: collectionAbi,
              functionName: 'transferFrom',
              args: [from.address, to.address, 1n],
              account: from,
            })
            await sendRequest(from, request)
          }
          await wait(3_000)
          if ((await cursorWrites()) !== writes) return 'a cursor was written after close()'
          return run && (await indexedRows(run.deployed.cid)) !== rows ? 'a row changed after close()' : null
        }),
        await attempt('removing the fixtures', removeFixtures),
      ]
      if (run)
        problems.push(
          await attempt('counting the indexer rows', async () => {
            const counts = await indexerCounts(run.deployed.cid)
            return counts === 'indexer_cursors 0, mints 0, token_owners 0, airdrop_recipients 0'
              ? null
              : `left: ${counts}`
          }),
        )
      return problems.find((problem) => problem !== null) ?? null
    },
  )
}

await runChecks(main, cleanup)
