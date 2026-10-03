import type { Address, MintPageData, WalletState } from '@/lib/demo'

/** A token to show after a mint: its id and the layer images that stack into it, bottom first. */
export type TokenPreview = { id: number; layers: string[] }

/**
 * What the mint page needs that `MintPageData` does not carry yet. Replaced by: fields on the
 * freshness server's collection endpoint (creator, royalties, a staleness flag) and the minted
 * tokens' metadata.
 */
export type MintPageExtras = {
  creator: Address
  royaltyBps: number
  /** The freshness server could not read the chain recently; what is shown may be stale. */
  degraded: boolean
  /** Art for the next token ids, so a successful mint can show what it minted. */
  tokenPreviews: TokenPreview[]
}

/** How a mint can fail. Each kind has its own explanation and way forward. */
export type MintFailureKind =
  'rejected' | 'phase-closed' | 'quota-exceeded' | 'insufficient-balance' | 'reverted'

/**
 * Sample-mode controls, read from the URL so every state can be reviewed without a wallet. Null
 * outside sample mode.
 */
export type SampleControls = {
  /** Show this wallet as connected without a real wallet. */
  forcedWallet: WalletState | null
  /** Start the forced wallet on another chain, so the switch step shows. */
  wrongChain: boolean
  /** Make the simulated mint fail this way. */
  failure: MintFailureKind | null
}

export type MintPageProps = {
  data: MintPageData
  extras: MintPageExtras
  /** The connected wallet's state as the data source would return it; null outside sample mode. */
  sampleWallet: WalletState | null
  sample: SampleControls | null
}
