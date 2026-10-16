import { DEFAULT_TRANSFER_VALIDATOR, type QuotaBody, type StateBody, type WalletBody } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ChainMismatchError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  encodeEventTopics,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import {
  DEMO_CREATOR,
  DEMO_DEPLOYMENT,
  DEMO_NOW,
  DEMO_PLACEHOLDER,
  DEMO_RENDER_JOBS,
  DEMO_TOKENS,
  getMintPageData,
  MINT_PAGE_VARIANTS,
  sampleTxHash,
  tokenLayerUrls,
  type MintGroup,
  type MintPageVariant,
  type WalletState,
} from '@/lib/demo'
import type { MintSource } from '@/lib/mint/live-source'
import type { MintCall } from '@/lib/mint/mint-call'
import type { MintFailureKind } from '@/lib/mint/mint-failure'
import type { MintChain } from '@/lib/mint/mint-run'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import type { TokenArt } from '@/lib/mint/token-art'

/**
 * The sample-mode source (docs/specs/2026-10-16-mint-page-live-data.md, section 8): the same answers the live
 * source gives, made from `lib/demo`, so every state of the page can be reviewed without a wallet, a server or a
 * chain. Its clock advances in real seconds from `DEMO_NOW`, and a scheduled group reads active 2 s after its
 * start on that clock, as the chain would report it. Its chain simulates the check, the wallet and the receipt
 * with realistic pauses, and the mints it confirms join its answers from their block on.
 */

/** How the sample's wallet is connected: `null` follows a real connection with the sample's allowances. */
export type SampleWalletMode = 'connected' | 'not-listed' | 'limit' | 'wrong-chain' | null

/**
 * The query switches of the sample page, read in the browser from its own location, so the page's route stays
 * cached by link (components/mint/sample-page.tsx):
 *
 *   ?state=upcoming | allowlist-live | public-live | sold-out | closed   (default allowlist-live)
 *   ?wallet=connected     a sample wallet, connected without a real wallet
 *   ?wallet=not-listed    connected, but on no whitelist and with no vaults
 *   ?wallet=limit         connected, every allowance used
 *   ?wallet=wrong-chain   connected on another network
 *   ?fail=<kind>          the first mint attempt fails this way, any kind of the dialog's fourteen
 *                         (rejected, phase-closed, sold-out, quota-exceeded, not-listed, not-delegate,
 *                         price-changed, insufficient-balance, contract-wallet, wrong-network, check-failed,
 *                         wallet-failed, reverted, unconfirmed); "Try again" then succeeds. not-delegate
 *                         reads best when the mint is from a vault, as its title names one
 *   ?degraded=1           the freshness server could not read the chain recently
 *   ?start=<seconds>      move the next scheduled start this close, to watch a countdown reach zero
 *   ?refusal=reading      the first answer takes 6 s; slow: every poll answers "retry", so once 10 s pass
 *                         with no body the page says it keeps trying; not-a-collection | unavailable: the
 *                         server refuses the collection for the page load
 *   ?art=placeholder      before the reveal: the placeholder's art, no featured tokens, no tiers
 *   ?type=single_asset | one_of_one   every token's number of the supply in place of its tier
 */
export type SampleSwitches = {
  variant: MintPageVariant
  wallet: SampleWalletMode
  degraded: boolean
  /** Moves the next scheduled start this many seconds after the sample's now. */
  start: number | null
  /** The first mint attempt fails this way; "Try again" then succeeds. */
  fail: MintFailureKind | null
  /** How the state answers in place of a body, or how long its first body takes. */
  refusal: 'reading' | 'slow' | 'not-a-collection' | 'unavailable' | null
  /** Before the reveal; the sample is revealed otherwise. */
  art: 'placeholder' | null
  /** Another project type, for the rarity spot's alternative. */
  type: 'single_asset' | 'one_of_one' | null
}

/** Every kind of the dialog; a kind added to `MintFailureKind` stops compiling here until it is listed. */
const FAILURE_KINDS: Record<MintFailureKind, true> = {
  rejected: true,
  'phase-closed': true,
  'sold-out': true,
  'quota-exceeded': true,
  'not-listed': true,
  'not-delegate': true,
  'price-changed': true,
  'insufficient-balance': true,
  'contract-wallet': true,
  'wrong-network': true,
  'check-failed': true,
  'wallet-failed': true,
  reverted: true,
  unconfirmed: true,
}
const FAILURES = Object.keys(FAILURE_KINDS) as MintFailureKind[]
const REFUSALS = ['reading', 'slow', 'not-a-collection', 'unavailable'] as const
const TYPES = ['single_asset', 'one_of_one'] as const
const WALLETS: Exclude<SampleWalletMode, null>[] = ['connected', 'not-listed', 'limit', 'wrong-chain']

/** The switches a query names; anything it does not name keeps its default. */
export function sampleSwitchesOf(query: URLSearchParams): SampleSwitches {
  const start = Number(query.get('start'))
  return {
    variant: MINT_PAGE_VARIANTS.find((variant) => variant === query.get('state')) ?? 'allowlist-live',
    wallet: WALLETS.find((mode) => mode === query.get('wallet')) ?? null,
    degraded: query.get('degraded') === '1',
    start: Number.isFinite(start) && start > 0 ? start : null,
    fail: FAILURES.find((kind) => kind === query.get('fail')) ?? null,
    refusal: REFUSALS.find((refusal) => refusal === query.get('refusal')) ?? null,
    art: query.get('art') === 'placeholder' ? 'placeholder' : null,
    type: TYPES.find((type) => type === query.get('type')) ?? null,
  }
}

/** The base URI before the reveal (the placeholder's one file) and after it (the rendered set). */
export const SAMPLE_PLACEHOLDER_URI = DEMO_DEPLOYMENT.baseUri
export const SAMPLE_REVEALED_URI = DEMO_RENDER_JOBS.done.baseUri

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A simulation's revert as viem throws it, so the page reads it as the live one would. */
function revert(errorName: string, args: readonly unknown[], call: MintCall): ContractFunctionExecutionError {
  const data = encodeErrorResult({ abi: collectionAbi, errorName, args } as Parameters<
    typeof encodeErrorResult
  >[0])
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: collectionAbi, data, functionName: call.functionName }),
    { abi: collectionAbi, functionName: call.functionName, args: call.args, contractAddress: call.address },
  )
}

/** Where a sample failure strikes: the check, the wallet or the receipt, and the error it throws there. */
function sampleFailure(
  kind: MintFailureKind,
  call: MintCall,
  chainName: string,
): { at: 'check' | 'wallet' | 'receipt'; error: Error | null } {
  const [amount, group, vault] = call.args
  /** What a refusal says is left: one fewer than asked, so a single token leaves none to offer again. */
  const fewer = amount > 1n ? amount - 1n : 0n
  switch (kind) {
    case 'phase-closed':
      return { at: 'check', error: revert('MintGroupInactive', [group], call) }
    case 'sold-out':
      return { at: 'check', error: revert('ExceedsMintGroupMaxSupply', [amount, fewer], call) }
    case 'quota-exceeded':
      return { at: 'check', error: revert('ExceedsMintQuota', [amount, fewer], call) }
    case 'not-listed':
      return { at: 'check', error: revert('NotInWhitelist', [call.account, group], call) }
    case 'not-delegate':
      // Reads best from a vault; from the wallet itself the revert names the wallet as its own vault.
      return { at: 'check', error: revert('NotDelegate', [call.account, vault ?? call.account], call) }
    case 'price-changed':
      return { at: 'check', error: revert('InsufficientEther', [call.value + 1n, call.value], call) }
    case 'insufficient-balance':
      return { at: 'check', error: new Error('insufficient funds for gas * price + value') }
    case 'contract-wallet':
      return { at: 'check', error: revert('TransferToNonERC721ReceiverImplementer', [], call) }
    case 'check-failed':
      return { at: 'check', error: new Error('The RPC did not answer.') }
    case 'rejected':
      return { at: 'wallet', error: new UserRejectedRequestError(new Error('User rejected the request.')) }
    case 'wrong-network':
      return {
        at: 'wallet',
        error: new ChainMismatchError({
          chain: { id: call.chainId, name: chainName } as Chain,
          currentChainId: 1,
        }),
      }
    case 'wallet-failed':
      return {
        at: 'wallet',
        error: Object.assign(new Error('The wallet could not sign.'), {
          shortMessage: 'The wallet could not sign the request.',
        }),
      }
    case 'reverted':
    case 'unconfirmed':
      return { at: 'receipt', error: null }
  }
}

/** The sample's wallet answer for any address: the sample minter's allowances, shaped by the wallet switch. */
function quotasOf(
  state: WalletState,
  mode: SampleWalletMode,
  publicMax: number,
): Omit<WalletBody, 'chainId' | 'address' | 'wallet' | 'block'> {
  const notListed = mode === 'not-listed'
  const limit = mode === 'limit'
  const groups: QuotaBody[] = state.groups.map((entry) => {
    const quota = entry.groupId === 0 || notListed ? 0 : entry.quota
    return { id: entry.groupId, quota, claimed: limit ? quota : Math.min(entry.used, quota) }
  })
  return {
    publicMinted: limit ? publicMax : state.publicMinted,
    groups,
    vaults: notListed
      ? []
      : state.delegatedVaults.map((vault) => ({
          vault: vault.vault,
          publicMinted: 0,
          groups: groups.map((entry) => {
            const own = vault.groups.find((candidate) => candidate.groupId === entry.id)
            const quota = own?.quota ?? 0
            return { id: entry.id, quota, claimed: limit ? quota : (own?.used ?? 0) }
          }),
        })),
  }
}

/** A sample token's art: its preview, or its layers stacked; the placeholder's image before the reveal. */
export async function sampleTokenArt(baseUri: string, id: number): Promise<TokenArt | null> {
  if (baseUri === SAMPLE_PLACEHOLDER_URI) return { layers: [DEMO_PLACEHOLDER.imageUrl], video: false }
  const token = DEMO_TOKENS[id - 1]
  if (!token) return null
  return { layers: token.previewUrl ? [token.previewUrl] : tokenLayerUrls(token.dna), video: false }
}

/** The sample source for a page. `now` is the wall clock, so the sample's chain time moves in real seconds. */
export function sampleMintSource(
  page: MintPageStatic,
  switches: SampleSwitches,
  now: () => number = Date.now,
): MintSource {
  const startedAt = now()
  const data = getMintPageData(page.slug, switches.variant)
  let groups: MintGroup[] = data.groups
  if (switches.start !== null) {
    const next = groups
      .filter((group) => !group.active && group.scheduledStart > DEMO_NOW)
      .sort((a, b) => a.scheduledStart - b.scheduledStart)[0]
    if (next)
      groups = groups.map((group) =>
        group.id === next.id
          ? { ...group, scheduledStart: DEMO_NOW + Math.floor(switches.start ?? 0) }
          : group,
      )
  }
  /** The mints the sample's chain confirmed, joining its answers from their block on. */
  const mints: { groupId: number; holder: Address; count: number; block: number }[] = []
  let nextTokenId = data.supply.minted + 1
  let failuresLeft = switches.fail === 'phase-closed' ? 2 : switches.fail ? 1 : 0
  /** The wallet's failure for the attempt that sends: a rejection, a changed network, a failed signing. */
  let failNextSend: Error | null = null
  /** The receipt's own failure for the attempt that sent it: reverted, or never confirmed. */
  let failNextReceipt: 'reverted' | 'unconfirmed' | null = null
  let txSeed = 0
  /** The calls the sample's wallet sent, by hash, for their receipts. */
  const pending = new Map<Hex, MintCall>()

  const elapsed = () => Math.floor((now() - startedAt) / 1_000)
  const blockNow = () => 1_000 + elapsed()
  const landed = (block: number) => mints.filter((mint) => mint.block <= block)
  const mintedBy = (block: number, holder: Address, groupId: number) =>
    landed(block)
      .filter((mint) => mint.groupId === groupId && mint.holder.toLowerCase() === holder.toLowerCase())
      .reduce((sum, mint) => sum + mint.count, 0)

  const chain: MintChain = {
    simulate: async (call) => {
      await wait(900)
      const failure =
        switches.fail && failuresLeft > 0 ? sampleFailure(switches.fail, call, page.chain.name) : null
      if (failure) failuresLeft -= 1
      if (failure?.at === 'check' && failure.error) throw failure.error
      // The wallet's and the receipt's failures stay armed until a send or a receipt reads them, so an
      // attempt that ends between the check and the wallet (a flow closed during the check) does not use
      // one up unseen.
      if (failure?.at === 'wallet') failNextSend = failure.error
      if (failure?.at === 'receipt')
        failNextReceipt = switches.fail === 'unconfirmed' ? 'unconfirmed' : 'reverted'
      return async () => {
        await wait(1_600)
        const failing = failNextSend
        failNextSend = null
        if (failing) throw failing
        txSeed += 1
        const hash = sampleTxHash(9_000 + txSeed)
        pending.set(hash, call)
        return hash
      }
    },
    receipt: async (hash) => {
      await wait(2_200)
      const call = pending.get(hash)
      const block = blockNow() + 1
      const failing = failNextReceipt
      failNextReceipt = null
      if (failing === 'unconfirmed') throw new WaitForTransactionReceiptTimeoutError({ hash })
      if (!call || failing === 'reverted')
        return { status: 'reverted', blockNumber: BigInt(block), logs: [] } as unknown as TransactionReceipt
      const [amount, group, vault] = call.args
      const count = Number(amount)
      mints.push({ groupId: Number(group), holder: vault ?? call.account, count, block })
      const logs = Array.from({ length: count }, (_, index) => ({
        address: call.address,
        data: '0x' as Hex,
        topics: encodeEventTopics({
          abi: collectionAbi,
          eventName: 'Transfer',
          args: { from: zeroAddress, to: call.account, tokenId: BigInt(nextTokenId + index) },
        }),
      }))
      nextTokenId += count
      return { status: 'success', blockNumber: BigInt(block), logs } as unknown as TransactionReceipt
    },
  }
  return {
    async pollState() {
      await wait(150)
      if (switches.refusal === 'not-a-collection' || switches.refusal === 'unavailable')
        return { kind: 'final', reason: switches.refusal }
      if (switches.refusal === 'slow') return { kind: 'retry', afterMs: 1_000, reason: 'not-read-yet' }
      // The first answer takes 6 s, so "Reading the chain" can be reviewed.
      if (switches.refusal === 'reading') await wait(Math.max(0, startedAt + 6_000 - now()))
      const seconds = elapsed()
      const block = 1_000 + seconds
      const blockTimestamp = DEMO_NOW + seconds
      const wall = Math.floor(now() / 1_000)
      const minted = landed(block).reduce((sum, mint) => sum + mint.count, 0)
      const body: StateBody = {
        chainId: page.chain.id,
        address: page.contract,
        block,
        blockTimestamp,
        readAt: switches.degraded ? wall - 4 * 60 : wall,
        degraded: switches.degraded,
        maxSupply: data.supply.max,
        totalMinted: Math.min(data.supply.max, data.supply.minted + minted),
        publicMaxMintPerWallet: data.publicMaxMintPerWallet,
        mintFeeFlatWei: data.fees.mintFeeFlatWei,
        mintFeeBps: data.fees.mintFeeBps,
        airdropFeePerTokenWei: data.fees.airdropFeePerTokenWei,
        mintOnBehalfActive: false,
        groups: groups.map((group) => ({
          id: group.id,
          priceWei: group.priceWei,
          maxSupply: group.maxSupply,
          minted:
            group.minted +
            landed(block)
              .filter((mint) => mint.groupId === group.id)
              .reduce((sum, mint) => sum + mint.count, 0),
          startTimestamp: group.scheduledStart,
          flag: group.flag,
          active: group.active || (group.scheduledStart > 0 && blockTimestamp >= group.scheduledStart + 2),
        })),
        owner: DEMO_CREATOR,
        royalty: { receiver: DEMO_DEPLOYMENT.royaltyReceiver, bps: DEMO_DEPLOYMENT.royaltyBps },
        baseUri: switches.art === 'placeholder' ? SAMPLE_PLACEHOLDER_URI : SAMPLE_REVEALED_URI,
        transferValidator: DEFAULT_TRANSFER_VALIDATOR,
        transferLevel: 0,
      }
      return { kind: 'body', body, ageSeconds: 0 }
    },

    async pollWallet(wallet) {
      await wait(300)
      const block = blockNow()
      const quotas = quotasOf(data.wallet!, switches.wallet, data.publicMaxMintPerWallet)
      return {
        kind: 'body',
        body: {
          chainId: page.chain.id,
          address: page.contract,
          wallet,
          block,
          publicMinted: quotas.publicMinted + mintedBy(block, wallet, 0),
          groups: quotas.groups.map((entry) => ({
            ...entry,
            claimed: entry.claimed + mintedBy(block, wallet, entry.id),
          })),
          vaults: quotas.vaults.map((vault) => ({
            ...vault,
            groups: vault.groups.map((entry) => ({
              ...entry,
              claimed: entry.claimed + mintedBy(block, vault.vault, entry.id),
            })),
          })),
        },
      }
    },

    chain,

    async tiers(baseUri, ids) {
      if (baseUri !== SAMPLE_REVEALED_URI) return null
      const ranks: Record<number, number> = {}
      for (const id of ids.slice(0, 20)) {
        const token = DEMO_TOKENS[id - 1]
        if (token) ranks[id] = token.rank
      }
      return { total: DEMO_TOKENS.length, ranks }
    },

    tokenArt: sampleTokenArt,
  }
}
