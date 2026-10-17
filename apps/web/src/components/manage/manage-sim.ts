/**
 * Sample mode for Manage drop (docs/specs/2026-10-15-phases.md, section 8), and the sample values the mint page
 * parts still read. Nothing here talks to a wallet, an RPC or the database: `sampleManageActions` and
 * `samplePhasesServer` have the shape of `realManageActions` (manage-actions.ts) and `phasesServer`
 * (phases-server.ts), so every tab runs the same code in both modes. Every simulated change goes through the
 * manage machine and the same dialog.
 */
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { ContractFunctionRevertedError, encodeErrorResult } from 'viem'
import { SAMPLE_REVEALED_URI } from '@/components/mint/sample-source'
import type { Tables } from '@/lib/database.types'
import {
  DEMO_ACTIVITY,
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
  DEMO_MINT_PAGE_SECTIONS,
  DEMO_MINT_PAGE_SETTINGS,
  DEMO_NOW,
  DEMO_PUBLIC_MAX_PER_WALLET,
  sampleSupply,
  sampleTxHash,
  scaleSampleToSupply,
} from '@/lib/demo'
import type { Hex, MintGroup } from '@/lib/demo'
import type { ActionResult } from '@/lib/art/result'
import type { ActivityView } from '@/lib/manage/activity-view'
import { phaseCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { PhaseAdd, PhasesView } from '@/lib/manage/phases-types'
import type { SettingsView } from '@/lib/manage/settings-types'
import type { MintPageSettingsView } from '@/lib/mint/settings-core'
import type { ManageActions } from './manage-actions'
import type { PendingAdd } from './manage-machine'
import type { PhasesServer } from './phases-server'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A fresh transaction hash for a simulated send. */
export function simulatedTxHash(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/**
 * What the sample chain reports for a group after a change lands: the contract's `mintGroupActive` (flag
 * on, or a schedule reached with `block.timestamp >= start`) on the sample's clock. Sample mode only: real
 * screens take `active` from the server's read of `collectionState()`.
 */
export function chainReadGroup(group: Omit<MintGroup, 'active'>, blockTimestamp: number): MintGroup {
  const scheduledReached = group.scheduledStart !== 0 && blockTimestamp >= group.scheduledStart
  return { ...group, active: group.flag || scheduledReached }
}

/** Sample values that sample mode reads in place of a real source. Each names the source it stands in for. */
export const SAMPLE = {
  /** The sample's mint page row (`getMintPageSettings`): the Overview's avatar and public switch, Deploy's link row. */
  mintPage: DEMO_MINT_PAGE_SETTINGS,
} as const

/** Saves off-chain settings in sample mode, where nothing is written: the mint page's draft and its switch. */
export async function saveOffChain(): Promise<void> {
  await wait(900)
}

/**
 * The Mint page tab's view in sample mode: the sample's settings and sections, its files as their URLs (which stand
 * in for keys, since sample mode uploads nothing), and the sample's rendered set to feature from.
 */
export function sampleMintPageView(
  collection: Pick<Tables<'collections'>, 'project_type' | 'max_supply'>,
): MintPageSettingsView {
  const settings = DEMO_MINT_PAGE_SETTINGS
  const { team, roadmap, faq, music, carousel } = DEMO_MINT_PAGE_SECTIONS
  const ref = (url: string) => (url ? { key: url, url } : null)
  return {
    published: settings.published,
    description: settings.description,
    media: { banner: ref(settings.bannerUrl), avatar: ref(settings.avatarUrl), about: null },
    socials: settings.socials,
    featuredTokenIds: settings.featuredTokenIds,
    sections: {
      team: {
        enabled: team.enabled,
        members: team.members.map(({ imageUrl, ...member }) => ({
          ...member,
          imageKey: imageUrl || null,
          imageUrl: imageUrl || null,
        })),
      },
      roadmap,
      faq,
      music: { enabled: music.enabled, key: music.url, fileName: music.fileName, url: music.url },
      carousel: {
        enabled: carousel.enabled,
        items: carousel.items.map((item) =>
          item.kind === 'token'
            ? item
            : {
                id: item.id,
                kind: 'upload',
                key: item.url,
                url: item.url,
                fileName: item.fileName,
                mediaType: item.mediaType,
              },
        ),
      },
    },
    art: {
      realBaseUri: SAMPLE_REVEALED_URI,
      supply: sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply),
      projectType: collection.project_type,
    },
    // Sample mode writes no row, so nothing stamps one.
    updatedAt: null,
  }
}

/**
 * The Overview's activity in sample mode (docs/specs/2026-10-16-indexer-overview.md, section 8): the sample's 171
 * holders and its 12 mints, counted 30 s before the sample's now; `?activity=counting` not counted yet, and
 * `?activity=behind` counted 20 minutes before the sample's now.
 */
export function sampleActivityView(variant: string | undefined): ActivityView {
  const counted: ActivityView = {
    counted: true,
    holders: DEMO_ACTIVITY.holders,
    countedAt: DEMO_NOW - 30,
    recentMints: DEMO_ACTIVITY.recentMints,
  }
  if (variant === 'counting') return { ...counted, counted: false, countedAt: null }
  if (variant === 'behind') return { ...counted, countedAt: DEMO_NOW - 20 * 60 }
  return counted
}

/**
 * Today's sample phases scaled to the collection's supply, as a `PhasesView`. With `chainReachable` false,
 * the copy: what Cobweb last read, without status or minted counts (`?chain=unreachable`).
 */
export function samplePhasesView(
  collection: { max_supply: number | null },
  chainReachable = true,
): PhasesView {
  const maxSupply = sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)
  const sample = scaleSampleToSupply(maxSupply)
  const view: PhasesView = {
    chainId: DEMO_DEPLOYMENT.chainId,
    contract: DEMO_DEPLOYMENT.contractAddress,
    groups: sample.groups,
    publicMaxPerWallet: DEMO_PUBLIC_MAX_PER_WALLET,
    totalMinted: sample.totalMinted,
    maxSupply,
    blockTimestamp: DEMO_NOW,
    readAt: DEMO_NOW,
    chainReachable: true,
  }
  if (chainReachable) return view
  return {
    ...view,
    groups: view.groups.map((group) => ({ ...group, minted: 0, flag: false, active: false })),
    totalMinted: 0,
    chainReachable: false,
  }
}

/** A revert as viem decodes it, so `classifyError` words it as it would the contract's. */
function revert(functionName: string, data: Hex): ContractFunctionRevertedError {
  return new ContractFunctionRevertedError({ abi: collectionAbi, data, functionName })
}

/**
 * How the contract would refuse a call on the sample view, or null when it would pass: the mirror of the
 * collection's group checks (an unknown group, an id taken, below minted, the allocations over the supply), of
 * `setMintQuota`'s (unequal lengths, the public sale, an unknown group), of `airdropNFTs`' (unequal lengths, more
 * tokens than are left) and of `withdrawMintFunds`' (nothing to withdraw, on the Settings view when given).
 */
export function sampleRevert(
  call: ManageCall,
  view: PhasesView,
  settings?: SettingsView,
): ContractFunctionRevertedError | null {
  const find = (id: bigint) => view.groups.find((group) => BigInt(group.id) === id)
  const missing = (id: bigint) =>
    revert(
      call.functionName,
      encodeErrorResult({ abi: collectionAbi, errorName: 'MintGroupDoesNotExist', args: [id] }),
    )
  const others = (id: bigint) =>
    view.groups
      .filter((group) => BigInt(group.id) !== id)
      .reduce((sum, group) => sum + BigInt(group.maxSupply), 0n)
  const over = () =>
    revert(
      call.functionName,
      encodeErrorResult({ abi: collectionAbi, errorName: 'AllocationsExceedMaxSupply' }),
    )
  switch (call.functionName) {
    case 'registerMintGroup': {
      const [id, , maxSupply] = call.args
      if (find(id))
        return revert(
          call.functionName,
          encodeErrorResult({ abi: collectionAbi, errorName: 'MintGroupAlreadyExists', args: [id] }),
        )
      return others(id) + maxSupply > BigInt(view.maxSupply) ? over() : null
    }
    case 'setMintGroupMaxSupply': {
      const [id, maxSupply] = call.args
      const group = find(id)
      if (!group) return missing(id)
      if (maxSupply < BigInt(group.minted))
        return revert(
          call.functionName,
          encodeErrorResult({ abi: collectionAbi, errorName: 'BelowMinted', args: [BigInt(group.minted)] }),
        )
      return others(id) + maxSupply > BigInt(view.maxSupply) ? over() : null
    }
    case 'setMintGroupStatus':
    case 'scheduleMintGroupStart':
      return find(call.args[0]) ? null : missing(call.args[0])
    case 'changeSalePrice':
      return find(call.args[1]) ? null : missing(call.args[1])
    case 'setMintQuota': {
      const [addresses, id, quotas] = call.args
      if (addresses.length !== quotas.length)
        return revert(
          call.functionName,
          encodeErrorResult({ abi: collectionAbi, errorName: 'ArrayLengthMismatch' }),
        )
      if (id === 0n)
        return revert(
          call.functionName,
          encodeErrorResult({ abi: collectionAbi, errorName: 'PublicGroupHasNoQuota' }),
        )
      return find(id) ? null : missing(id)
    }
    case 'airdropNFTs': {
      const [recipients, amounts] = call.args
      if (recipients.length !== amounts.length)
        return revert(
          call.functionName,
          encodeErrorResult({ abi: collectionAbi, errorName: 'ArrayLengthMismatch' }),
        )
      const total = amounts.reduce((sum, amount) => sum + amount, 0n)
      const available = BigInt(Math.max(0, view.maxSupply - view.totalMinted))
      return total > available
        ? revert(
            call.functionName,
            encodeErrorResult({
              abi: collectionAbi,
              errorName: 'ExceedsMaxSupply',
              args: [total, available],
            }),
          )
        : null
    }
    case 'withdrawMintFunds':
      return settings?.creatorBalanceWei === '0'
        ? revert(call.functionName, encodeErrorResult({ abi: collectionAbi, errorName: 'NothingToWithdraw' }))
        : null
    default:
      return null
  }
}

/** The sample view after a change lands, `active` recomputed on the sample's clock. */
export function sampleApply(call: ManageCall, view: PhasesView, add?: PhaseAdd): PhasesView {
  const patch = (id: bigint, change: Partial<MintGroup>) => (group: MintGroup) =>
    BigInt(group.id) === id ? { ...group, ...change } : group
  let groups = view.groups
  let publicMaxPerWallet = view.publicMaxPerWallet
  switch (call.functionName) {
    case 'registerMintGroup': {
      const [id, price, maxSupply, start] = call.args
      groups = [
        ...groups,
        {
          id: Number(id),
          name: add?.name ?? `Group ${id}`,
          kind: 'whitelist',
          priceWei: price.toString(),
          maxSupply: Number(maxSupply),
          minted: 0,
          flag: false,
          scheduledStart: Number(start),
          active: false,
          description: add?.description ?? '',
          visible: add?.visible ?? true,
          named: add !== undefined,
        },
      ]
      break
    }
    case 'setMintGroupStatus': {
      const [id, status] = call.args
      groups = groups.map(patch(id, status ? { flag: true } : { flag: false, scheduledStart: 0 }))
      break
    }
    case 'stopOrStartAllMintGroups': {
      const [status] = call.args
      groups = groups.map((group) =>
        status ? { ...group, flag: true } : { ...group, flag: false, scheduledStart: 0 },
      )
      break
    }
    case 'scheduleMintGroupStart': {
      const [id, start] = call.args
      groups = groups.map(patch(id, { scheduledStart: Number(start) }))
      break
    }
    case 'changeSalePrice': {
      const [price, id] = call.args
      groups = groups.map(patch(id, { priceWei: price.toString() }))
      break
    }
    case 'setMintGroupMaxSupply': {
      const [id, maxSupply] = call.args
      groups = groups.map(patch(id, { maxSupply: Number(maxSupply) }))
      break
    }
    case 'setPublicMaxMintPerWallet':
      publicMaxPerWallet = Number(call.args[0])
      break
    case 'setMintQuota':
    case 'airdropNFTs':
    case 'withdrawMintFunds':
    case 'setOwnerPayoutAddress':
    case 'setDefaultRoyalty':
    case 'setBaseURI':
    case 'setMintOnBehalfStatus':
    case 'setTransferValidator':
    case 'setTransferSecurityLevelOfCollection':
      // A phases view holds none of these: the Whitelist's, Airdrop's and Settings' sample servers apply them
      // (whitelist-sim.ts, airdrop-sim.ts, settings-sim.ts).
      break
  }
  return {
    ...view,
    publicMaxPerWallet,
    groups: groups.map((group) => chainReadGroup(group, view.blockTimestamp)),
  }
}

type Choice = 'approve' | 'reject' | 'approve-revert'

function userRejected(): Error {
  return Object.assign(new Error('User rejected the request.'), {
    name: 'UserRejectedRequestError',
    code: 4001,
  })
}

/**
 * The sample actions. `simulate` waits 650 ms and refuses as the contract would on the current view (and, for a
 * withdrawal, the current Settings view when `settings` is given); the send waits for the simulated wallet's
 * `answer`; `wait` takes 1.6 seconds. `sent` remembers each sent call by its hash, so the sample server applies
 * exactly what was signed.
 */
export function sampleManageActions(
  current: () => PhasesView,
  sent: Map<Hex, ManageCall> = new Map(),
  settings?: () => SettingsView,
): ManageActions {
  let settle: ((choice: Choice) => void) | null = null
  const reverting = new Set<Hex>()
  /** The simulated wallet: a hash on Approve, a rejection on Reject. */
  const walletFor = (call: ManageCall) => () =>
    new Promise<Hex>((resolve, reject) => {
      settle = (choice) => {
        settle = null
        if (choice === 'reject') return reject(userRejected())
        const hash = simulatedTxHash()
        if (choice === 'approve-revert') reverting.add(hash)
        sent.set(hash, call)
        resolve(hash)
      }
    })
  return {
    switchChain: async () => {},
    simulate: async (call) => {
      await wait(650)
      const refused = sampleRevert(call, current(), settings?.())
      if (refused) throw refused
      return walletFor(call)
    },
    wait: async (hash) => {
      await wait(1600)
      return reverting.has(hash) ? 'reverted' : 'success'
    },
    nextGroupId: async () => Math.max(0, ...current().groups.map((group) => group.id)) + 1,
    answer: (choice) => settle?.(choice),
  }
}

/**
 * The sample server: every answer takes 900 ms. A confirm applies the call; a record applies the call the
 * simulated wallet sent with that hash (a plain registration for `?pending=add`) and names the phase.
 */
export function samplePhasesServer(
  current: () => PhasesView,
  sent: Map<Hex, ManageCall> = new Map(),
): PhasesServer {
  const answer = async <T>(data: () => T): Promise<ActionResult<T>> => {
    await wait(900)
    return { ok: true, data: data() }
  }
  return {
    read: () => answer(current),
    confirm: (_hash, call) => answer(() => sampleApply(call, current())),
    record: (hash, add) =>
      answer(() =>
        sampleApply(sent.get(hash) ?? phaseCalls.register(add.onchainId, '0', 0, 0), current(), add),
      ),
    rename: () => answer(() => undefined),
    setVisibility: () => answer(() => undefined),
    move: () => answer(() => undefined),
  }
}

/** The add `?pending=add` shows waiting to be recorded. */
export function samplePendingAdd(view: PhasesView): PendingAdd {
  return {
    hash: sampleTxHash(31),
    form: {
      onchainId: Math.max(0, ...view.groups.map((group) => group.id)) + 1,
      name: 'Holders',
      description: 'Holders of the first collection.',
      visible: true,
    },
  }
}
