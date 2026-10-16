import { DEFAULT_TRANSFER_VALIDATOR, type QuotaBody, type StateBody, type WalletBody } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  encodeEventTopics,
  UserRejectedRequestError,
  zeroAddress,
  type Address,
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
 *   ?fail=rejected | phase-closed | quota-exceeded | insufficient-balance | reverted
 *                         the first mint attempt fails this way; "Try again" then succeeds
 *   ?degraded=1           the freshness server could not read the chain recently
 *   ?start=<seconds>      move the next scheduled start this close, to watch a countdown reach zero
 */
export type SampleSwitches = {
  variant: MintPageVariant
  wallet: SampleWalletMode
  degraded: boolean
  /** Moves the next scheduled start this many seconds after the sample's now. */
  start: number | null
  /** The first mint attempt fails this way; "Try again" then succeeds. */
  fail: MintFailureKind | null
}

const FAILURES: MintFailureKind[] = [
  'rejected',
  'phase-closed',
  'quota-exceeded',
  'insufficient-balance',
  'reverted',
]
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
): { at: 'check' | 'wallet' | 'receipt'; error: Error | null } {
  const [amount, group] = call.args
  switch (kind) {
    case 'phase-closed':
      return { at: 'check', error: revert('MintGroupInactive', [group], call) }
    case 'quota-exceeded':
      return { at: 'check', error: revert('ExceedsMintQuota', [amount, 1n], call) }
    case 'insufficient-balance':
      return { at: 'check', error: new Error('insufficient funds for gas * price + value') }
    case 'rejected':
      return { at: 'wallet', error: new UserRejectedRequestError(new Error('User rejected the request.')) }
    default:
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
  let failNextReceipt = false
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
      const failure = switches.fail && failuresLeft > 0 ? sampleFailure(switches.fail, call) : null
      if (failure) failuresLeft -= 1
      if (failure?.at === 'check' && failure.error) throw failure.error
      if (failure?.at === 'receipt') failNextReceipt = true
      return async () => {
        await wait(1_600)
        if (failure?.at === 'wallet' && failure.error) throw failure.error
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
      if (!call || failNextReceipt) {
        failNextReceipt = false
        return { status: 'reverted', blockNumber: BigInt(block), logs: [] } as unknown as TransactionReceipt
      }
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
        baseUri: data.collection.revealed ? SAMPLE_REVEALED_URI : SAMPLE_PLACEHOLDER_URI,
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

    async tokenArt(baseUri, id) {
      if (baseUri === SAMPLE_PLACEHOLDER_URI) return { layers: [DEMO_PLACEHOLDER.imageUrl], video: false }
      const token = DEMO_TOKENS[id - 1]
      if (!token) return null
      return { layers: token.previewUrl ? [token.previewUrl] : tokenLayerUrls(token.dna), video: false }
    },
  }
}
