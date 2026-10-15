import type { ContractFunctionReturnType } from 'viem'
import type { collectionAbi } from './collection-abi.ts'

/**
 * `collectionState()` as Cobweb reads it (docs/specs/2026-10-16-freshness-server.md, section 5.1): the shapes
 * and the mapping the web app's Phases, Airdrop and Settings readers and the freshness server share. Pure.
 * The ABI is imported as a type only, so the browser entry carries no ABI at run time.
 */

/** One group of `collectionState()`, as the screens read it. */
export type ChainGroup = {
  id: number
  priceWei: string
  maxSupply: number
  minted: number
  startTimestamp: number
  /** The raw open flag. */
  flag: boolean
  /** The contract's `mintGroupActive`: the only source of "live". */
  active: boolean
}

/** `collectionState()` as the screens read it: counts as numbers, prices as decimal strings. */
export type ChainState = {
  /** The block the state was read at. */
  block: bigint
  /** The chain's time at that block (Unix seconds). */
  blockTimestamp: number
  maxSupply: number
  totalMinted: number
  publicMaxMintPerWallet: number
  mintOnBehalfActive: boolean
  groups: ChainGroup[]
}

/** What viem answers for `collectionState()`. */
export type CollectionStateResult = ContractFunctionReturnType<
  typeof collectionAbi,
  'view',
  'collectionState'
>

/**
 * `collectionState()` as the screens read it, at the block it was read at: the mapping the Phases, Airdrop
 * and Settings readers share (docs/specs/2026-10-15-airdrop-settings.md, section 6.2).
 */
export function chainStateOf(state: CollectionStateResult, block: bigint): ChainState {
  return {
    block,
    blockTimestamp: Number(state.blockTimestamp),
    maxSupply: Number(state.maxSupply),
    totalMinted: Number(state.totalMinted),
    publicMaxMintPerWallet: Number(state.publicMaxMintPerWallet),
    mintOnBehalfActive: state.mintOnBehalfActive,
    groups: state.groups.map((group) => ({
      id: Number(group.id),
      priceWei: group.price.toString(),
      maxSupply: Number(group.maxSupply),
      minted: Number(group.minted),
      startTimestamp: Number(group.startTimestamp),
      flag: group.activeFlag,
      active: group.active,
    })),
  }
}
