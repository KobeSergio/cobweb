import { getAddress, zeroAddress, type Address } from 'viem'
import type {
  RevealPointer,
  RevealTargets,
  SettingsCopyRow,
  SettingsState,
  SettingsView,
  TransferLevelState,
} from './settings-types'

/**
 * The Settings view, pure (docs/specs/2026-10-15-airdrop-settings.md, section 6.1), for the browser and the
 * server: the transfer levels Cobweb offers, the IPFS links Reveal takes, token 1's URI by the contract's rule,
 * what the base URI points at, the level from the validator, and the view from a read or the copies.
 */

/** The validator's levels Cobweb sends: royalties enforced, royalties not enforced, and locked. */
export const TRANSFER_LEVELS = { enforced: 0, open: 1, locked: 9 } as const
export type TransferLevelValue = (typeof TRANSFER_LEVELS)[keyof typeof TRANSFER_LEVELS]

/** The longest base URI Cobweb sends. */
export const BASE_URI_MAX = 512

const IPFS_URI = /^ipfs:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(\/\S*)?$/

/** A full `ipfs://` link with a CID, a path after it allowed: a folder ending in "/" or a single file. */
export function ipfsUriValid(value: string): boolean {
  return value.length <= BASE_URI_MAX && IPFS_URI.test(value)
}

/** Token 1's URI by the contract's rule: an empty base stays empty, a base without "/" is every token's URI. */
export function tokenUriOf(base: string): string {
  if (!base || !base.endsWith('/')) return base
  return `${base}1`
}

/**
 * What the base URI points at, compared exactly: the real job's (checked first, so a collection deployed on its
 * real job reads revealed), the placeholder job's or the deploy-time one, else a custom link.
 */
export function pointerOf(baseUri: string, targets: RevealTargets): RevealPointer {
  if (targets.real !== null && baseUri === targets.real) return 'revealed'
  if (baseUri === targets.placeholder || baseUri === targets.start) return 'placeholder'
  return 'custom'
}

/** The level a read gives: none for the zero address or a validator without code, unread when it did not answer. */
export function levelOf(
  validator: Address,
  hasCode: boolean,
  policyLevel: number | null,
): TransferLevelState {
  if (validator.toLowerCase() === zeroAddress) return { kind: 'none', reason: 'zero' }
  if (!hasCode) return { kind: 'none', reason: 'no-code' }
  return policyLevel === null ? { kind: 'unread' } : { kind: 'level', level: policyLevel }
}

/**
 * The view from a read: the chain's values, the copied ones included, at the read's block time. Without one (the
 * chain did not answer), the copies, with the balances, fees, owner and level unknown and the copy's time.
 */
export function settingsViewOf(
  base: { chainId: number; contract: Address; readAt: number },
  copies: SettingsCopyRow,
  targets: RevealTargets,
  withdrawnWei: string,
  state: SettingsState | null,
): SettingsView {
  const shared = { chainId: base.chainId, contract: base.contract, withdrawnWei, targets }
  if (!state)
    return {
      ...shared,
      owner: null,
      creatorBalanceWei: null,
      platformBalanceWei: null,
      pendingBalanceWei: null,
      fees: null,
      payout: getAddress(copies.payout_address),
      royaltyBps: copies.royalty_bps,
      royaltyReceiver: getAddress(copies.royalty_receiver),
      baseUri: copies.base_uri,
      transferValidator: copies.transfer_validator === null ? null : getAddress(copies.transfer_validator),
      mintOnBehalf: copies.mint_on_behalf,
      level: null,
      pointer: pointerOf(copies.base_uri, targets),
      realArtRendered: targets.real !== null,
      blockTimestamp: base.readAt,
      readAt: base.readAt,
      chainReachable: false,
    }
  return {
    ...shared,
    owner: state.owner,
    creatorBalanceWei: state.creatorBalanceWei,
    platformBalanceWei: state.platformBalanceWei,
    pendingBalanceWei: state.pendingBalanceWei,
    fees: state.fees,
    payout: state.payout,
    royaltyBps: state.royaltyBps,
    royaltyReceiver: state.royaltyReceiver,
    baseUri: state.baseUri,
    transferValidator: state.validator,
    mintOnBehalf: state.chain.mintOnBehalfActive,
    level: state.level,
    pointer: pointerOf(state.baseUri, targets),
    realArtRendered: targets.real !== null,
    blockTimestamp: state.blockTimestamp,
    readAt: state.blockTimestamp,
    chainReachable: true,
  }
}

/** What `settings_refresh` copies from a read, addresses lowercase. */
export function settingsPayload(state: SettingsState): {
  payout_address: string
  royalty_bps: number
  royalty_receiver: string
  base_uri: string
  transfer_validator: string
  mint_on_behalf: boolean
} {
  return {
    payout_address: state.payout.toLowerCase(),
    royalty_bps: state.royaltyBps,
    royalty_receiver: state.royaltyReceiver.toLowerCase(),
    base_uri: state.baseUri,
    transfer_validator: state.validator.toLowerCase(),
    mint_on_behalf: state.chain.mintOnBehalfActive,
  }
}
