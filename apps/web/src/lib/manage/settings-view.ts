import { pointerOf } from '@cobweb/shared'
import { getAddress, type Address } from 'viem'
import type { RevealTargets, SettingsCopyRow, SettingsState, SettingsView } from './settings-types'

/**
 * The Settings view, pure (docs/specs/2026-10-15-airdrop-settings.md, section 6.1), for the browser and the
 * server: the IPFS links Reveal takes, token 1's URI by the contract's rule, and the view from a read or the
 * copies. The transfer levels, `levelOf` and `pointerOf` live in the shared package
 * (docs/specs/2026-10-16-freshness-server.md, section 5.1).
 */

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
