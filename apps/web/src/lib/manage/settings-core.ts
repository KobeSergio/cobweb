import { confirmationsFor, hasConfirmations, validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { publicClientFor } from '@cobweb/shared/server'
import {
  decodeFunctionData,
  getAddress,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { errorSummary } from '@/lib/art/lock-core'
import { readAll } from '@/lib/art/read-all'
import {
  CHAIN_NOT_READY,
  NOT_DEPLOYED,
  NOT_THIS_CHANGE,
  NOT_THIS_CONTRACT,
  PHASE_REVERTED,
  SETTINGS_NOT_CONFIRMED,
} from '@/lib/art/result'
import { matchPhaseEvent, type PhaseEventMatch } from '@/lib/chain/phase-events'
import { readEach, revertedRead } from '@/lib/chain/read-each'
import type { Json } from '@/lib/database.types'
import { doneJobRow, type DeployOutcome } from '@/lib/deploy/deploy-core'
import { expectedEvent, type ManageCall } from './phase-calls'
import {
  chainStateOf,
  phaseBase,
  refreshPhaseCopies,
  type CollectionStateResult,
  type PhasesContext,
} from './phases-core'
import type {
  RevealTargets,
  SettingsCopyRow,
  SettingsReader,
  SettingsState,
  SettingsView,
  TransferLevelState,
} from './settings-types'
import { levelOf, settingsPayload, settingsViewOf } from './settings-view'

/**
 * Settings on the server (docs/specs/2026-10-15-airdrop-settings.md, section 6.4): the read of the contract's
 * settings and balances at one block, the view with the reveal targets and the withdrawals Cobweb confirmed, and
 * the confirm of a change from its receipt, on a Supabase client acting as the signed-in creator. The actions
 * (app/actions/settings.ts) call these after the session and ownership check; verify:settings calls them with a
 * signed-in script client. No `server-only` marker, so the script can import it; the browser never does. The
 * copies are written only by `settings_refresh` from the server's own read, and withdrawals only by
 * `withdrawal_record` from a proven receipt.
 */
export type SettingsContext = PhasesContext

/** The deployments copies Settings shows while the chain does not answer, and the deploy-time arguments. */
const COPY_COLUMNS =
  'payout_address, royalty_bps, royalty_receiver, base_uri, transfer_validator, mint_on_behalf, args'

/**
 * The collection's level on its validator at the block: none for the zero address or a validator without code,
 * unread when the validator reverts, answers nothing or cannot be asked. The validator never fails the read.
 */
async function levelAt(
  client: PublicClient,
  validator: Address,
  collection: Address,
  blockNumber: bigint,
): Promise<TransferLevelState> {
  if (validator.toLowerCase() === zeroAddress) return levelOf(validator, false, null)
  try {
    const code = await client.getCode({ address: validator, blockNumber })
    if (!code || code === '0x') return levelOf(validator, false, null)
    const policy = await client.readContract({
      address: validator,
      abi: validatorAbi,
      functionName: 'getCollectionSecurityPolicy',
      args: [collection],
      blockNumber,
    })
    return levelOf(validator, true, policy.transferSecurityLevel)
  } catch (error) {
    if (!revertedRead(error))
      console.error(`The transfer level could not be read from ${validator}: ${errorSummary(error)}`)
    return { kind: 'unread' }
  }
}

/**
 * Ten views at one block, the latest or `atLeast` when the node is behind it: `collectionState()`, the three
 * balances (the refunds held for `wallet`), the payout address, the default royalty (`royaltyInfo(1, 10000)`, its
 * amount being the basis points), the base URI, the transfer validator, the owner and the fees; then the level on
 * the validator. A request that fails, or a view that does not answer, is logged and answers null.
 */
export const readSettingsState: SettingsReader = async (chainId, address, wallet, atLeast) => {
  try {
    const client = publicClientFor(chainId)
    // cacheTime 0: viem reuses a block number for the poll interval, which can read older than a receipt.
    const latest = await client.getBlockNumber({ cacheTime: 0 })
    const block = atLeast !== undefined && atLeast > latest ? atLeast : latest
    const views = await readEach<unknown>(
      client,
      [
        { address, abi: collectionAbi, functionName: 'collectionState' },
        { address, abi: collectionAbi, functionName: 'creatorBalance' },
        { address, abi: collectionAbi, functionName: 'platformBalance' },
        { address, abi: collectionAbi, functionName: 'pendingBalance', args: [wallet] },
        { address, abi: collectionAbi, functionName: 'ownerPayoutAddress' },
        { address, abi: collectionAbi, functionName: 'royaltyInfo', args: [1n, 10_000n] },
        { address, abi: collectionAbi, functionName: 'baseURI' },
        { address, abi: collectionAbi, functionName: 'getTransferValidator' },
        { address, abi: collectionAbi, functionName: 'owner' },
        { address, abi: collectionAbi, functionName: 'fees' },
      ],
      { blockNumber: block },
    )
    if (views.some((view) => view === null)) {
      console.error(`The settings could not be read on chain ${chainId}: a view did not answer.`)
      return null
    }
    const [state, creator, platform, pending, payout, royalty, baseUri, validator, owner, fees] = views
    const chain = chainStateOf(state as CollectionStateResult, block)
    const [receiver, bps] = royalty as readonly [Address, bigint]
    const [mintFeeFlat, mintFeeBps, airdropFeePerToken] = fees as readonly [bigint, bigint, bigint]
    const current = getAddress(validator as Address)
    return {
      block,
      blockTimestamp: chain.blockTimestamp,
      chain,
      creatorBalanceWei: String(creator),
      platformBalanceWei: String(platform),
      pendingBalanceWei: String(pending),
      payout: getAddress(payout as Address),
      royaltyBps: Number(bps),
      royaltyReceiver: getAddress(receiver),
      baseUri: baseUri as string,
      validator: current,
      owner: getAddress(owner as Address),
      fees: {
        mintFeeFlatWei: mintFeeFlat.toString(),
        mintFeeBps: Number(mintFeeBps),
        airdropFeePerTokenWei: airdropFeePerToken.toString(),
      },
      level: await levelAt(client, current, address, block),
    }
  } catch (error) {
    console.error(`The settings could not be read on chain ${chainId}: ${errorSummary(error)}`)
    return null
  }
}

/** The sum of the withdrawals Cobweb confirmed for the collection, wei as a decimal string. */
async function withdrawnWei(ctx: SettingsContext): Promise<string> {
  const rows = await readAll<{ amount_wei: string }>((from, to) =>
    ctx.supabase
      .from('withdrawals')
      .select('amount_wei::text')
      .eq('collection_id', ctx.collection.id)
      .order('tx_hash')
      .range(from, to),
  )
  return rows.reduce((sum, row) => sum + BigInt(row.amount_wei), 0n).toString()
}

/**
 * Writes the copies from a read: the phase copies first, then the settings copies through `settings_refresh`,
 * both with the read's block, since they share `state_block`. A refresh that fails, or that a newer read beat,
 * is logged and never fails the view.
 */
async function refreshCopies(ctx: SettingsContext, state: SettingsState): Promise<void> {
  await refreshPhaseCopies(ctx, state.chain)
  try {
    const { data, error } = await ctx.service().rpc('settings_refresh', {
      p_collection_id: ctx.collection.id,
      p_owner: ctx.owner,
      p_block: Number(state.block),
      p_block_time: new Date(state.blockTimestamp * 1000).toISOString(),
      p_settings: settingsPayload(state) as unknown as Json,
    })
    if (error)
      console.error(
        `The settings copies could not be refreshed for ${ctx.collection.id}: ${error.code} ${error.message}`,
      )
    else if (data === false)
      console.error(
        `The settings copies of ${ctx.collection.id} hold a newer read than block ${state.block}.`,
      )
  } catch (error) {
    console.error(
      `The settings copies could not be refreshed for ${ctx.collection.id}: ${errorSummary(error)}`,
    )
  }
}

/**
 * What Settings and the Overview show (section 6.4): the contract's settings and balances read with the session
 * wallet, the copies refreshed from that read, the reveal targets (the latest done real and placeholder jobs'
 * base URIs and the deploy-time one) and the withdrawals Cobweb confirmed; the copies when the chain does not
 * answer.
 */
export async function settingsViewCore(
  ctx: SettingsContext,
  read: SettingsReader = readSettingsState,
): Promise<DeployOutcome<SettingsView>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  const { data, error } = await ctx.supabase
    .from('deployments')
    .select(COPY_COLUMNS)
    .eq('collection_id', ctx.collection.id)
    .single()
  if (error) throw new Error(`The settings could not be read: ${error.message}`)
  const copies = data as unknown as SettingsCopyRow
  const [real, placeholder] = await Promise.all([
    doneJobRow(ctx.supabase, ctx.collection.id, 'real'),
    doneJobRow(ctx.supabase, ctx.collection.id, 'placeholder'),
  ])
  const targets: RevealTargets = {
    real: real?.base_uri ?? null,
    placeholder: placeholder?.base_uri ?? null,
    start: copies.args.baseUri,
  }
  const withdrawn = await withdrawnWei(ctx)
  const state = await read(base.chainId, base.contract, getAddress(ctx.wallet))
  if (state) await refreshCopies(ctx, state)
  return {
    data: settingsViewOf(
      { chainId: base.chainId, contract: base.contract, readAt: base.readAt },
      copies,
      targets,
      withdrawn,
      state,
    ),
  }
}

/** Whether a transaction's input is `setBaseURI` with exactly this URI. */
function setsBaseUri(input: Hex, uri: string): boolean {
  try {
    const call = decodeFunctionData({ abi: collectionAbi, data: input })
    return call.functionName === 'setBaseURI' && call.args[0] === uri
  } catch {
    // Not a call of the collection's ABI.
    return false
  }
}

/**
 * Confirms a Settings change from its receipt (section 6.4): not found yet is SETTINGS_NOT_CONFIRMED, which the
 * machine polls; reverted is PHASE_REVERTED. The level call must have gone to the collection's own validator at
 * the receipt's block and carry the validator's event; any other call the collection's event for it. A reveal is
 * also proven from its calldata, the URI being exactly the one sent; a withdrawal waits for the chain's depth and
 * is recorded from its event. Then the view is read at the receipt's block or later, which refreshes the copies.
 * A second confirm of the same hash answers the view again; a withdrawal stays recorded once.
 */
export async function confirmSettingsTxCore(
  ctx: SettingsContext,
  txHash: Hex,
  call: ManageCall,
  read: SettingsReader = readSettingsState,
): Promise<DeployOutcome<SettingsView>> {
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
    return { refused: SETTINGS_NOT_CONFIRMED }
  }
  // sic: viem types the receipt as always present; a node can still answer with nothing.
  if (!receipt) return { refused: SETTINGS_NOT_CONFIRMED }
  if (receipt.status === 'reverted') return { refused: PHASE_REVERTED }
  if (call.functionName === 'withdrawMintFunds') {
    // A withdrawal is recorded and never read from the chain again, so it waits for the chain's depth.
    try {
      const latest = await client.getBlockNumber({ cacheTime: 0 })
      if (!hasConfirmations(receipt.blockNumber, latest, confirmationsFor(base.chainId)))
        return { refused: SETTINGS_NOT_CONFIRMED }
    } catch (error) {
      console.error(`The latest block could not be read: ${errorSummary(error)}`)
      return { refused: SETTINGS_NOT_CONFIRMED }
    }
  }
  let match: PhaseEventMatch
  if (call.target) {
    let validator: Address
    try {
      validator = await client.readContract({
        address: base.contract,
        abi: collectionAbi,
        functionName: 'getTransferValidator',
        blockNumber: receipt.blockNumber,
      })
    } catch (error) {
      console.error(`The transfer validator could not be read: ${errorSummary(error)}`)
      return { refused: SETTINGS_NOT_CONFIRMED }
    }
    if (validator.toLowerCase() !== call.target.address.toLowerCase()) return { refused: NOT_THIS_CONTRACT }
    match = matchPhaseEvent(receipt, {
      contract: call.target.address,
      from: ctx.wallet,
      event: expectedEvent(call),
      abi: validatorAbi,
    })
  } else {
    match = matchPhaseEvent(receipt, {
      contract: base.contract,
      from: ctx.wallet,
      event: expectedEvent(call),
    })
  }
  if (!match.ok) return { refused: match.error }
  if (call.functionName === 'setBaseURI') {
    let input: Hex
    try {
      input = (await client.getTransaction({ hash })).input
    } catch (error) {
      if (!(error instanceof TransactionNotFoundError))
        console.error(`The transaction could not be read: ${errorSummary(error)}`)
      return { refused: SETTINGS_NOT_CONFIRMED }
    }
    if (!setsBaseUri(input, call.args[0])) return { refused: NOT_THIS_CHANGE }
  }
  if (call.functionName === 'withdrawMintFunds') {
    const recorded = await ctx.service().rpc('withdrawal_record', {
      p_collection_id: ctx.collection.id,
      p_owner: ctx.owner,
      p_tx: hash,
      // Wei as a decimal string, so none is lost; PostgREST casts it to numeric.
      p_amount_wei: String(match.args.amount) as unknown as number,
      p_payout_address: String(match.args.payoutAddress).toLowerCase(),
      p_block: Number(receipt.blockNumber),
    })
    if (recorded.error) return { error: recorded.error }
  }
  const block = receipt.blockNumber
  return settingsViewCore(ctx, (chainId, address, wallet) => read(chainId, address, wallet, block))
}
