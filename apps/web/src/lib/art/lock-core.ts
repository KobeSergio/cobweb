import { hashTokenList } from '@cobweb/dna'
import { chainById, confirmationsFor, factoryAbi, factoryAddress, hasConfirmations } from '@cobweb/shared'
import { publicClientFor } from '@cobweb/shared/server'
import { TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from 'viem'
import type { Json } from '@/lib/database.types'
import { matchArtPaid } from '@/lib/chain/art-paid'
import type { RenderJob } from '@/lib/demo/types'
import { buildAssetTokenList, hashAssetTokenList, type AssetUploadRow } from './asset-tokens'
import type { DbError } from './db-error'
import type { LockClient, LockCollection } from './lock-collection'
import { lockRefusal, reviewData, type LockList, type ReviewData } from './lock-review'
import { feeReady } from './quote'
import { readAll } from './read-all'
import { readArtRows } from './read-rows'
import { JOB_COLUMNS, toRenderJob, type JobPlaceholder, type JobRow } from './render-job'
import {
  CHAIN_NOT_READY,
  NO_PAYMENT_DUE,
  NO_PAYMENT_FOR_JOB,
  NOT_CONFIRMED,
  PAYMENT_USED,
  SHORT_PAYMENT,
} from './result'
import { toProject } from './rows'

/**
 * The lock and pay steps (docs/specs/2026-10-09-lock-and-pay.md, sections 5 to 7) on a Supabase
 * client acting as the signed-in creator. The server actions (app/actions/lock.ts) call these after
 * the session and ownership check; verify:chain calls them with a signed-in script client. No
 * `server-only` marker, so the script can import it; the browser never does.
 */
export type LockContext = {
  /** The creator's client under row-level security: every read, `art_unlock`, `art_lock_placeholder`. */
  supabase: LockClient
  /**
   * The service-role client, only for `art_lock`, `art_requote` and `art_record_payment`. Built on
   * first use, so a step that never needs it (review, unlock, placeholder, job read) works without
   * the key.
   */
  service: () => LockClient
  /** The verified creator's user id, passed as `p_owner` to the three service functions. */
  owner: string
  wallet: string
  collection: LockCollection
}

/** A step's outcome: its data, a database error for `lockWriteError`, or a sentence the creator reads. */
export type LockOutcome<T> = { data: T } | { error: DbError } | { refused: string }

const asJson = (value: unknown) => value as Json

/** An error as a log line: its name and message only. viem errors can carry the RPC URL with its key. */
export function errorSummary(error: unknown): string {
  if (error instanceof Error) {
    const short = (error as { shortMessage?: unknown }).shortMessage
    return `${error.name}: ${typeof short === 'string' ? short : error.message}`
  }
  return 'Unknown error'
}

/** The list a lock validates, read from the stored rows (spec section 5). */
export async function readLockList(supabase: LockClient, collection: LockCollection): Promise<LockList> {
  if (collection.project_type === 'generative') {
    const rows = await readArtRows(supabase, collection.id)
    const art = toProject({ collection, ...rows, tokens: [] })
    return {
      kind: 'generative',
      project: {
        collections: art.collections ?? [],
        layers: art.layers ?? [],
        rules: art.rules ?? [],
        atLeastOne: art.atLeastOne ?? [],
      },
      tokens: rows.tokens.map((row) => ({
        id: row.token_id,
        collectionId: row.art_collection_id,
        dna: row.dna,
      })),
    }
  }
  const uploads = await readAll<AssetUploadRow>((from, to) =>
    supabase
      .from('uploads')
      .select('id, quantity, attributes, position, created_at')
      .eq('collection_id', collection.id)
      .eq('kind', 'asset')
      .order('position', { nullsFirst: false })
      .order('created_at')
      .order('id')
      .range(from, to),
  )
  return { kind: 'assets', tokens: buildAssetTokenList(uploads) }
}

export async function reviewLock(ctx: LockContext): Promise<ReviewData> {
  return reviewData(await readLockList(ctx.supabase, ctx.collection), ctx.collection.project_type)
}

/** The factory's published rate on a chain, or null when the chain, its RPC or its factory is not there. */
export async function readArtFee(chainId: number): Promise<bigint | null> {
  try {
    return await publicClientFor(chainId).readContract({
      address: factoryAddress(chainId),
      abi: factoryAbi,
      functionName: 'artFeePerToken',
    })
  } catch (error) {
    console.error(`The art fee could not be read on chain ${chainId}: ${errorSummary(error)}`)
    return null
  }
}

function factoryOn(chainId: number | null): Address | null {
  if (chainId === null) return null
  try {
    return factoryAddress(chainId)
  } catch {
    return null
  }
}

/** The collection's latest placeholder file, or null. */
export async function latestPlaceholder(supabase: LockClient, collectionId: string): Promise<JobPlaceholder> {
  const { data, error } = await supabase
    .from('uploads')
    .select('id, media_type')
    .eq('collection_id', collectionId)
    .eq('kind', 'placeholder')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`The placeholder could not be read: ${error.message}`)
  return data ? { uploadId: data.id, mediaType: data.media_type } : null
}

async function jobFromRow(supabase: LockClient, row: JobRow): Promise<RenderJob> {
  let placeholder: JobPlaceholder
  if (row.placeholder_upload_id) {
    const { data, error } = await supabase
      .from('uploads')
      .select('id, media_type')
      .eq('id', row.placeholder_upload_id)
      .maybeSingle()
    if (error) throw new Error(`The placeholder could not be read: ${error.message}`)
    placeholder = data ? { uploadId: data.id, mediaType: data.media_type } : null
  } else {
    placeholder = await latestPlaceholder(supabase, row.collection_id)
  }
  return toRenderJob(row, { factory: factoryOn(row.quote_chain_id), placeholder })
}

/** A job by id as the screen's RenderJob, every wei read as text. */
export async function loadJob(supabase: LockClient, jobId: string): Promise<RenderJob> {
  const { data, error } = await supabase.from('render_jobs').select(JOB_COLUMNS).eq('id', jobId).single()
  if (error) throw new Error(`The render job could not be read: ${error.message}`)
  return jobFromRow(supabase, data as unknown as JobRow)
}

async function openJobRow(
  supabase: LockClient,
  collectionId: string,
  kind: 'real' | 'placeholder',
): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from('render_jobs')
    .select(JOB_COLUMNS)
    .eq('collection_id', collectionId)
    .eq('kind', kind)
    .not('state', 'in', '(done,failed)')
    .maybeSingle()
  if (error) throw new Error(`The render job could not be read: ${error.message}`)
  return data as unknown as JobRow | null
}

async function latestJobRow(
  supabase: LockClient,
  collectionId: string,
  kind: 'real' | 'placeholder',
): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from('render_jobs')
    .select(JOB_COLUMNS)
    .eq('collection_id', collectionId)
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`The render job could not be read: ${error.message}`)
  return data as unknown as JobRow | null
}

/**
 * Locks the art (spec section 7, lockArt): validates the stored list, hashes it, reads the factory's
 * rate on the collection's chain (or the one the creator's wallet is on), and calls `art_lock`.
 */
export async function lockCore(
  ctx: LockContext,
  input: { allowDuplicates: boolean; chainId: number },
): Promise<LockOutcome<RenderJob>> {
  const { supabase, collection } = ctx
  const chainId = collection.chain_id ?? input.chainId
  if (!chainById(chainId)) return { refused: CHAIN_NOT_READY }
  const list = await readLockList(supabase, collection)
  const refusal = lockRefusal(reviewData(list, collection.project_type), input.allowDuplicates)
  if (refusal) return { refused: refusal }
  let fee = 0n
  if (collection.project_type !== 'single_asset') {
    const rate = await readArtFee(chainId)
    if (!feeReady(rate)) return { refused: CHAIN_NOT_READY }
    fee = rate
  }
  const hash =
    list.kind === 'generative' ? await hashTokenList(list.tokens) : await hashAssetTokenList(list.tokens)
  const { data, error } = await ctx.service().rpc('art_lock', {
    p_collection_id: collection.id,
    p_owner: ctx.owner,
    p_kind: collection.project_type,
    p_token_list: asJson(list.tokens),
    p_token_list_hash: hash,
    p_allow_duplicates: input.allowDuplicates,
    // numeric: a decimal string, so no wei is lost; the generated types call numeric `number`.
    p_fee_per_token_wei: fee.toString() as unknown as number,
    p_chain_id: chainId,
    p_payer: ctx.wallet,
  })
  if (error) return { error }
  return { data: await loadJob(supabase, (data as { id: string }).id) }
}

export async function unlockCore(ctx: LockContext): Promise<LockOutcome<null>> {
  const { error } = await ctx.supabase.rpc('art_unlock', { p_collection_id: ctx.collection.id })
  return error ? { error } : { data: null }
}

export async function lockPlaceholderCore(
  ctx: LockContext,
  uploadId: string,
): Promise<LockOutcome<RenderJob>> {
  const { data, error } = await ctx.supabase.rpc('art_lock_placeholder', {
    p_collection_id: ctx.collection.id,
    p_placeholder_upload_id: uploadId,
  })
  if (error) return { error }
  return { data: await loadJob(ctx.supabase, (data as { id: string }).id) }
}

/** The open job, quoted again from the current rate when its quote expired (spec section 7, quoteArt). */
export async function quoteCore(ctx: LockContext): Promise<LockOutcome<RenderJob>> {
  const row = await openJobRow(ctx.supabase, ctx.collection.id, 'real')
  if (!row || row.state !== 'payment_due') return { refused: NO_PAYMENT_DUE }
  const expired = row.quote_expires_at !== null && Date.parse(row.quote_expires_at) < Date.now()
  if (!expired || row.quote_chain_id === null) return { data: await jobFromRow(ctx.supabase, row) }
  const rate = await readArtFee(row.quote_chain_id)
  if (!feeReady(rate)) return { refused: CHAIN_NOT_READY }
  const { error } = await ctx.service().rpc('art_requote', {
    p_collection_id: ctx.collection.id,
    p_owner: ctx.owner,
    p_fee_per_token_wei: rate.toString() as unknown as number,
  })
  if (error) return { error }
  return { data: await loadJob(ctx.supabase, row.id) }
}

/**
 * Verifies a payment from its receipt and records it (spec section 7, confirmArtPayment). The payer
 * and the amount come from the factory's ArtPaid log, never from the browser.
 */
export async function confirmCore(
  ctx: LockContext,
  jobId: string,
  txHash: Hex,
): Promise<LockOutcome<RenderJob>> {
  const { supabase, collection } = ctx
  const hash = txHash.toLowerCase() as Hex
  const used = await supabase.from('render_jobs').select('id').eq('payment_tx_hash', hash).limit(1)
  if (used.error) return { error: used.error }
  if (used.data.length > 0) return { refused: PAYMENT_USED }

  const { data, error } = await supabase
    .from('render_jobs')
    .select(JOB_COLUMNS)
    .eq('id', jobId)
    .eq('collection_id', collection.id)
    .maybeSingle()
  if (error) return { error }
  const row = data as unknown as JobRow | null
  if (!row || row.state !== 'payment_due' || row.quote_chain_id === null || row.quote_payer === null)
    return { refused: NO_PAYMENT_FOR_JOB }

  const factory = factoryOn(row.quote_chain_id)
  let client: PublicClient
  try {
    client = publicClientFor(row.quote_chain_id)
  } catch {
    return { refused: CHAIN_NOT_READY }
  }
  if (!factory) return { refused: CHAIN_NOT_READY }

  let receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>
  try {
    receipt = await client.getTransactionReceipt({ hash })
  } catch (error) {
    // Not mined yet, or not visible to this node yet: the screen asks again in 3 seconds.
    if (!(error instanceof TransactionReceiptNotFoundError))
      console.error(`The receipt could not be read: ${errorSummary(error)}`)
    return { refused: NOT_CONFIRMED }
  }
  // sic: viem types the receipt as always present; a node can still answer with nothing.
  if (!receipt) return { refused: NOT_CONFIRMED }
  // A receipt too shallow to survive a reorg is not recorded yet; the screen keeps asking.
  try {
    const latest = await client.getBlockNumber()
    if (!hasConfirmations(receipt.blockNumber, latest, confirmationsFor(row.quote_chain_id)))
      return { refused: NOT_CONFIRMED }
  } catch (error) {
    console.error(`The latest block could not be read: ${errorSummary(error)}`)
    return { refused: NOT_CONFIRMED }
  }
  const expected = {
    factory,
    jobId: row.onchain_job_id as Hex,
    payer: row.quote_payer,
    minAmount: BigInt(row.quote_total_wei),
  }
  let match = matchArtPaid(receipt, expected)
  // A payment below the quote is still recorded (hash and amount; the job stays payment_due), so the
  // creator's transaction is never lost, and then reported as short.
  const short = !match.ok && match.error === SHORT_PAYMENT
  if (short) match = matchArtPaid(receipt, { ...expected, minAmount: 0n })
  if (!match.ok) return { refused: match.error }

  const recorded = await ctx.service().rpc('art_record_payment', {
    p_collection_id: collection.id,
    p_owner: ctx.owner,
    p_job_id: row.id,
    p_tx_hash: hash,
    p_payer: match.payer.toLowerCase(),
    p_amount_wei: match.amount.toString() as unknown as number,
  })
  if (recorded.error) return { error: recorded.error }
  if (short) return { refused: `${SHORT_PAYMENT} Tell support about job ${row.onchain_job_id}.` }
  return { data: await loadJob(supabase, row.id) }
}

/** The job the screen shows: the placeholder job for deferred art, the real job otherwise; open first, then the latest. */
export async function renderJobCore(ctx: LockContext): Promise<LockOutcome<RenderJob | null>> {
  const kind = ctx.collection.art_deferred ? 'placeholder' : 'real'
  const row =
    (await openJobRow(ctx.supabase, ctx.collection.id, kind)) ??
    (await latestJobRow(ctx.supabase, ctx.collection.id, kind))
  return { data: row ? await jobFromRow(ctx.supabase, row) : null }
}
