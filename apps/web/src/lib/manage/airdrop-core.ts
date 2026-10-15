import { confirmationsFor, hasConfirmations } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { publicClientFor } from '@cobweb/shared/server'
import {
  getAddress,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { errorSummary } from '@/lib/art/lock-core'
import { readAll } from '@/lib/art/read-all'
import { AIRDROP_NOT_CONFIRMED, CHAIN_NOT_READY, NOT_DEPLOYED, PHASE_REVERTED } from '@/lib/art/result'
import { proveAirdrop } from '@/lib/chain/airdrop-batch'
import { readEach } from '@/lib/chain/read-each'
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import type { AirdropReader, AirdropView } from './airdrop-types'
import { airdropRowsOf, airdropViewOf, type AirdropDbRow } from './airdrop-view'
import { chainStateOf, phaseBase, type CollectionStateResult, type PhasesContext } from './phases-core'

/**
 * Airdrop on the server (docs/specs/2026-10-15-airdrop-settings.md, section 6.3): the read of the contract's
 * fee, supply and owner, the view with Cobweb's records, and the confirm of a batch from its receipt and calldata,
 * on a Supabase client acting as the signed-in creator. The actions (app/actions/airdrop.ts) call these after the
 * session and ownership check; verify:airdrop calls them with a signed-in script client. No `server-only` marker,
 * so the script can import it; the browser never does. Records are written only by `airdrop_record`, from what a
 * proven transaction carried, never from browser values.
 */
export type AirdropContext = PhasesContext

/** The `airdrops` columns the view reads, the fee as text. */
const AIRDROP_COLUMNS =
  'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, confirmed_at'

/**
 * `collectionState()`, `fees()` and `owner()` at one block, the latest or `atLeast` when the node is behind it.
 * A request that fails, or a view that does not answer, is logged and answers null.
 */
export const readAirdropState: AirdropReader = async (chainId, address, atLeast) => {
  try {
    const client = publicClientFor(chainId)
    // cacheTime 0: viem reuses a block number for the poll interval, which can read older than a receipt.
    const latest = await client.getBlockNumber({ cacheTime: 0 })
    const block = atLeast !== undefined && atLeast > latest ? atLeast : latest
    const [state, fees, owner] = await readEach<unknown>(
      client,
      [
        { address, abi: collectionAbi, functionName: 'collectionState' },
        { address, abi: collectionAbi, functionName: 'fees' },
        { address, abi: collectionAbi, functionName: 'owner' },
      ],
      { blockNumber: block },
    )
    if (!state || !fees || !owner) {
      console.error(`The airdrop state could not be read on chain ${chainId}: a view did not answer.`)
      return null
    }
    const chain = chainStateOf(state as CollectionStateResult, block)
    const [, , airdropFeePerToken] = fees as readonly [bigint, bigint, bigint]
    return {
      block,
      blockTimestamp: chain.blockTimestamp,
      maxSupply: chain.maxSupply,
      totalMinted: chain.totalMinted,
      feePerTokenWei: airdropFeePerToken.toString(),
      owner: getAddress(owner as Address),
    }
  } catch (error) {
    console.error(`The airdrop state could not be read on chain ${chainId}: ${errorSummary(error)}`)
    return null
  }
}

/**
 * What the Airdrop tab shows (section 6.3): Cobweb's records of the collection, newest block first, with the
 * contract's fee, supply and owner, or the records alone when the chain does not answer. It refreshes nothing.
 */
export async function airdropViewCore(
  ctx: AirdropContext,
  read: AirdropReader = readAirdropState,
): Promise<DeployOutcome<AirdropView>> {
  const base = await phaseBase(ctx)
  if (!base) return { refused: NOT_DEPLOYED }
  const rows = await readAll<AirdropDbRow>((from, to) =>
    ctx.supabase
      .from('airdrops')
      .select(AIRDROP_COLUMNS)
      .eq('collection_id', ctx.collection.id)
      .order('block', { ascending: false })
      .order('tx_hash')
      .range(from, to),
  )
  const state = await read(base.chainId, base.contract)
  return {
    data: airdropViewOf(
      {
        chainId: base.chainId,
        contract: base.contract,
        maxSupply: ctx.collection.max_supply ?? 0,
        readAt: base.readAt,
      },
      airdropRowsOf(rows),
      state,
    ),
  }
}

/**
 * Confirms a batch (section 6.3): the receipt (not found yet is AIRDROP_NOT_CONFIRMED, which the machine polls;
 * reverted is PHASE_REVERTED), the chain's confirmation depth, the transaction's input, the proof from the calldata
 * and the logs, then the record through `airdrop_record` and the view read at the receipt's block or later. The
 * browser sends only the hash. A second confirm of the same hash records nothing and answers the view again.
 */
export async function confirmAirdropCore(
  ctx: AirdropContext,
  txHash: Hex,
  read: AirdropReader = readAirdropState,
): Promise<DeployOutcome<AirdropView>> {
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
    return { refused: AIRDROP_NOT_CONFIRMED }
  }
  // sic: viem types the receipt as always present; a node can still answer with nothing.
  if (!receipt) return { refused: AIRDROP_NOT_CONFIRMED }
  if (receipt.status === 'reverted') return { refused: PHASE_REVERTED }
  // A receipt too shallow to survive a reorg is not recorded yet: nothing reads the batch from the chain again.
  try {
    const latest = await client.getBlockNumber({ cacheTime: 0 })
    if (!hasConfirmations(receipt.blockNumber, latest, confirmationsFor(base.chainId)))
      return { refused: AIRDROP_NOT_CONFIRMED }
  } catch (error) {
    console.error(`The latest block could not be read: ${errorSummary(error)}`)
    return { refused: AIRDROP_NOT_CONFIRMED }
  }
  let input: Hex
  try {
    input = (await client.getTransaction({ hash })).input
  } catch (error) {
    if (!(error instanceof TransactionNotFoundError))
      console.error(`The transaction could not be read: ${errorSummary(error)}`)
    return { refused: AIRDROP_NOT_CONFIRMED }
  }
  const proof = proveAirdrop(receipt, input, { contract: base.contract, from: ctx.wallet })
  if (!proof.ok) return { refused: proof.error }
  const recorded = await ctx.service().rpc('airdrop_record', {
    p_collection_id: ctx.collection.id,
    p_owner: ctx.owner,
    p_tx: hash,
    p_kind: proof.batch.kind,
    p_recipients: proof.batch.recipients,
    p_tokens: proof.batch.tokens,
    // Wei as a decimal string, so none is lost; PostgREST casts it to numeric.
    p_fee_paid_wei: proof.batch.feePaidWei as unknown as number,
    p_first_token_id: proof.batch.firstTokenId,
    p_last_token_id: proof.batch.lastTokenId,
    p_block: Number(receipt.blockNumber),
    p_sent_by: receipt.from.toLowerCase(),
  })
  if (recorded.error) return { error: recorded.error }
  const block = receipt.blockNumber
  return airdropViewCore(ctx, (chainId, address) => read(chainId, address, block))
}
