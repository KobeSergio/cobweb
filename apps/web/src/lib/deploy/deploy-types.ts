import type { Address, Hex } from 'viem'
import type { FeeSnapshot, RenderJob, SupportedChain } from '@/lib/demo/types'

/** One launch phase as the creator fills it in: index 0 is the public sale. */
export type DeployGroup = { name: string; priceWei: string; maxSupply: number }

/** What the deploy screen sends to prepare and to confirm (docs/specs/2026-10-14-deploy.md, section 6.1). */
export type DeployForm = {
  /** The picked chain; must equal the done real job's quote chain when there is one. */
  chainId: number
  payout: Address
  royaltyBps: number
  royaltyReceiver: Address
  publicMaxPerWallet: number
  /** Index 0 the public sale, then up to nine more. */
  groups: DeployGroup[]
}

/** The constructor arguments as prepared and as stored in `deployments.args`: every uint a decimal string. */
export type PreparedArgs = {
  name: string
  symbol: string
  payout: Address
  baseUri: string
  maxSupply: string
  groupSupplies: string[]
  groupPrices: string[]
  publicMaxPerWallet: string
  royaltyBps: number
  owner: Address
  royaltyReceiver: Address
}

/** What `prepareDeploy` answers: everything the browser sends, and what the server proves again at confirm. */
export type Prepared = {
  chainId: number
  factory: Address
  deployer: Address
  salt: Hex
  codeHash: Hex
  args: PreparedArgs
  /** The validated launch phases, names trimmed, in group order. */
  groups: DeployGroup[]
  encodedArgs: Hex
  predicted: Address
  /** The base URI the contract starts on. */
  baseUri: string
  /** The real set's base URI when the contract starts on a placeholder and the real set is rendered; else null. */
  revealsTo: string | null
  fees: FeeSnapshot
}

export type DeployRecordGroup = { onchainId: number; name: string; priceWei: string; maxSupply: number }

/**
 * A deployed collection as `deployments` and `mint_groups` record it, read under the creator's client. The
 * public limit and the launch phases are the constructor's (`deployments.args`), named from `mint_groups`.
 */
export type DeployRecord = {
  chainId: number
  contractAddress: Address
  txHash: Hex
  deployer: Address
  /** Unix seconds. */
  deployedAt: number
  baseUri: string
  payout: Address
  royaltyBps: number
  royaltyReceiver: Address
  publicMaxPerWallet: number
  fees: FeeSnapshot
  groups: DeployRecordGroup[]
}

export type DoneJob = Extract<RenderJob, { state: 'done' }>

/** The finished jobs the deploy starts from: `start` is the one the contract points at. */
export type DeployJobs = { start: DoneJob | null; real: DoneJob | null }

/** What the deploy page needs from the server in one read. */
export type DeployView = {
  jobs: DeployJobs
  /** The chain the fee was paid on (the done real job's quote chain), or null when the creator picks. */
  chainId: number | null
  /** The factory's fee snapshot on that chain, read on the server; null when unreadable or when there is no chain yet. */
  fees: FeeSnapshot | null
  record: DeployRecord | null
}

/** A chain the deploy screen offers, with its factory when the environment names one. */
export type DeployChain = SupportedChain & { factory: Address | null }
