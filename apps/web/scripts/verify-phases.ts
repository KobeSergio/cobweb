// Checks Phases against a LOCAL Anvil chain and LOCAL Supabase (docs/specs/2026-10-15-phases.md, section
// 10): a collection deployed through the factory with Public (free, 1) and Holders (0.001 ETH, 1) of three
// tokens reads from the chain; every change is built with phaseCalls, simulated as wagmi does, sent from the
// creator's key (the contract's owner) and confirmed through the core from its receipt: Add, Open, a past
// schedule, Clear, Close after a schedule, Price, the minted floor, the public limit, Close all; a group
// registered outside the flow is named; hide and show, the public sale refused, Move up, a taken name
// refused; then the confirm's refusals (another collection, another change, an add that did not happen, a
// stranger) and the read's failure path. Twenty PASS lines with the cleanup.
//
//   supabase start
//   pnpm --filter @cobweb/web chain:local    (then copy its two lines into apps/web/.env.local)
//   pnpm --filter @cobweb/web verify:phases
//
// The fixture (scripts/deploy-fixture.ts) reads the settings from the environment, `supabase status -o env`
// and apps/web/.env.local, and refuses non-local endpoints. Never prints a key. Deletes every row it
// creates. Runs under `node --conditions=react-server --import ./scripts/resolve-ts.mjs`.

import { createWalletClient, http, parseEther, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  admin,
  chain,
  chainReady,
  check,
  deployedCollection,
  readDeployment,
  refusal,
  removeFixtures,
  rpc,
  runChecks,
  settings,
  signIn,
  type Deployed,
  type DeployForm,
} from './deploy-fixture.ts'

const { confirmPhaseTxCore, movePhaseCore, phasesViewCore, renamePhaseCore, setPhaseVisibilityCore } =
  await import('../src/lib/manage/phases-core.ts')
const { callOf, expectedEvent, phaseCalls, sentOf } = await import('../src/lib/manage/phase-calls.ts')
const { parseSentCall } = await import('../src/lib/manage/phase-schemas.ts')
const { phasesWriteError } = await import('../src/lib/art/db-error.ts')
const { classifyError } = await import('../src/components/deploy/tx-errors.ts')
const { NOT_DEPLOYED, NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT, PHASE_NAME_TAKEN, PUBLIC_SHOWN } =
  await import('../src/lib/art/result.ts')
type ManageCall = import('../src/lib/manage/phase-calls.ts').ManageCall
type PhasesContext = import('../src/lib/manage/phases-core.ts').PhasesContext
type PhasesView = import('../src/lib/manage/phases-types.ts').PhasesView

const HOLDERS_PRICE = '1000000000000000'
const BELOW_MINTED = 'It cannot go below 1, the tokens this phase has already minted. Nothing was sent.'

type PhaseRow = {
  onchain_id: number
  name: string
  description: string
  visible: boolean
  position: number | null
  price_wei: string
  max_supply: number
  start_at: string | null
}

/** The collection's rows in the creator's order, as the service role reads them. */
async function rowsOf(cid: string): Promise<PhaseRow[]> {
  const { data, error } = await admin
    .from('mint_groups')
    .select('onchain_id, name, description, visible, position, price_wei::text, max_supply, start_at')
    .eq('collection_id', cid)
    .order('position')
  if (error) throw new Error(`rows: ${error.message}`)
  return data as unknown as PhaseRow[]
}

type CopyRow = { public_max_per_wallet: number; state_block: number | null; state_read_at: string | null }

/** The deployment's copy of the public limit and the read it came from. */
async function copyOf(cid: string): Promise<CopyRow> {
  const { data, error } = await admin
    .from('deployments')
    .select('public_max_per_wallet, state_block, state_read_at')
    .eq('collection_id', cid)
    .single()
  if (error) throw new Error(`copy: ${error.message}`)
  return data
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

/** The event the confirm action expects for a call, after the call's trip through SentCall and its shape. */
function expectedFor(call: ManageCall) {
  const sent = parseSentCall(sentOf(call))
  if (!sent.ok) throw new Error(`the sent call is refused: ${sent.error}`)
  return expectedEvent(callOf(sent.data))
}

/** `id:name` in the view's order. */
const order = (view: PhasesView) => view.groups.map((group) => `${group.id}:${group.name}`).join(' ')

async function main(): Promise<void> {
  console.log(`Verifying phases on ${rpc} against ${settings.url}`)
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

  const form: DeployForm = {
    chainId: 31337,
    payout: creatorKey.address,
    royaltyBps: 500,
    royaltyReceiver: creatorKey.address,
    publicMaxPerWallet: 2,
    groups: [
      { name: 'Public', priceWei: '0', maxSupply: 1 },
      { name: 'Holders', priceWei: HOLDERS_PRICE, maxSupply: 1 },
    ],
  }
  let deployed: Deployed | null = null
  /** The collection check 2 deploys; every later check runs on it. */
  const subject = (): Deployed => {
    if (!deployed) throw new Error('the collection of check 2 is not deployed')
    return deployed
  }
  /** Sends a change from the creator and confirms it through the core, as the confirm action does. */
  const change = async (call: ManageCall): Promise<{ view: PhasesView; hash: Hex }> => {
    const { ctx, record } = subject()
    const hash = await send(creatorKey, record.contractAddress, call)
    const outcome = await confirmPhaseTxCore(ctx, hash, { event: expectedFor(call) })
    if (!('data' in outcome)) throw new Error(`confirm ${call.functionName}: ${refusal(outcome)}`)
    return { view: outcome.data, hash }
  }
  const groupOf = (view: PhasesView, id: number) => view.groups.find((group) => group.id === id)

  await check(
    '2. read: a collection deployed with Public (free, 1) and Holders (0.001 ETH, 1) of three tokens reads both named and closed, with the copies and state_block',
    async () => {
      deployed = await deployedCollection(creator, form, 'phases')
      const outcome = await phasesViewCore(deployed.ctx)
      if (!('data' in outcome)) return refusal(outcome)
      const view = outcome.data
      const groups = view.groups.map((group) => [
        group.id,
        group.name,
        group.named,
        group.priceWei,
        group.flag,
        group.active,
      ])
      if (
        JSON.stringify(groups) !==
        JSON.stringify([
          [0, 'Public', true, '0', false, false],
          [1, 'Holders', true, HOLDERS_PRICE, false, false],
        ])
      )
        return `groups ${JSON.stringify(groups)}`
      if (
        !view.chainReachable ||
        view.publicMaxPerWallet !== 2 ||
        view.totalMinted !== 0 ||
        view.maxSupply !== 3
      )
        return `view ${JSON.stringify({ ...view, groups: undefined })}`
      const copy = await copyOf(deployed.cid)
      const rows = await rowsOf(deployed.cid)
      return copy.state_block !== null &&
        copy.public_max_per_wallet === 2 &&
        copy.state_read_at !== null &&
        Date.parse(copy.state_read_at) / 1000 === view.readAt &&
        rows
          .map((row) => `${row.onchain_id}:${row.price_wei}:${row.max_supply}:${row.position}`)
          .join(' ') === `0:0:1:0 1:${HOLDERS_PRICE}:1:1`
        ? null
        : `${JSON.stringify(copy)} ${JSON.stringify(rows)}`
    },
  )

  await check(
    '3. add: nextGroupId reads 2; registerMintGroup is sent; no row before the confirm; the confirm records Allowlist, described, hidden and last',
    async () => {
      const { cid, ctx, record } = subject()
      const ids = await chain.readContract({
        address: record.contractAddress,
        abi: collectionAbi,
        functionName: 'mintGroups',
      })
      const nextId = Number(ids.reduce((highest, id) => (id > highest ? id : highest), 0n)) + 1
      if (nextId !== 2) return `next id ${nextId}`
      const call = phaseCalls.register(nextId, '500000000000000', 1, 0)
      const hash = await send(creatorKey, record.contractAddress, call)
      if ((await rowsOf(cid)).some((row) => row.onchain_id === 2)) return 'a row exists before the confirm'
      const outcome = await confirmPhaseTxCore(ctx, hash, {
        event: expectedFor(call),
        add: { onchainId: 2, name: 'Allowlist', description: 'Friends of the project.', visible: false },
      })
      if (!('data' in outcome)) return refusal(outcome)
      const added = outcome.data.groups.at(-1)
      const row = (await rowsOf(cid)).at(-1)
      return added?.id === 2 &&
        added.name === 'Allowlist' &&
        added.description === 'Friends of the project.' &&
        added.visible === false &&
        added.named === true &&
        added.priceWei === '500000000000000' &&
        row?.onchain_id === 2 &&
        row.position === 2 &&
        row.price_wei === '500000000000000' &&
        row.max_supply === 1
        ? null
        : `${JSON.stringify(added)} ${JSON.stringify(row)}`
    },
  )

  await check(
    '4. open: setMintGroupStatus(2, true); the view reads Allowlist live from the contract',
    async () => {
      const { view } = await change(phaseCalls.open(2))
      const group = groupOf(view, 2)
      return group?.flag === true && group.active === true ? null : JSON.stringify(group)
    },
  )

  await check(
    '5. schedule: a start already past on the closed Holders is allowed and reads live with its flag off; start_at is copied',
    async () => {
      const { cid } = subject()
      const block = await chain.getBlock()
      const start = Number(block.timestamp) - 60
      const { view } = await change(phaseCalls.schedule(1, start))
      const group = groupOf(view, 1)
      const row = (await rowsOf(cid)).find((entry) => entry.onchain_id === 1)
      return group?.flag === false &&
        group.active === true &&
        group.scheduledStart === start &&
        row?.start_at !== null &&
        row?.start_at !== undefined &&
        Date.parse(row.start_at) / 1000 === start
        ? null
        : `${JSON.stringify(group)} ${JSON.stringify(row)}`
    },
  )

  await check(
    '6. clear: scheduleMintGroupStart(1, 0) reads Holders closed with no start; start_at is null',
    async () => {
      const { cid } = subject()
      const { view } = await change(phaseCalls.clearSchedule(1))
      const group = groupOf(view, 1)
      const row = (await rowsOf(cid)).find((entry) => entry.onchain_id === 1)
      return group?.active === false && group.scheduledStart === 0 && row?.start_at === null
        ? null
        : `${JSON.stringify(group)} ${JSON.stringify(row)}`
    },
  )

  await check(
    '7. close: after a start a day ahead, setMintGroupStatus(1, false) leaves the flag off and clears the start',
    async () => {
      const { cid } = subject()
      const block = await chain.getBlock()
      const ahead = Number(block.timestamp) + 86_400
      const scheduled = await change(phaseCalls.schedule(1, ahead))
      if (groupOf(scheduled.view, 1)?.scheduledStart === 0) return 'the start was not set'
      const copied = (await rowsOf(cid)).find((entry) => entry.onchain_id === 1)?.start_at ?? null
      if (copied === null || Date.parse(copied) / 1000 !== ahead) return `the start was not copied: ${copied}`
      const { view } = await change(phaseCalls.close(1))
      const group = groupOf(view, 1)
      const row = (await rowsOf(cid)).find((entry) => entry.onchain_id === 1)
      return group?.flag === false &&
        group.scheduledStart === 0 &&
        group.active === false &&
        row?.start_at === null
        ? null
        : `${JSON.stringify(group)} ${JSON.stringify(row)}`
    },
  )

  let priceHash: Hex | null = null
  await check('8. price: changeSalePrice(0.002 ETH, 1) reads in the view and in price_wei', async () => {
    const { cid } = subject()
    const { view, hash } = await change(phaseCalls.price(1, '2000000000000000'))
    priceHash = hash
    const row = (await rowsOf(cid)).find((entry) => entry.onchain_id === 1)
    return groupOf(view, 1)?.priceWei === '2000000000000000' && row?.price_wei === '2000000000000000'
      ? null
      : `${JSON.stringify(groupOf(view, 1))} ${JSON.stringify(row)}`
  })

  let mintHash: Hex | null = null
  await check(
    '9. floor: with Public open and one token minted, setMintGroupMaxSupply(0, 0) is refused at the check with the sentence and nothing sent; Holders is lowered to 0',
    async () => {
      const { cid, record } = subject()
      const address = record.contractAddress
      await change(phaseCalls.open(0))
      const [cost] = await chain.readContract({
        address,
        abi: collectionAbi,
        functionName: 'quoteBatchMint',
        args: [0n, 1n],
      })
      const minter = createWalletClient({ account: strangerKey, chain: anvil, transport: http(rpc) })
      mintHash = await minter.writeContract({
        address,
        abi: collectionAbi,
        functionName: 'batchMint',
        args: [1n, 0n],
        value: cost,
      })
      await chain.waitForTransactionReceipt({ hash: mintHash })
      const nonce = await chain.getTransactionCount({ address: creatorKey.address })
      let sentence = 'the simulation passed'
      try {
        const floor = phaseCalls.allocation(0, 0)
        await chain.simulateContract({
          address,
          abi: collectionAbi,
          functionName: floor.functionName,
          args: floor.args,
          account: creatorKey,
        })
      } catch (error) {
        sentence = classifyError(error, 'simulating', 'manage').message
      }
      if (sentence !== BELOW_MINTED) return sentence
      if ((await chain.getTransactionCount({ address: creatorKey.address })) !== nonce)
        return 'a transaction was sent'
      const { view } = await change(phaseCalls.allocation(1, 0))
      const row = (await rowsOf(cid)).find((entry) => entry.onchain_id === 1)
      return groupOf(view, 1)?.maxSupply === 0 &&
        groupOf(view, 0)?.minted === 1 &&
        view.totalMinted === 1 &&
        row?.max_supply === 0
        ? null
        : `${JSON.stringify(view.groups)} ${JSON.stringify(row)}`
    },
  )

  await check(
    '10. public limit: setPublicMaxMintPerWallet(5) reads in the view and the copy; readDeployment keeps the launch values',
    async () => {
      const { cid } = subject()
      const { view } = await change(phaseCalls.publicCap(5))
      const copy = await copyOf(cid)
      const launch = await readDeployment(creator.client, cid)
      return view.publicMaxPerWallet === 5 &&
        copy.public_max_per_wallet === 5 &&
        launch?.publicMaxPerWallet === 2 &&
        launch.groups[1]?.priceWei === HOLDERS_PRICE &&
        launch.groups[1]?.maxSupply === 1
        ? null
        : `${view.publicMaxPerWallet} ${copy.public_max_per_wallet} ${JSON.stringify(launch)}`
    },
  )

  await check('11. close all: stopOrStartAllMintGroups(false) reads every phase closed', async () => {
    const { view } = await change(phaseCalls.closeAll())
    return view.groups.every((group) => !group.flag && !group.active && group.scheduledStart === 0)
      ? null
      : JSON.stringify(view.groups)
  })

  await check(
    '12. outside the flow: a group registered without Cobweb (id 9) reads as Group 9, unnamed, last; naming it records its row',
    async () => {
      const { cid, ctx, record } = subject()
      await send(creatorKey, record.contractAddress, phaseCalls.register(9, '0', 0, 0))
      const before = await phasesViewCore(ctx)
      if (!('data' in before)) return refusal(before)
      const unnamed = before.data.groups.at(-1)
      if (unnamed?.id !== 9 || unnamed.name !== 'Group 9' || unnamed.named !== false)
        return `before ${JSON.stringify(unnamed)}`
      const named = await renamePhaseCore(ctx, 9, { name: 'Late list', description: 'Registered elsewhere.' })
      if (!('data' in named)) return `rename: ${refusal(named)}`
      const after = await phasesViewCore(ctx)
      if (!('data' in after)) return refusal(after)
      const row = (await rowsOf(cid)).find((entry) => entry.onchain_id === 9)
      return groupOf(after.data, 9)?.name === 'Late list' &&
        groupOf(after.data, 9)?.named === true &&
        row?.position === 3
        ? null
        : `${JSON.stringify(groupOf(after.data, 9))} ${JSON.stringify(row)}`
    },
  )

  await check(
    '13. visibility: Allowlist shown, then hidden again; the public sale cannot be hidden',
    async () => {
      const { cid, ctx } = subject()
      const shown = await setPhaseVisibilityCore(ctx, 2, true)
      if (!('data' in shown)) return `show: ${refusal(shown)}`
      const visibleAfterShow = (await rowsOf(cid)).find((row) => row.onchain_id === 2)?.visible
      const hidden = await setPhaseVisibilityCore(ctx, 2, false)
      if (!('data' in hidden)) return `hide: ${refusal(hidden)}`
      const publicSale = await setPhaseVisibilityCore(ctx, 0, false)
      if (refusal(publicSale) !== PUBLIC_SHOWN) return `public sale: ${refusal(publicSale)}`
      const rows = await rowsOf(cid)
      return visibleAfterShow === true &&
        rows.find((row) => row.onchain_id === 2)?.visible === false &&
        rows.find((row) => row.onchain_id === 0)?.visible === true
        ? null
        : JSON.stringify(rows)
    },
  )

  await check(
    '14. order: Move up swaps Late list above Allowlist; the first phase moved up stays first',
    async () => {
      const { ctx } = subject()
      const moved = await movePhaseCore(ctx, 9, 'up')
      if (!('data' in moved)) return `move: ${refusal(moved)}`
      const top = await movePhaseCore(ctx, 0, 'up')
      if (!('data' in top)) return `top: ${refusal(top)}`
      const view = await phasesViewCore(ctx)
      if (!('data' in view)) return refusal(view)
      return order(view.data) === '0:Public 1:Holders 9:Late list 2:Allowlist' ? null : order(view.data)
    },
  )

  await check("15. names: another phase's name in other case is refused as taken", async () => {
    const { cid, ctx } = subject()
    const taken = await renamePhaseCore(ctx, 2, { name: 'HOLDERS', description: '' })
    if (!('error' in taken)) return `answered ${refusal(taken)}`
    const sentence = phasesWriteError(taken.error)
    if (sentence !== PHASE_NAME_TAKEN) return sentence
    return (await rowsOf(cid)).find((row) => row.onchain_id === 2)?.name === 'Allowlist'
      ? null
      : 'the name changed'
  })

  await check("16. confirm: a change sent to another collection's contract is refused", async () => {
    const { ctx } = subject()
    const other = await deployedCollection(
      creator,
      { ...form, groups: [{ name: 'Public', priceWei: '0', maxSupply: 3 }] },
      'other',
    )
    const hash = await send(creatorKey, other.record.contractAddress, phaseCalls.open(0))
    const outcome = await confirmPhaseTxCore(ctx, hash, { event: expectedFor(phaseCalls.open(0)) })
    return refusal(outcome) === NOT_THIS_CONTRACT ? null : refusal(outcome)
  })

  await check(
    "17. confirm: the price change's hash is not an Open of group 0, nor an add of id 3, which writes no row",
    async () => {
      const { cid, ctx } = subject()
      if (!priceHash) return 'no price change'
      const asOpen = await confirmPhaseTxCore(ctx, priceHash, { event: expectedFor(phaseCalls.open(0)) })
      if (refusal(asOpen) !== NOT_THIS_CHANGE) return `as Open: ${refusal(asOpen)}`
      const asAdd = await confirmPhaseTxCore(ctx, priceHash, {
        event: { eventName: 'MintGroupRegistered', args: { mintGroup: 3n } },
        add: { onchainId: 3, name: 'Ghost', description: '', visible: true },
      })
      if (refusal(asAdd) !== NOT_THIS_CHANGE) return `as add: ${refusal(asAdd)}`
      return (await rowsOf(cid)).some((row) => row.onchain_id === 3) ? 'a row was written for id 3' : null
    },
  )

  await check(
    "18. a stranger's session reads no deployment and no rows; a stranger's transaction is not the creator's change; the stranger cannot move a phase",
    async () => {
      const { cid, ctx } = subject()
      if (!mintHash) return 'no mint from the stranger'
      const strangerCtx: PhasesContext = {
        supabase: stranger.client,
        service: () => admin,
        owner: stranger.userId,
        wallet: strangerKey.address.toLowerCase(),
        collection: ctx.collection,
      }
      const read = await phasesViewCore(strangerCtx)
      if (refusal(read) !== NOT_DEPLOYED) return `read: ${refusal(read)}`
      const rows = await stranger.client.from('mint_groups').select('id').eq('collection_id', cid)
      if (rows.error) return `rows: ${rows.error.message}`
      if (rows.data.length) return `the stranger reads ${rows.data.length} row(s)`
      const fromStranger = await confirmPhaseTxCore(ctx, mintHash, { event: expectedFor(phaseCalls.open(0)) })
      if (refusal(fromStranger) !== NOT_FROM_WALLET) return `stranger's transaction: ${refusal(fromStranger)}`
      const before = (await rowsOf(cid)).map((row) => `${row.onchain_id}:${row.position}`).join(' ')
      const moved = await movePhaseCore(strangerCtx, 2, 'up')
      if (refusal(moved) !== NOT_DEPLOYED) return `move: ${refusal(moved)}`
      const raw = await stranger.client.rpc('mint_group_move', {
        p_collection_id: cid,
        p_onchain_id: 2,
        p_up: true,
      })
      if (raw.error?.code !== '42501') return `raw move: ${raw.error?.code ?? 'accepted'}`
      const after = (await rowsOf(cid)).map((row) => `${row.onchain_id}:${row.position}`).join(' ')
      return before === after ? null : `${before} became ${after}`
    },
  )

  await check(
    '19. failure path: a read that does not answer gives the last copy, unreachable, with its block time as readAt',
    async () => {
      const { cid, ctx } = subject()
      const outcome = await phasesViewCore(ctx, async () => null)
      if (!('data' in outcome)) return refusal(outcome)
      const view = outcome.data
      const copy = await copyOf(cid)
      const readAt = copy.state_read_at === null ? null : Date.parse(copy.state_read_at) / 1000
      return !view.chainReachable &&
        view.readAt === readAt &&
        view.blockTimestamp === readAt &&
        view.totalMinted === 0 &&
        view.publicMaxPerWallet === 5 &&
        view.maxSupply === 3 &&
        order(view) === '0:Public 1:Holders 9:Late list 2:Allowlist' &&
        view.groups.every((group) => group.minted === 0 && !group.active) &&
        groupOf(view, 1)?.maxSupply === 0 &&
        groupOf(view, 1)?.priceWei === '2000000000000000'
        ? null
        : `${JSON.stringify({ ...view, groups: order(view) })} ${JSON.stringify(groupOf(view, 1))} ${JSON.stringify(copy)}`
    },
  )
}

async function cleanup(): Promise<void> {
  await check(
    '20. cleanup: the run leaves no job, deployment, phase, collection or user behind',
    removeFixtures,
  )
}

await runChecks(main, cleanup)
