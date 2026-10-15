import { collectionAbi } from '@cobweb/shared/collection-abi'
import { publicClientFor } from '@cobweb/shared/server'
import {
  getAddress,
  TransactionReceiptNotFoundError,
  type Address,
  type ContractFunctionReturnType,
  type Hex,
  type PublicClient,
} from 'viem'
import { errorSummary } from '@/lib/art/lock-core'
import {
  CHAIN_NOT_READY,
  CONTRACT_UNREADABLE,
  NAME_FIRST,
  NOT_DEPLOYED,
  PHASE_NOT_CONFIRMED,
  PHASE_NOT_ON_CHAIN,
  PHASE_REVERTED,
  PUBLIC_SHOWN,
} from '@/lib/art/result'
import { matchPhaseEvent } from '@/lib/chain/phase-events'
import type { Json } from '@/lib/database.types'
import type { DeployContext, DeployOutcome } from '@/lib/deploy/deploy-core'
import type { ChainState, PhaseRowCopy, PhasesView, PhaseTxExpected, StateReader } from './phases-types'
import { copyView, liveView, refreshPayload } from './phases-view'

/**
 * Phases on the server (docs/specs/2026-10-15-phases.md, section 6): the chain read, the view, the confirm
 * of an on-chain change and the off-chain edits, on a Supabase client acting as the signed-in creator. The
 * actions (app/actions/phases.ts) call these after the session and ownership check; verify:phases calls
 * them with a signed-in script client. No `server-only` marker, so the script can import it; the browser
 * never does. The server writes the chain's copies only from its own read, never from browser values.
 */
export type PhasesContext = DeployContext

/** What viem answers for `collectionState()`. */
export type CollectionStateResult = ContractFunctionReturnType<
  typeof collectionAbi,
  'view',
  'collectionState'
>

/**
 * `collectionState()` as the screens read it, at the block it was read at: the mapping the Phases, Airdrop and
 * Settings readers share (docs/specs/2026-10-15-airdrop-settings.md, section 6.2).
 */
export function chainStateOf(state: CollectionStateResult, block: bigint): ChainState {
  return {
    block,
    blockTimestamp: Number(state.blockTimestamp),
    maxSupply: Number(state.maxSupply),
    totalMinted: Number(state.totalMinted),
    publicMaxMintPerWallet: Number(state.publicMaxMintPerWallet),
    mintOnBehalfActive: state.mintOnBehalfActive,
    groups: state.groups.map((group) => ({
      id: Number(group.id),
      priceWei: group.price.toString(),
      maxSupply: Number(group.maxSupply),
      minted: Number(group.minted),
      startTimestamp: Number(group.startTimestamp),
      flag: group.activeFlag,
      active: group.active,
    })),
  }
}

/**
 * `collectionState()` at the latest block, or at `atLeast` when the node is behind it, through the
 * server's client for the chain. A failure is logged and answers null, as `readCollectionFees` does.
 */
export const readCollectionState: StateReader = async (chainId, address, atLeast) => {
  try {
    const client = publicClientFor(chainId)
    // cacheTime 0: viem reuses a block number for the poll interval, which can read older than a receipt.
    const latest = await client.getBlockNumber({ cacheTime: 0 })
    const block = atLeast !== undefined && atLeast > latest ? atLeast : latest
    const state = await client.readContract({
      address,
      abi: collectionAbi,
      functionName: 'collectionState',
      blockNumber: block,
    })
    return chainStateOf(state, block)
  } catch (error) {
    console.error(`The collection state could not be read on chain ${chainId}: ${errorSummary(error)}`)
    return null
  }
}

/** The mint_groups columns the view reads, the numeric one as text. */
const PHASE_ROW_COLUMNS =
  'onchain_id, name, description, visible, position, price_wei::text, max_supply, start_at'

/** What every Phases and Whitelist step starts from: the deployment and the rows, under the creator's client. */
export type PhaseBase = {
  chainId: number
  contract: Address
  /** The copy of the public limit. */
  publicMaxPerWallet: number
  /** The copies' read time, or the deploy time before any refresh (Unix seconds). */
  readAt: number
  rows: PhaseRowCopy[]
}

/** The collection's deployment and its rows, or null before deploy (and for a stranger, under the row policies). */
export async function phaseBase(ctx: PhasesContext): Promise<PhaseBase | null> {
  const { data, error } = await ctx.supabase
    .from('deployments')
    .select('chain_id, contract_address, public_max_per_wallet, deployed_at, state_read_at')
    .eq('collection_id', ctx.collection.id)
    .maybeSingle()
  if (error) throw new Error(`The deployment could not be read: ${error.message}`)
  if (!data) return null
  const rows = await ctx.supabase
    .from('mint_groups')
    .select(PHASE_ROW_COLUMNS)
    .eq('collection_id', ctx.collection.id)
  if (rows.error) throw new Error(`The phases could not be read: ${rows.error.message}`)
  return {
    chainId: data.chain_id,
    contract: getAddress(data.contract_address),
    publicMaxPerWallet: data.public_max_per_wallet,
    readAt: Math.floor(Date.parse(data.state_read_at ?? data.deployed_at) / 1000),
    rows: (rows.data ?? []) as unknown as PhaseRowCopy[],
  }
}

/**
 * Writes the copies from a read through `mint_groups_refresh` with the read's block, so a slower read
 * never overwrites a newer one. A value too large for its column, or a refresh that fails, is logged
 * and never fails the view. Settings refreshes them too, with its own read's block, before its settings
 * copies (docs/specs/2026-10-15-airdrop-settings.md, section 6.4).
 */
export async function refreshPhaseCopies(ctx: PhasesContext, state: ChainState): Promise<void> {
  const payload = refreshPayload(state)
  if (!payload) {
    console.error(
      `The phases of ${ctx.collection.id} hold a value too large to copy; the copy keeps its last read.`,
    )
    return
  }
  try {
    const { error } = await ctx.service().rpc('mint_groups_refresh', {
      p_collection_id: ctx.collection.id,
      p_owner: ctx.owner,
      p_block: Number(state.block),
      p_block_time: new Date(state.blockTimestamp * 1000).toISOString(),
      p_public_max_per_wallet: payload.publicMaxPerWallet,
      p_groups: payload.groups as unknown as Json,
    })
    if (error)
      console.error(
        `The phase copies could not be refreshed for ${ctx.collection.id}: ${error.code} ${error.message}`,
      )
  } catch (error) {
    console.error(`The phase copies could not be refreshed for ${ctx.collection.id}: ${errorSummary(error)}`)
  }
}

/** The view from a read (the copies refreshed from it), or the copy when the chain did not answer. */
async function viewOf(ctx: PhasesContext, base: PhaseBase, state: ChainState | null): Promise<PhasesView> {
  if (!state)
    return copyView({
      chainId: base.chainId,
      contract: base.contract,
      rows: base.rows,
      publicMaxPerWallet: base.publicMaxPerWallet,
      maxSupply: ctx.collection.max_supply ?? 0,
      readAt: base.readAt,
    })
  await refreshPhaseCopies(ctx, state)
  return liveView({ chainId: base.chainId, contract: base.contract, rows: base.rows }, state)
}

/** What Phases and the Overview show (section 6.2): the chain's groups joined with their rows. */
export async function phasesViewCore(
  ctx: PhasesContext,
  read: StateReader = readCollectionState,
): Promise<DeployOutcome<PhasesView>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  return { data: await viewOf(ctx, base, await read(base.chainId, base.contract)) }
}

/**
 * Confirms an on-chain change from its receipt (section 6.3), as `confirmDeployCore` without the depth: the
 * receipt must have landed, succeeded, been sent from the sign-in wallet to the collection and carry the
 * expected event. An add's row is written now and only now. Then the chain is read again at the receipt's
 * block or later, the copies refreshed, and the fresh view answered. A second confirm of the same hash
 * answers the view again.
 */
export async function confirmPhaseTxCore(
  ctx: PhasesContext,
  txHash: Hex,
  expected: PhaseTxExpected,
  read: StateReader = readCollectionState,
): Promise<DeployOutcome<PhasesView>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  const hash = txHash.toLowerCase() as Hex
  let client: PublicClient
  try {
    client = publicClientFor(base.chainId)
  } catch {
    return { refused: CHAIN_NOT_READY }
  }
  let receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>
  try {
    receipt = await client.getTransactionReceipt({ hash })
  } catch (error) {
    // Not mined yet, or not visible to this node yet: the machine asks again in 3 seconds.
    if (!(error instanceof TransactionReceiptNotFoundError))
      console.error(`The receipt could not be read: ${errorSummary(error)}`)
    return { refused: PHASE_NOT_CONFIRMED }
  }
  // sic: viem types the receipt as always present; a node can still answer with nothing.
  if (!receipt) return { refused: PHASE_NOT_CONFIRMED }
  if (receipt.status === 'reverted') return { refused: PHASE_REVERTED }
  const match = matchPhaseEvent(receipt, { contract: base.contract, from: ctx.wallet, event: expected.event })
  if (!match.ok) return { refused: match.error }
  let current = base
  if (expected.add) {
    const recorded = await ctx.service().rpc('mint_group_record', {
      p_collection_id: ctx.collection.id,
      p_owner: ctx.owner,
      p_onchain_id: expected.add.onchainId,
      p_name: expected.add.name,
      p_description: expected.add.description,
      p_visible: expected.add.visible,
    })
    if (recorded.error) return { error: recorded.error }
    current = (await phaseBase(ctx)) ?? base
  }
  return { data: await viewOf(ctx, current, await read(base.chainId, base.contract, receipt.blockNumber)) }
}

/**
 * Edit details (section 6.4): the row's name and description under the creator's client, or, for a group
 * the chain lists without a row (registered outside Cobweb), a row recorded through `mint_group_record`.
 */
export async function renamePhaseCore(
  ctx: PhasesContext,
  onchainId: number,
  details: { name: string; description: string },
  read: StateReader = readCollectionState,
): Promise<DeployOutcome<undefined>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  if (base.rows.some((row) => row.onchain_id === onchainId)) {
    const { error } = await ctx.supabase
      .from('mint_groups')
      .update({ name: details.name, description: details.description })
      .eq('collection_id', ctx.collection.id)
      .eq('onchain_id', onchainId)
    return error ? { error } : { data: undefined }
  }
  const state = await read(base.chainId, base.contract)
  if (!state) return { refused: CONTRACT_UNREADABLE }
  if (!state.groups.some((group) => group.id === onchainId)) return { refused: PHASE_NOT_ON_CHAIN }
  const recorded = await ctx.service().rpc('mint_group_record', {
    p_collection_id: ctx.collection.id,
    p_owner: ctx.owner,
    p_onchain_id: onchainId,
    p_name: details.name,
    p_description: details.description,
    p_visible: true,
  })
  return recorded.error ? { error: recorded.error } : { data: undefined }
}

/** Hide from or show on the mint page (section 6.4). The public sale is always shown; a group needs its row. */
export async function setPhaseVisibilityCore(
  ctx: PhasesContext,
  onchainId: number,
  visible: boolean,
): Promise<DeployOutcome<undefined>> {
  if (onchainId === 0) return { refused: PUBLIC_SHOWN }
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  if (!base.rows.some((row) => row.onchain_id === onchainId)) return { refused: NAME_FIRST }
  const { error } = await ctx.supabase
    .from('mint_groups')
    .update({ visible })
    .eq('collection_id', ctx.collection.id)
    .eq('onchain_id', onchainId)
  return error ? { error } : { data: undefined }
}

/** Move up or Move down (section 6.4): `mint_group_move` under the creator's client; past either end nothing changes. */
export async function movePhaseCore(
  ctx: PhasesContext,
  onchainId: number,
  direction: 'up' | 'down',
): Promise<DeployOutcome<undefined>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  if (!base.rows.some((row) => row.onchain_id === onchainId)) return { refused: NAME_FIRST }
  const { error } = await ctx.supabase.rpc('mint_group_move', {
    p_collection_id: ctx.collection.id,
    p_onchain_id: onchainId,
    p_up: direction === 'up',
  })
  return error ? { error } : { data: undefined }
}
