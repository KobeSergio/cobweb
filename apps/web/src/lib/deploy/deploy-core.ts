import {
  availableChains,
  chainById,
  collectionSalt,
  confirmationsFor,
  encodeCollectionArgs,
  factoryAbi,
  factoryAddress,
  hasConfirmations,
  predictCollectionAddress,
} from '@cobweb/shared'
import { COLLECTION_CODE_HASH, COLLECTION_CREATION_CODE } from '@cobweb/shared/collection'
import { publicClientFor } from '@cobweb/shared/server'
import { getAddress, TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from 'viem'
import type { LockClient } from '@/lib/art/lock-collection'
import { errorSummary, loadJob, type LockContext, type LockOutcome } from '@/lib/art/lock-core'
import { JOB_COLUMNS, type JobRow } from '@/lib/art/render-job'
import {
  ALREADY_DEPLOYED,
  CHAIN_NOT_READY,
  DEPLOY_NOT_CONFIRMED,
  DEPLOY_REVERTED,
  DEPLOY_USED,
  FACTORY_UNREADABLE,
  LINK_REQUIRED,
  NOT_RENDERED,
  SUPPLY_REQUIRED,
  WRONG_CHAIN,
} from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import { matchCollectionDeployed } from '@/lib/chain/collection-deployed'
import { slugState } from '@/lib/collections'
import type { Json } from '@/lib/database.types'
import type { FeeSnapshot, RenderJobState } from '@/lib/demo/types'
import {
  collectionArgsOf,
  deployArgs,
  launchPhasesOf,
  placeholderPending,
  resolveDeployChain,
  revealsToOf,
  startJobOf,
  validateDeployForm,
} from './deploy-args'
import type {
  DeployChain,
  DeployForm,
  DeployRecord,
  DeployView,
  DoneJob,
  Prepared,
  PreparedArgs,
} from './deploy-types'

/**
 * The deploy steps (docs/specs/2026-10-14-deploy.md, section 6) on a Supabase client acting as the
 * signed-in creator. The server actions (app/actions/deploy.ts) call these after the session and
 * ownership check; verify:deploy calls them with a signed-in script client. No `server-only` marker,
 * so the script can import it; the browser never does.
 */
export type DeployContext = Omit<LockContext, 'queue'>
export type DeployOutcome<T> = LockOutcome<T>

/** The factory's `collectionFees()` on a chain as the screens show it, or null when the chain, its RPC or its factory is not there. */
export async function readCollectionFees(chainId: number): Promise<FeeSnapshot | null> {
  try {
    const [flat, bps, airdrop] = await publicClientFor(chainId).readContract({
      address: factoryAddress(chainId),
      abi: factoryAbi,
      functionName: 'collectionFees',
    })
    return {
      mintFeeFlatWei: flat.toString(),
      mintFeeBps: Number(bps),
      airdropFeePerTokenWei: airdrop.toString(),
    }
  } catch (error) {
    console.error(`The collection fees could not be read on chain ${chainId}: ${errorSummary(error)}`)
    return null
  }
}

function factoryOn(chainId: number): Address | null {
  try {
    return factoryAddress(chainId)
  } catch {
    return null
  }
}

/** The chains the deploy screen offers (the launch chains, plus Sepolia and Anvil outside production), each with its factory when configured. */
export function deployChains(): DeployChain[] {
  return availableChains().map((chain) => ({ ...chainView(chain.id), factory: factoryOn(chain.id) }))
}

/** The collection's latest done job of a kind, or null. */
async function doneJobRow(
  supabase: LockClient,
  collectionId: string,
  kind: 'real' | 'placeholder',
): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from('render_jobs')
    .select(JOB_COLUMNS)
    .eq('collection_id', collectionId)
    .eq('kind', kind)
    .eq('state', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`The render job could not be read: ${error.message}`)
  return data as unknown as JobRow | null
}

/** The state of the collection's latest placeholder job by creation, whatever it is, or null without one. */
async function latestPlaceholderState(
  supabase: LockClient,
  collectionId: string,
): Promise<RenderJobState | null> {
  const { data, error } = await supabase
    .from('render_jobs')
    .select('state')
    .eq('collection_id', collectionId)
    .eq('kind', 'placeholder')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`The render job could not be read: ${error.message}`)
  return data?.state ?? null
}

type DoneRows = { start: JobRow | null; real: JobRow | null }

async function doneRows(ctx: DeployContext): Promise<DoneRows> {
  const { supabase, collection } = ctx
  const artDeferred = collection.art_deferred
  const [real, placeholder, placeholderState] = await Promise.all([
    doneJobRow(supabase, collection.id, 'real'),
    doneJobRow(supabase, collection.id, 'placeholder'),
    artDeferred ? latestPlaceholderState(supabase, collection.id) : null,
  ])
  // A placeholder locked again after a finish is still rendering: the done one is stale, so there is
  // nothing to start on until the new one finishes (ruling on Task 3's review; the database cannot tell).
  if (placeholderPending({ artDeferred, latestPlaceholderState: placeholderState }))
    return { start: null, real }
  return { start: startJobOf({ artDeferred, real, placeholder }), real }
}

async function asDoneJob(supabase: LockClient, row: JobRow | null): Promise<DoneJob | null> {
  if (!row) return null
  const job = await loadJob(supabase, row.id)
  if (job.state !== 'done') throw new Error(`Render job ${row.id} is not done.`)
  return job
}

/** The refusals every deploy step shares, in the order the creator should read them (section 6.1). */
function refusalBefore(ctx: DeployContext, rows: DoneRows): string | null {
  const { collection } = ctx
  if (collection.status === 'deployed') return ALREADY_DEPLOYED
  // A slug with no reservation time, or one older than 3 days, is lapsed; a deployed one never gets here.
  if (slugState(collection).kind !== 'reserved') return LINK_REQUIRED
  if (collection.max_supply === null) return SUPPLY_REQUIRED
  if (!rows.start) return NOT_RENDERED
  return null
}

/**
 * Builds the constructor from the collection row, the finished render and the creator's form, encodes
 * it, picks the salt and predicts the address (section 6.1). Nothing is written. The refusals are
 * the ones `collection_record_deploy` would raise, decided here first so the creator reads them
 * before the wallet opens.
 */
export async function prepareCore(ctx: DeployContext, form: DeployForm): Promise<DeployOutcome<Prepared>> {
  const { collection } = ctx
  const rows = await doneRows(ctx)
  const refusal = refusalBefore(ctx, rows)
  if (refusal) return { refused: refusal }
  // refusalBefore made these non-null; TypeScript cannot see it. A done job always has its base URI.
  if (!rows.start || rows.start.base_uri === null || collection.max_supply === null)
    return { refused: NOT_RENDERED }
  const valid = validateDeployForm(form, collection.max_supply)
  if (!valid.ok) return { refused: valid.error }
  const chainId = resolveDeployChain(rows.real?.quote_chain_id ?? null, valid.data.chainId)
  if (chainId === null) return { refused: WRONG_CHAIN }
  if (!chainById(chainId)) return { refused: CHAIN_NOT_READY }
  const factory = factoryOn(chainId)
  if (!factory) return { refused: CHAIN_NOT_READY }
  const deployer = getAddress(ctx.wallet)
  const args = deployArgs(
    { name: collection.name, symbol: collection.symbol, max_supply: collection.max_supply },
    { base_uri: rows.start.base_uri },
    valid.data,
    deployer,
  )
  const encodedArgs = encodeCollectionArgs(collectionArgsOf(args))
  const salt = collectionSalt(collection.id)
  const predicted = predictCollectionAddress({
    factory,
    deployer,
    salt,
    creationCode: COLLECTION_CREATION_CODE,
    args: encodedArgs,
  })
  const fees = await readCollectionFees(chainId)
  if (!fees) return { refused: FACTORY_UNREADABLE }
  return {
    data: {
      chainId,
      factory,
      deployer,
      salt,
      codeHash: COLLECTION_CODE_HASH,
      args,
      groups: valid.data.groups,
      encodedArgs,
      predicted,
      baseUri: rows.start.base_uri,
      revealsTo: revealsToOf(rows.start, rows.real),
      fees,
    },
  }
}

/**
 * The numeric columns as text, so no wei is lost (PostgREST answers numeric as a JSON number). The public
 * limit and the launch phases come from `args`, the constructor as prepared: `public_max_per_wallet` and
 * the `mint_groups` prices are the copies Phases refreshes (docs/specs/2026-10-15-phases.md, section 7.5).
 */
const DEPLOYMENT_COLUMNS =
  'collection_id, chain_id, contract_address, tx_hash, deployer, deployed_at, base_uri, payout_address, royalty_bps, royalty_receiver, args, mint_fee_flat_wei::text, mint_fee_bps, airdrop_fee_per_token_wei::text'

type DeploymentRow = {
  collection_id: string
  chain_id: number
  contract_address: string
  tx_hash: string
  deployer: string
  deployed_at: string
  base_uri: string
  payout_address: string
  royalty_bps: number
  royalty_receiver: string
  args: PreparedArgs
  mint_fee_flat_wei: string
  mint_fee_bps: number
  airdrop_fee_per_token_wei: string
}

type GroupRow = { onchain_id: number; name: string }

/** The collection's deployment and its launch phases under the creator's client, or null before deploy (section 6.3). */
export async function readDeployment(
  supabase: LockClient,
  collectionId: string,
): Promise<DeployRecord | null> {
  const { data, error } = await supabase
    .from('deployments')
    .select(DEPLOYMENT_COLUMNS)
    .eq('collection_id', collectionId)
    .maybeSingle()
  if (error) throw new Error(`The deployment could not be read: ${error.message}`)
  if (!data) return null
  const row = data as unknown as DeploymentRow
  const groups = await supabase
    .from('mint_groups')
    .select('onchain_id, name')
    .eq('collection_id', collectionId)
  if (groups.error) throw new Error(`The launch phases could not be read: ${groups.error.message}`)
  return {
    chainId: row.chain_id,
    contractAddress: getAddress(row.contract_address),
    txHash: row.tx_hash as Hex,
    deployer: getAddress(row.deployer),
    deployedAt: Math.floor(Date.parse(row.deployed_at) / 1000),
    baseUri: row.base_uri,
    payout: getAddress(row.payout_address),
    royaltyBps: row.royalty_bps,
    royaltyReceiver: getAddress(row.royalty_receiver),
    publicMaxPerWallet: Number(row.args.publicMaxPerWallet),
    fees: {
      mintFeeFlatWei: row.mint_fee_flat_wei,
      mintFeeBps: row.mint_fee_bps,
      airdropFeePerTokenWei: row.airdrop_fee_per_token_wei,
    },
    groups: launchPhasesOf(row.args, (groups.data ?? []) as GroupRow[]),
  }
}

/**
 * Verifies a deployment from its receipt and records it (section 6.2). Mirrors `confirmCore`: the
 * address comes from the factory's `CollectionDeployed` log and is recorded only when it equals the
 * prediction rebuilt from the same inputs. A second confirm with the recorded hash answers the record unchanged.
 */
export async function confirmDeployCore(
  ctx: DeployContext,
  txHash: Hex,
  form: DeployForm,
): Promise<DeployOutcome<DeployRecord>> {
  const { supabase, collection } = ctx
  const hash = txHash.toLowerCase() as Hex
  const existing = await readDeployment(supabase, collection.id)
  if (existing) return existing.txHash === hash ? { data: existing } : { refused: ALREADY_DEPLOYED }
  const prepared = await prepareCore(ctx, form)
  if (!('data' in prepared)) return prepared
  const used = await supabase.from('deployments').select('collection_id').eq('tx_hash', hash).limit(1)
  if (used.error) return { error: used.error }
  if (used.data.length > 0) return { refused: DEPLOY_USED }

  const { chainId, factory, deployer, salt, codeHash, predicted, args, groups, fees, baseUri } = prepared.data
  let client: PublicClient
  try {
    client = publicClientFor(chainId)
  } catch {
    return { refused: CHAIN_NOT_READY }
  }
  let receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>
  try {
    receipt = await client.getTransactionReceipt({ hash })
  } catch (error) {
    // Not mined yet, or not visible to this node yet: the screen asks again in 3 seconds.
    if (!(error instanceof TransactionReceiptNotFoundError))
      console.error(`The receipt could not be read: ${errorSummary(error)}`)
    return { refused: DEPLOY_NOT_CONFIRMED }
  }
  // sic: viem types the receipt as always present; a node can still answer with nothing.
  if (!receipt) return { refused: DEPLOY_NOT_CONFIRMED }
  if (receipt.status === 'reverted') return { refused: DEPLOY_REVERTED }
  // A receipt too shallow to survive a reorg is not recorded yet; the screen keeps asking. cacheTime 0:
  // viem reuses a block number for the poll interval, which can read older than the receipt just fetched.
  try {
    const latest = await client.getBlockNumber({ cacheTime: 0 })
    if (!hasConfirmations(receipt.blockNumber, latest, confirmationsFor(chainId)))
      return { refused: DEPLOY_NOT_CONFIRMED }
  } catch (error) {
    console.error(`The latest block could not be read: ${errorSummary(error)}`)
    return { refused: DEPLOY_NOT_CONFIRMED }
  }
  const match = matchCollectionDeployed(receipt, { factory, deployer, salt, codeHash, predicted })
  if (!match.ok) return { refused: match.error }

  const recorded = await ctx.service().rpc('collection_record_deploy', {
    p_collection_id: collection.id,
    p_owner: ctx.owner,
    p_chain_id: chainId,
    p_factory: factory.toLowerCase(),
    p_deployer: deployer.toLowerCase(),
    p_salt: salt,
    p_code_hash: codeHash,
    p_args: args as unknown as Json,
    p_contract_address: match.collection.toLowerCase(),
    p_tx_hash: hash,
    p_base_uri: baseUri,
    p_payout_address: args.payout.toLowerCase(),
    p_royalty_bps: args.royaltyBps,
    p_royalty_receiver: args.royaltyReceiver.toLowerCase(),
    p_public_max_per_wallet: Number(args.publicMaxPerWallet),
    // numeric: decimal strings, so no wei is lost; the generated types call numeric `number`.
    p_mint_fee_flat_wei: fees.mintFeeFlatWei as unknown as number,
    p_mint_fee_bps: fees.mintFeeBps,
    p_airdrop_fee_per_token_wei: fees.airdropFeePerTokenWei as unknown as number,
    p_groups: groups.map((group) => ({
      name: group.name,
      price_wei: group.priceWei,
      max_supply: group.maxSupply,
    })) as unknown as Json,
  })
  if (recorded.error) return { error: recorded.error }
  const record = await readDeployment(supabase, collection.id)
  if (!record) throw new Error('The deployment was recorded and cannot be read back.')
  return { data: record }
}

/** What the deploy page shows (section 7.2): the finished jobs, the paid chain, its fee snapshot and the record. */
export async function deployViewCore(ctx: DeployContext): Promise<DeployOutcome<DeployView>> {
  const rows = await doneRows(ctx)
  const [start, real, record] = await Promise.all([
    asDoneJob(ctx.supabase, rows.start),
    asDoneJob(ctx.supabase, rows.real),
    readDeployment(ctx.supabase, ctx.collection.id),
  ])
  const chainId = record?.chainId ?? rows.real?.quote_chain_id ?? null
  const fees = record ? record.fees : chainId !== null ? await readCollectionFees(chainId) : null
  return { data: { jobs: { start, real }, chainId, fees, record } }
}
