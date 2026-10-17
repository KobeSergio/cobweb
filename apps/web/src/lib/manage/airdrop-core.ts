import {
  chainStateOf,
  confirmationsFor,
  hasConfirmations,
  readEach,
  type CollectionStateResult,
} from '@cobweb/shared'
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
import { z } from 'zod'
import { errorSummary } from '@/lib/art/lock-core'
import { readAll } from '@/lib/art/read-all'
import {
  AIRDROP_NOT_CONFIRMED,
  CHAIN_NOT_READY,
  NOT_DEPLOYED,
  PHASE_REVERTED,
  RECIPIENTS_NOT_READ,
} from '@/lib/art/result'
import { proveAirdrop } from '@/lib/chain/airdrop-batch'
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import {
  RECIPIENTS_PAGE,
  type AirdropReader,
  type AirdropView,
  type RecipientPage,
  type RecipientRow,
} from './airdrop-types'
import {
  airdropRowsOf,
  airdropViewOf,
  recipientRowsOf,
  recipientSearchOf,
  type AirdropDbRow,
  type RecipientDbRow,
} from './airdrop-view'
import { phaseBase, type PhasesContext } from './phases-core'

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
  'tx_hash, kind, recipients, tokens, fee_paid_wei::text, first_token_id, last_token_id, block, confirmed_at, block_time'
/** The `airdrop_recipients` columns By recipient reads. */
const RECIPIENT_COLUMNS = 'tx_hash, recipient, tokens, first_token_id, block_time'

/** By recipient's query: up to 42 characters of search (an address with its 0x) and a page from 0 to 4,000. */
const recipientsQuery = z.object({
  search: z.string().max(42),
  page: z.number().int().min(0).max(4_000),
})

/**
 * The collection's cursor's synced time in Unix seconds, the chain's time at the indexer's last read to the
 * confirmation depth; null before it has read every block since the deploy, so the history is not complete
 * yet (docs/specs/2026-10-16-indexer-overview.md, decision 21).
 */
async function countedOf(ctx: AirdropContext): Promise<number | null> {
  const { data, error } = await ctx.supabase
    .from('indexer_cursors')
    .select('synced_at')
    .eq('collection_id', ctx.collection.id)
    .maybeSingle()
  if (error) throw new Error(`The indexer's cursor could not be read: ${error.message}`)
  return data?.synced_at ? Math.floor(Date.parse(data.synced_at) / 1000) : null
}

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
 * What the Airdrop tab shows (section 6.3): the collection's airdrops, Cobweb's and the indexer's, newest block
 * first, with the contract's fee, supply and owner, or the records alone when the chain does not answer, and
 * when the indexer last read the collection to the chain's depth, null before it has counted it. It refreshes
 * nothing.
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
  const countedAt = await countedOf(ctx)
  const state = await read(base.chainId, base.contract)
  return {
    data: airdropViewOf(
      {
        chainId: base.chainId,
        contract: base.contract,
        maxSupply: ctx.collection.max_supply ?? 0,
        readAt: base.readAt,
        countedAt,
      },
      airdropRowsOf(rows),
      state,
    ),
  }
}

/** By recipient's order: newest block first, then each transaction's runs by their first token id. */
const RECIPIENTS_ORDER = { block: { ascending: false }, first_token_id: { ascending: true } } as const

/**
 * One page of By recipient (docs/specs/2026-10-16-indexer-overview.md, section 7.3): 25 rows of
 * `airdrop_recipients`, newest first, with an exact count, filtered to the addresses holding the search's hex
 * digits. A query it cannot read is refused with RECIPIENTS_NOT_READ; a page past the last answers no row with
 * the count.
 */
export async function airdropRecipientsCore(
  ctx: AirdropContext,
  query: { search: string; page: number },
): Promise<DeployOutcome<RecipientPage>> {
  const parsed = recipientsQuery.safeParse(query)
  if (!parsed.success) return { refused: RECIPIENTS_NOT_READ }
  const { page } = parsed.data
  const search = recipientSearchOf(parsed.data.search)
  const matching = (head: boolean) => {
    const select = ctx.supabase
      .from('airdrop_recipients')
      .select(RECIPIENT_COLUMNS, { count: 'exact', head })
      .eq('collection_id', ctx.collection.id)
    return search ? select.like('recipient', `%${search}%`) : select
  }
  const from = page * RECIPIENTS_PAGE
  const { data, error, count } = await matching(false)
    .order('block', RECIPIENTS_ORDER.block)
    .order('first_token_id', RECIPIENTS_ORDER.first_token_id)
    .range(from, from + RECIPIENTS_PAGE - 1)
  if (error?.code === 'PGRST103') {
    // A page past the last: PostgREST refuses its range (416), so the page is empty and the count read alone.
    const total = await matching(true)
    if (total.error) throw new Error(`The recipients could not be counted: ${total.error.message}`)
    return { data: { rows: [], total: total.count ?? 0, page } }
  }
  if (error) throw new Error(`The recipients could not be read: ${error.message}`)
  return { data: { rows: recipientRowsOf(data), total: count ?? 0, page } }
}

/** Every row of By recipient, for its export: read 1,000 at a time, in the page's order. */
export async function airdropRecipientsAllCore(ctx: AirdropContext): Promise<DeployOutcome<RecipientRow[]>> {
  const rows = await readAll<RecipientDbRow>((from, to) =>
    ctx.supabase
      .from('airdrop_recipients')
      .select(RECIPIENT_COLUMNS)
      .eq('collection_id', ctx.collection.id)
      .order('block', RECIPIENTS_ORDER.block)
      .order('first_token_id', RECIPIENTS_ORDER.first_token_id)
      .range(from, to),
  )
  return { data: recipientRowsOf(rows) }
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
