// Checks the Whitelist against a LOCAL Anvil chain and LOCAL Supabase (docs/specs/2026-10-15-whitelist.md,
// section 10): a collection deployed through the factory with Public (free, 1) and Holders (0.001 ETH, 2) of
// three tokens; 1,100 addresses added in two pages, Set quota for all, 20 re-added; the cap and the zero address
// refused; three chunks built by the server with nextChunkCore, simulated as wagmi does, sent from the creator's
// key (the contract's owner) and confirmed from their receipts and calldata; the copies against mintQuotas; a
// chunk confirmed twice; a raised quota and two removals; quota used from the chain; the confirm's refusals; a
// stranger's session; a chunk sent outside the flow; the holder snapshot and its refusals; the copy when the
// chain does not answer. Eighteen PASS lines with the cleanup.
//
//   supabase start
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:whitelist
//
// The fixture (scripts/deploy-fixture.ts) reads the settings from the environment, `supabase status -o env`
// and apps/web/.env.local, and refuses non-local endpoints. Never prints a key. Deletes every row it
// creates. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import {
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseEther,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  admin,
  chain,
  chainReady,
  check,
  deployedCollection,
  factory,
  refusal,
  removeFixtures,
  rpc,
  runChecks,
  settings,
  signIn,
  type Deployed,
  type DeployForm,
} from './deploy-fixture.ts'

const {
  addEntriesCore,
  confirmWhitelistChunkCore,
  nextChunkCore,
  quotaUsageCore,
  removeEntryCore,
  setEntryQuotaCore,
  setQuotaForAllCore,
  whitelistViewCore,
} = await import('../src/lib/manage/whitelist-core.ts')
const { fetchHoldersCore } = await import('../src/lib/manage/snapshot-core.ts')
const { phaseCalls } = await import('../src/lib/manage/phase-calls.ts')
const { addEntriesShape } = await import('../src/lib/manage/whitelist-schemas.ts')
const {
  NOT_A_CONTRACT,
  NOT_DEPLOYED,
  NOT_ERC721,
  NOT_FROM_WALLET,
  NOT_THIS_CHANGE,
  NOT_THIS_CONTRACT,
  SNAPSHOT_CHAIN,
  WHITELIST_FULL,
  ZERO_ADDRESS,
} = await import('../src/lib/art/result.ts')
type ManageCall = import('../src/lib/manage/phase-calls.ts').ManageCall
type WhitelistContext = import('../src/lib/manage/whitelist-core.ts').WhitelistContext
type ChunkEntry = import('../src/lib/manage/whitelist-types.ts').ChunkEntry
type ChunkPlan = import('../src/lib/manage/whitelist-types.ts').ChunkPlan
type GroupList = import('../src/lib/manage/whitelist-types.ts').GroupList
type WhitelistView = import('../src/lib/manage/whitelist-types.ts').WhitelistView

const HOLDERS_PRICE = '1000000000000000'

/** An address of its own for each index, from the keccak of the index, so address order is not list order. */
const addressAt = (index: number): Address => getAddress(`0x${keccak256(toHex(index)).slice(26)}`)

type EntryRow = {
  wallet_address: string
  quota: number
  written_quota: number | null
  written_tx: string | null
  written_at: string | null
}

/** A group's entries as the service role reads them, every page, in lowercase address order. */
async function entryRows(groupId: string): Promise<EntryRow[]> {
  const rows: EntryRow[] = []
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await admin
      .from('whitelist_entries')
      .select('wallet_address, quota, written_quota, written_tx, written_at')
      .eq('mint_group_id', groupId)
      .order('wallet_address')
      .range(from, from + 999)
    if (error) throw new Error(`entries: ${error.message}`)
    rows.push(...data)
    if (data.length < 1_000) break
  }
  return rows.sort((a, b) =>
    a.wallet_address < b.wallet_address ? -1 : a.wallet_address > b.wallet_address ? 1 : 0,
  )
}

/** The row id of a collection's group, as the service role reads it. */
async function groupRowId(cid: string, onchainId: number): Promise<string> {
  const { data, error } = await admin
    .from('mint_groups')
    .select('id')
    .eq('collection_id', cid)
    .eq('onchain_id', onchainId)
    .single()
  if (error) throw new Error(`group ${onchainId}: ${error.message}`)
  return data.id
}

/** Simulates the call as wagmi does, sends exactly the simulated request from the account and waits. */
async function send(account: PrivateKeyAccount, address: Address, call: ManageCall): Promise<Hex> {
  const { request } = await chain.simulateContract({
    address,
    abi: collectionAbi,
    functionName: call.functionName,
    args: call.args,
    account,
  })
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract(request)
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${call.functionName} reverted: ${hash}`)
  return hash
}

/** The rows an add sends, after the shape the action parses them with. */
function shaped(rows: ChunkEntry[]): ChunkEntry[] {
  const parsed = addEntriesShape.safeParse(rows)
  if (!parsed.success) throw new Error(`the rows are refused: ${parsed.error.issues[0]?.message}`)
  return parsed.data
}

/** The view's list for Holders (group 1). */
const holdersList = (view: WhitelistView): GroupList | undefined =>
  view.lists.find((list) => list.onchainId === 1)

async function main(): Promise<void> {
  console.log(`Verifying the whitelist on ${rpc} against ${settings.url}`)
  await check(
    '1. chain: Anvil answers as 31337 and the factory approves the shipped creation code hash',
    chainReady,
  )

  const creatorKey = privateKeyToAccount(generatePrivateKey())
  const strangerKey = privateKeyToAccount(generatePrivateKey())
  await chain.setBalance({ address: creatorKey.address, value: parseEther('10') })
  await chain.setBalance({ address: strangerKey.address, value: parseEther('10') })
  const creator = await signIn(creatorKey)
  const stranger = await signIn(strangerKey)
  const strangerWallet = strangerKey.address.toLowerCase()

  const form: DeployForm = {
    chainId: 31337,
    payout: creatorKey.address,
    royaltyBps: 500,
    royaltyReceiver: creatorKey.address,
    publicMaxPerWallet: 2,
    groups: [
      { name: 'Public', priceWei: '0', maxSupply: 1 },
      { name: 'Holders', priceWei: HOLDERS_PRICE, maxSupply: 2 },
    ],
  }
  let deployed: Deployed | null = null
  let holdersId = ''
  /** The collection check 2 deploys; every later check runs on it. */
  const subject = (): Deployed => {
    if (!deployed) throw new Error('the collection of check 2 is not deployed')
    return deployed
  }
  /** The 1,100 addresses check 3 adds, the stranger's first. */
  const listed: Address[] = [
    strangerKey.address,
    ...Array.from({ length: 1_099 }, (_, index) => addressAt(index)),
  ]
  /** Holders' entries other than the stranger's, in address order. */
  const others = async () =>
    (await entryRows(holdersId)).filter((row) => row.wallet_address !== strangerWallet)
  /** What the contract issued an address in Holders. */
  const quotaOn = (address: Address) =>
    chain.readContract({
      address: subject().record.contractAddress,
      abi: collectionAbi,
      functionName: 'mintQuotas',
      args: [1n, address],
    })
  /** Builds Holders' next chunk on the server, sends it from the creator and confirms it, as the dialog and the action do. */
  const writeNext = async (): Promise<{ view: WhitelistView; hash: Hex; plan: ChunkPlan }> => {
    const { ctx, record } = subject()
    const next = await nextChunkCore(ctx, 1)
    if (!('data' in next)) throw new Error(`next chunk: ${refusal(next)}`)
    if (!next.data) throw new Error('next chunk: every address is written')
    const plan = next.data
    const call = phaseCalls.quotas(
      1,
      plan.entries.map((entry) => entry.address),
      plan.entries.map((entry) => entry.quota),
    )
    const hash = await send(creatorKey, record.contractAddress, call)
    const confirmed = await confirmWhitelistChunkCore(ctx, hash, 1)
    if (!('data' in confirmed)) throw new Error(`confirm: ${refusal(confirmed)}`)
    return { view: confirmed.data, hash, plan }
  }

  await check(
    '2. read: a collection deployed with Public (free, 1) and Holders (0.001 ETH, 2) of three tokens reads Holders, named, as its one whitelist group, with an empty list',
    async () => {
      deployed = await deployedCollection(creator, form, 'whitelist')
      holdersId = await groupRowId(deployed.cid, 1)
      const outcome = await whitelistViewCore(deployed.ctx)
      if (!('data' in outcome)) return refusal(outcome)
      const view = outcome.data
      const groups = view.groups.map((group) => `${group.id}:${group.name}:${group.named}`).join(' ')
      const list = holdersList(view)
      return view.chainReachable &&
        view.chunkSize === 500 &&
        groups === '1:Holders:true' &&
        view.lists.length === 1 &&
        list?.total === 0 &&
        list.chunks.length === 0
        ? null
        : `${groups} ${JSON.stringify(view.lists)}`
    },
  )

  await check(
    '3. add: 1,100 addresses, the stranger first, answer 1,100 added in two pages; Set quota for all to 2 changes 1,100; 20 others re-added at 1 answer 20 updated',
    async () => {
      const { ctx } = subject()
      const added = await addEntriesCore(ctx, 1, shaped(listed.map((address) => ({ address, quota: 1 }))))
      if (!('data' in added)) return `add: ${refusal(added)}`
      const all = await setQuotaForAllCore(ctx, 1, 2)
      if (!('data' in all)) return `all: ${refusal(all)}`
      const again = await addEntriesCore(
        ctx,
        1,
        shaped(listed.slice(1_000, 1_020).map((address) => ({ address, quota: 1 }))),
      )
      if (!('data' in again)) return `again: ${refusal(again)}`
      const rows = await entryRows(holdersId)
      const ones = rows.filter((row) => row.quota === 1).length
      return added.data.added === 1_100 &&
        added.data.updated === 0 &&
        all.data.changed === 1_100 &&
        again.data.added === 0 &&
        again.data.updated === 20 &&
        rows.length === 1_100 &&
        ones === 20
        ? null
        : `${JSON.stringify([added.data, all.data, again.data])}, ${rows.length} rows, ${ones} at 1`
    },
  )

  await check(
    '4. limits: 8,901 more are refused as a full whitelist and nothing is written; the zero address is refused by the shape',
    async () => {
      const { ctx } = subject()
      const more = shaped(
        Array.from({ length: 8_901 }, (_, index) => ({ address: addressAt(10_000 + index), quota: 1 })),
      )
      const full = await addEntriesCore(ctx, 1, more)
      if (refusal(full) !== WHITELIST_FULL) return `full: ${refusal(full)}`
      const zero = addEntriesShape.safeParse([{ address: zeroAddress, quota: 1 }])
      const sentence = zero.success ? 'accepted' : zero.error.issues[0]?.message
      if (sentence !== ZERO_ADDRESS) return `zero: ${sentence}`
      return (await entryRows(holdersId)).length === 1_100 ? null : 'rows were written'
    },
  )

  await check(
    '5. next chunk: chunk 1 of 3 is the first 500 addresses in lowercase address order, with their quotas',
    async () => {
      const { ctx } = subject()
      const next = await nextChunkCore(ctx, 1)
      if (!('data' in next)) return refusal(next)
      if (!next.data) return 'no chunk'
      const first = (await entryRows(holdersId))
        .slice(0, 500)
        .map((row) => `${row.wallet_address}:${row.quota}`)
        .join(' ')
      const planned = next.data.entries
        .map((entry) => `${entry.address.toLowerCase()}:${entry.quota}`)
        .join(' ')
      return next.data.number === 1 &&
        next.data.of === 3 &&
        next.data.entries.length === 500 &&
        planned === first
        ? null
        : `chunk ${next.data.number} of ${next.data.of}, ${next.data.entries.length} entries, in order: ${planned === first}`
    },
  )

  const chunkHashes: Hex[] = []
  await check(
    "6. write: three chunks confirmed leave 500, 1,000 and 1,100 written, each copy its quota with its chunk's hash, chunks of 500, 500 and 100, and no next chunk",
    async () => {
      const { ctx } = subject()
      const written: number[] = []
      const chunkOf = new Map<string, Hex>()
      for (let index = 0; index < 3; index++) {
        const { view, hash, plan } = await writeNext()
        chunkHashes.push(hash)
        for (const entry of plan.entries) chunkOf.set(entry.address.toLowerCase(), hash)
        written.push(holdersList(view)?.written ?? -1)
      }
      const wrong = (await entryRows(holdersId)).filter(
        (row) => row.written_quota !== row.quota || row.written_tx !== chunkOf.get(row.wallet_address),
      )
      const view = await whitelistViewCore(ctx)
      if (!('data' in view)) return refusal(view)
      const sizes = (holdersList(view.data)?.chunks ?? []).map((chunk) => chunk.addresses).join(' ')
      const next = await nextChunkCore(ctx, 1)
      return written.join(' ') === '500 1000 1100' &&
        wrong.length === 0 &&
        sizes === '500 500 100' &&
        'data' in next &&
        next.data === null
        ? null
        : `written ${written.join(' ')}, ${wrong.length} wrong copies, chunks ${sizes}`
    },
  )

  await check(
    '7. chain: mintQuotas(1, address) equals the listed quota for the first, 500th, 501st and last address and the stranger',
    async () => {
      const rows = await entryRows(holdersId)
      const picks = [
        rows[0],
        rows[499],
        rows[500],
        rows[rows.length - 1],
        rows.find((row) => row.wallet_address === strangerWallet),
      ]
      const problems: string[] = []
      for (const row of picks) {
        if (!row) {
          problems.push('a row is missing')
          continue
        }
        const onChain = await quotaOn(getAddress(row.wallet_address))
        if (onChain !== BigInt(row.quota))
          problems.push(`${row.wallet_address}: ${onChain} on chain, ${row.quota} listed`)
      }
      return problems.length ? problems.join('; ') : null
    },
  )

  await check(
    '8. again: chunk 2 confirmed a second time answers the same counts and keeps written_at; recording it once more writes nothing',
    async () => {
      const { cid, ctx } = subject()
      const hash = chunkHashes[1]
      if (!hash) return 'no chunk 2'
      const before = JSON.stringify(await entryRows(holdersId))
      const again = await confirmWhitelistChunkCore(ctx, hash, 1)
      if (!('data' in again)) return refusal(again)
      const rows = await entryRows(holdersId)
      const same = before === JSON.stringify(rows)
      const recorded = await admin.rpc('whitelist_chunk_record', {
        p_collection_id: cid,
        p_owner: creator.userId,
        p_onchain_id: 1,
        p_tx: hash,
        p_rows: rows
          .filter((row) => row.written_tx === hash)
          .map((row) => ({ address: row.wallet_address, quota: row.quota })),
      })
      const list = holdersList(again.data)
      return same && list?.written === 1_100 && list.chunks.length === 3 && recorded.data === 0
        ? null
        : `same rows ${same}, written ${list?.written}, chunks ${list?.chunks.length}, record ${JSON.stringify(recorded.data ?? recorded.error)}`
    },
  )

  await check(
    '9. raise: a quota raised to 3 re-queues only that address; its chunk writes 3 on chain',
    async () => {
      const { ctx } = subject()
      const [first] = await others()
      if (!first) return 'no entry'
      const target = getAddress(first.wallet_address)
      const raised = await setEntryQuotaCore(ctx, 1, target, 3)
      if (!('data' in raised)) return refusal(raised)
      const next = await nextChunkCore(ctx, 1)
      if (!('data' in next)) return refusal(next)
      const queued = next.data?.entries.map((entry) => `${entry.address}:${entry.quota}`).join(' ')
      if (queued !== `${target}:3`) return `queued ${queued}`
      await writeNext()
      const onChain = await quotaOn(target)
      return onChain === 3n ? null : `mintQuotas ${onChain}`
    },
  )

  await check(
    '10. remove: a written address is staged at 0, its zero written, its row deleted and mintQuotas 0; a new one is deleted at once and Undo puts it back',
    async () => {
      const { ctx } = subject()
      const [, second] = await others()
      if (!second) return 'no entry'
      const written = getAddress(second.wallet_address)
      const staged = await removeEntryCore(ctx, 1, written)
      if (!('data' in staged)) return `stage: ${refusal(staged)}`
      const zero = (await entryRows(holdersId)).find((row) => row.wallet_address === second.wallet_address)
      if (!staged.data.staged || zero?.quota !== 0)
        return `staged ${staged.data.staged}, quota ${zero?.quota}`
      await writeNext()
      const gone = !(await entryRows(holdersId)).some((row) => row.wallet_address === second.wallet_address)
      const onChain = await quotaOn(written)
      const fresh = addressAt(50_000)
      const added = await addEntriesCore(ctx, 1, [{ address: fresh, quota: 4 }])
      if (!('data' in added)) return `add: ${refusal(added)}`
      const removed = await removeEntryCore(ctx, 1, fresh)
      if (!('data' in removed)) return `remove: ${refusal(removed)}`
      const deleted = !(await entryRows(holdersId)).some((row) => row.wallet_address === fresh.toLowerCase())
      const undo = await setEntryQuotaCore(ctx, 1, fresh, 4)
      if (!('data' in undo)) return `undo: ${refusal(undo)}`
      const back = (await entryRows(holdersId)).find((row) => row.wallet_address === fresh.toLowerCase())
      return gone &&
        onChain === 0n &&
        !removed.data.staged &&
        deleted &&
        back?.quota === 4 &&
        back.written_quota === null
        ? null
        : `gone ${gone}, mintQuotas ${onChain}, new staged ${removed.data.staged}, deleted ${deleted}, back ${JSON.stringify(back)}`
    },
  )

  let openHash: Hex | null = null
  let mintHash: Hex | null = null
  await check(
    "11. used: with Holders open, quotaUsageCore reads 0 for the stranger, then 1 once the stranger mints one, and the view's quota used 1",
    async () => {
      const { ctx, record } = subject()
      const address = record.contractAddress
      openHash = await send(creatorKey, address, phaseCalls.open(1))
      const before = await quotaUsageCore(ctx, 1, [strangerKey.address])
      if (!('data' in before)) return refusal(before)
      const [cost] = await chain.readContract({
        address,
        abi: collectionAbi,
        functionName: 'quoteBatchMint',
        args: [1n, 1n],
      })
      const minter = createWalletClient({ account: strangerKey, chain: anvil, transport: http(rpc) })
      mintHash = await minter.writeContract({
        address,
        abi: collectionAbi,
        functionName: 'batchMint',
        args: [1n, 1n],
        value: cost,
      })
      await chain.waitForTransactionReceipt({ hash: mintHash })
      const after = await quotaUsageCore(ctx, 1, [strangerKey.address])
      if (!('data' in after)) return refusal(after)
      const view = await whitelistViewCore(ctx)
      if (!('data' in view)) return refusal(view)
      const used = holdersList(view.data)?.quotaUsed
      return before.data[0] === 0 && after.data[0] === 1 && used === 1
        ? null
        : `${JSON.stringify([before.data, after.data])}, quota used ${used}`
    },
  )

  await check(
    "12. refusals: the stranger's mint is not from the wallet, the Open hash and chunk 3 for group 2 are not this change, a chunk to another collection is not this contract; nothing is recorded",
    async () => {
      const { ctx } = subject()
      const third = chunkHashes[2]
      if (!mintHash || !openHash || !third) return 'a hash is missing'
      const before = JSON.stringify(await entryRows(holdersId))
      const fromStranger = await confirmWhitelistChunkCore(ctx, mintHash, 1)
      const asOpen = await confirmWhitelistChunkCore(ctx, openHash, 1)
      const otherGroup = await confirmWhitelistChunkCore(ctx, third, 2)
      const other = await deployedCollection(creator, form, 'other')
      const elsewhere = await send(
        creatorKey,
        other.record.contractAddress,
        phaseCalls.quotas(1, [strangerKey.address], [1]),
      )
      const toOther = await confirmWhitelistChunkCore(ctx, elsewhere, 1)
      const after = JSON.stringify(await entryRows(holdersId))
      const answers = [refusal(fromStranger), refusal(asOpen), refusal(otherGroup), refusal(toOther)].join(
        ' | ',
      )
      const wanted = [NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CHANGE, NOT_THIS_CONTRACT].join(' | ')
      return answers === wanted && before === after ? null : `${answers}; rows changed: ${before !== after}`
    },
  )

  await check(
    "13. stranger: the stranger's session reads no entries, its view and its add are refused as not deployed, and its raw add is refused",
    async () => {
      const { cid, ctx } = subject()
      const strangerCtx: WhitelistContext = {
        supabase: stranger.client,
        service: () => admin,
        owner: stranger.userId,
        wallet: strangerWallet,
        collection: ctx.collection,
      }
      const rows = await stranger.client
        .from('whitelist_entries')
        .select('wallet_address')
        .eq('collection_id', cid)
      if (rows.error) return `rows: ${rows.error.message}`
      if (rows.data.length) return `the stranger reads ${rows.data.length} row(s)`
      const view = await whitelistViewCore(strangerCtx)
      if (refusal(view) !== NOT_DEPLOYED) return `view: ${refusal(view)}`
      const add = await addEntriesCore(strangerCtx, 1, [{ address: strangerKey.address, quota: 9 }])
      if (refusal(add) !== NOT_DEPLOYED) return `add: ${refusal(add)}`
      const raw = await stranger.client.rpc('whitelist_entries_add', {
        p_collection_id: cid,
        p_onchain_id: 1,
        p_rows: [{ address: strangerWallet, quota: 9 }],
      })
      if (raw.error?.code !== '42501') return `raw add: ${raw.error?.code ?? 'accepted'}`
      const own = (await entryRows(holdersId)).find((row) => row.wallet_address === strangerWallet)
      return own?.quota === 2 ? null : `the stranger's quota is ${own?.quota}`
    },
  )

  await check(
    '14. outside: a chunk sent without Cobweb for an unlisted address at 5 creates its row, written at 5',
    async () => {
      const { ctx, record } = subject()
      const outsider = addressAt(60_000)
      const hash = await send(creatorKey, record.contractAddress, phaseCalls.quotas(1, [outsider], [5]))
      const confirmed = await confirmWhitelistChunkCore(ctx, hash, 1)
      if (!('data' in confirmed)) return refusal(confirmed)
      const row = (await entryRows(holdersId)).find(
        (entry) => entry.wallet_address === outsider.toLowerCase(),
      )
      return row?.quota === 5 && row.written_quota === 5 && row.written_tx === hash
        ? null
        : JSON.stringify(row)
    },
  )

  await check(
    '15. snapshot: after the creator opens Public and mints one, the holders are the creator and the stranger with one token each, supply 2, at a block no earlier than the mint',
    async () => {
      const address = subject().record.contractAddress
      await send(creatorKey, address, phaseCalls.open(0))
      const [cost] = await chain.readContract({
        address,
        abi: collectionAbi,
        functionName: 'quoteBatchMint',
        args: [0n, 1n],
      })
      const own = createWalletClient({ account: creatorKey, chain: anvil, transport: http(rpc) })
      const minted = await own.writeContract({
        address,
        abi: collectionAbi,
        functionName: 'batchMint',
        args: [1n, 0n],
        value: cost,
      })
      const receipt = await chain.waitForTransactionReceipt({ hash: minted })
      const snapshot = await fetchHoldersCore(31337, address)
      if ('refused' in snapshot) return snapshot.refused
      const holders = snapshot.data.holders
        .map((holder) => `${holder.address}:${holder.balance}`)
        .sort()
        .join(' ')
      const wanted = [creatorKey.address, strangerKey.address]
        .map((holder) => `${holder}:1`)
        .sort()
        .join(' ')
      return holders === wanted &&
        snapshot.data.supply === 2 &&
        BigInt(snapshot.data.block) >= receipt.blockNumber
        ? null
        : `${holders}, supply ${snapshot.data.supply}, block ${snapshot.data.block}`
    },
  )

  await check(
    "16. snapshot refusals: the stranger's wallet has no contract, the factory is not an ERC-721, and chain 999 cannot be read",
    async () => {
      const answers = [
        await fetchHoldersCore(31337, strangerKey.address),
        await fetchHoldersCore(31337, factory),
        await fetchHoldersCore(999, subject().record.contractAddress),
      ]
        .map((outcome) => ('refused' in outcome ? outcome.refused : 'answered'))
        .join(' | ')
      const wanted = [NOT_A_CONTRACT('Anvil'), NOT_ERC721('Anvil'), SNAPSHOT_CHAIN].join(' | ')
      return answers === wanted ? null : answers
    },
  )

  await check(
    '17. failure path: a read that does not answer gives the same lists, unreachable, with no quota used',
    async () => {
      const { ctx } = subject()
      const live = await whitelistViewCore(ctx)
      const copy = await whitelistViewCore(ctx, async () => null)
      if (!('data' in live) || !('data' in copy)) return `${refusal(live)} ${refusal(copy)}`
      const lists = (view: WhitelistView) =>
        JSON.stringify(view.lists.map((list) => ({ ...list, quotaUsed: 0 })))
      return !copy.data.chainReachable &&
        copy.data.lists.every((list) => list.quotaUsed === 0) &&
        lists(copy.data) === lists(live.data)
        ? null
        : `reachable ${copy.data.chainReachable}, same lists ${lists(copy.data) === lists(live.data)}`
    },
  )
}

async function cleanup(): Promise<void> {
  await check(
    '18. cleanup: the run leaves no job, deployment, phase, whitelist entry, collection or user behind',
    removeFixtures,
  )
}

await runChecks(main, cleanup)
