/**
 * Sample mode for Settings and the Overview's pointer and proceeds (docs/specs/2026-10-15-airdrop-settings.md,
 * section 8). Nothing here talks to a wallet, an RPC or the database: `sampleSettingsServer` has the shape of
 * `settingsServer` (settings-server.ts), and its confirm applies the call as the chain would and a read would show
 * it, so the screens run the same code in both modes.
 */
import { DEFAULT_TRANSFER_VALIDATOR, pointerOf, TRANSFER_LEVELS } from '@cobweb/shared'
import { getAddress, zeroAddress, type Address } from 'viem'
import type { ActionResult } from '@/lib/art/result'
import type { PreparedArgs } from '@/lib/deploy/deploy-types'
import {
  DEMO_ACTIVITY,
  DEMO_COLLECTION,
  DEMO_CREATOR,
  DEMO_DEPLOYMENT,
  DEMO_NOW,
  DEMO_PLACEHOLDER,
  DEMO_PUBLIC_MAX_PER_WALLET,
  DEMO_RENDER_JOBS,
} from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { RevealTargets, SettingsCopyRow, SettingsView } from '@/lib/manage/settings-types'
import { settingsViewOf } from '@/lib/manage/settings-view'
import { samplePhasesView } from './manage-sim'
import type { SettingsServer } from './settings-server'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The sample's rendered metadata: a folder with a file per token. */
const SAMPLE_REAL_URI = `ipfs://${DEMO_RENDER_JOBS.done.metadataCid}/`
/** The sample's placeholder metadata: one file every token shows, and the base URI the sample deployed on. */
const SAMPLE_PLACEHOLDER_URI = `ipfs://${DEMO_PLACEHOLDER.cid}/metadata.json`

/** The constructor as the sample prepared it, which the copies carry. */
const SAMPLE_ARGS: PreparedArgs = {
  name: DEMO_COLLECTION.name,
  symbol: DEMO_COLLECTION.symbol,
  payout: DEMO_DEPLOYMENT.payoutAddress,
  baseUri: SAMPLE_PLACEHOLDER_URI,
  maxSupply: String(DEMO_COLLECTION.maxSupply),
  groupSupplies: [],
  groupPrices: [],
  publicMaxPerWallet: String(DEMO_PUBLIC_MAX_PER_WALLET),
  royaltyBps: DEMO_DEPLOYMENT.royaltyBps,
  owner: DEMO_CREATOR,
  royaltyReceiver: DEMO_DEPLOYMENT.royaltyReceiver,
}

/**
 * The Base sample's settings: the balances of `DEMO_ACTIVITY`'s proceeds and no refund held, the fees, payout and
 * royalty of `DEMO_DEPLOYMENT`, the placeholder as the base URI (the rendered metadata with `art` "revealed"), no
 * real job with `art` "deferred", mint on behalf off, Limit Break's default validator at the enforced level, and
 * the session wallet as the owner unless `owner` names another (`?owner=other`). With `chainReachable` false, the
 * copies, as the core builds them (`?chain=unreachable`).
 */
export function sampleSettingsView(
  collection: { max_supply: number | null },
  wallet: Address,
  options: { chainReachable?: boolean; owner?: Address; art?: string } = {},
): SettingsView {
  const phases = samplePhasesView(collection)
  const targets: RevealTargets = {
    real: options.art === 'deferred' ? null : SAMPLE_REAL_URI,
    placeholder: SAMPLE_PLACEHOLDER_URI,
    start: SAMPLE_PLACEHOLDER_URI,
  }
  const baseUri = options.art === 'revealed' ? SAMPLE_REAL_URI : SAMPLE_PLACEHOLDER_URI
  const base = { chainId: phases.chainId, contract: phases.contract, readAt: DEMO_NOW }
  const copies: SettingsCopyRow = {
    payout_address: DEMO_DEPLOYMENT.payoutAddress,
    royalty_bps: DEMO_DEPLOYMENT.royaltyBps,
    royalty_receiver: DEMO_DEPLOYMENT.royaltyReceiver,
    base_uri: baseUri,
    transfer_validator: DEFAULT_TRANSFER_VALIDATOR.toLowerCase(),
    mint_on_behalf: false,
    args: SAMPLE_ARGS,
  }
  const withdrawn = DEMO_ACTIVITY.proceeds.withdrawnWei
  if (options.chainReachable === false) return settingsViewOf(base, copies, targets, withdrawn, null)
  const block = 21_500_000n
  return settingsViewOf(base, copies, targets, withdrawn, {
    block,
    blockTimestamp: DEMO_NOW,
    chain: {
      block,
      blockTimestamp: DEMO_NOW,
      maxSupply: phases.maxSupply,
      totalMinted: phases.totalMinted,
      publicMaxMintPerWallet: phases.publicMaxPerWallet,
      mintOnBehalfActive: false,
      groups: [],
    },
    creatorBalanceWei: DEMO_ACTIVITY.proceeds.withdrawableWei,
    platformBalanceWei: DEMO_ACTIVITY.proceeds.platformFeesWei,
    pendingBalanceWei: '0',
    payout: getAddress(DEMO_DEPLOYMENT.payoutAddress),
    royaltyBps: DEMO_DEPLOYMENT.royaltyBps,
    royaltyReceiver: getAddress(DEMO_DEPLOYMENT.royaltyReceiver),
    baseUri,
    validator: DEFAULT_TRANSFER_VALIDATOR,
    owner: options.owner ?? wallet,
    fees: DEMO_DEPLOYMENT.fees,
    level: { kind: 'level', level: TRANSFER_LEVELS.enforced },
  })
}

/**
 * The view after a Settings change lands, as the chain would hold it and a read would show it: a withdrawal moves
 * the balance into the withdrawn sum; the payout, the royalty, the base URI (and its pointer), mint on behalf and
 * the validator take the call's values (no validator reads as none, any other at the enforced level); the level
 * call sets the level.
 */
export function sampleApplySettings(call: ManageCall, view: SettingsView): SettingsView {
  switch (call.functionName) {
    case 'withdrawMintFunds':
      return {
        ...view,
        withdrawnWei: (BigInt(view.withdrawnWei) + BigInt(view.creatorBalanceWei ?? '0')).toString(),
        creatorBalanceWei: '0',
      }
    case 'setOwnerPayoutAddress':
      return { ...view, payout: getAddress(call.args[0]) }
    case 'setDefaultRoyalty':
      return { ...view, royaltyReceiver: getAddress(call.args[0]), royaltyBps: Number(call.args[1]) }
    case 'setBaseURI':
      return { ...view, baseUri: call.args[0], pointer: pointerOf(call.args[0], view.targets) }
    case 'setMintOnBehalfStatus':
      return { ...view, mintOnBehalf: call.args[0] }
    case 'setTransferValidator': {
      const validator = getAddress(call.args[0])
      return {
        ...view,
        transferValidator: validator,
        level:
          validator === zeroAddress
            ? { kind: 'none', reason: 'zero' }
            : { kind: 'level', level: TRANSFER_LEVELS.enforced },
      }
    }
    case 'setTransferSecurityLevelOfCollection':
      return { ...view, level: { kind: 'level', level: call.args[1] } }
    default:
      return view
  }
}

/** The sample server: every answer takes 900 ms, and a confirm applies the call to the current view. */
export function sampleSettingsServer(current: () => SettingsView): SettingsServer {
  const answer = async <T>(data: () => T): Promise<ActionResult<T>> => {
    await wait(900)
    return { ok: true, data: data() }
  }
  return {
    read: () => answer(current),
    confirm: (_hash, call) => answer(() => sampleApplySettings(call, current())),
  }
}
