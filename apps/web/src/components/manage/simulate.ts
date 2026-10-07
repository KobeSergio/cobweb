/**
 * The simulated chain behind Manage drop. Nothing here talks to a wallet or an RPC: every
 * function stands in for one real piece, and each is marked `SEAM:` with what replaces it.
 * Screens import only from this module (through `useTransaction`) for anything that will be a
 * transaction, so wiring the contract later touches this file and not the screens.
 */
import {
  DEMO_MINT_PAGE_SETTINGS,
  DEMO_NOW,
  DEMO_RENDER_JOBS,
  DEMO_WHITELISTS,
} from '@/lib/demo'
import type { Address, Hex, MintGroup } from '@/lib/demo'

/** A contract call as the creator reviews it before signing. */
export type TxRequest = {
  /** The contract the call goes to. */
  contract: 'Collection' | 'Transfer validator'
  /** The function name exactly as in the ABI, e.g. `setMintGroupStatus`. */
  functionName: string
  /** Arguments in ABI order, already formatted for reading. */
  args: { name: string; value: string }[]
  /** Native amount sent with the call, in wei. */
  valueWei?: string
  /**
   * Mirrors the contract's own checks and returns the revert reason, or null if the call would
   * pass. Runs in the "checking" step.
   * SEAM: replaced by viem `simulateContract`, whose decoded custom error becomes the message.
   */
  check?: () => string | null
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Step 1, checking.
 * SEAM: `publicClient.simulateContract({ address, abi, functionName, args, value, account })`.
 * Rule 2: the wallet opens only after this passes, and the simulated request is what is sent.
 */
export async function simulateRequest(
  request: TxRequest,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await wait(650)
  const reason = request.check?.() ?? null
  return reason ? { ok: false, reason } : { ok: true }
}

/**
 * Step 3, confirming. Resolves with the receipt status.
 * SEAM: `publicClient.waitForTransactionReceipt({ hash })`, then a re-read through the
 * freshness server so the screen shows what the chain reports.
 */
export async function waitForReceipt(revert: boolean): Promise<'success' | 'reverted'> {
  await wait(1600)
  return revert ? 'reverted' : 'success'
}

/**
 * A fresh transaction hash for a simulated send.
 * SEAM: the hash `walletClient.writeContract(simulated.request)` returns.
 */
export function simulatedTxHash(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/**
 * What the chain reports for a group after a write lands. This mirrors the contract's
 * `mintGroupActive` (flag on, or a schedule reached with `block.timestamp >= start`) and stands
 * in for the chain itself. Screens never compute liveness; they take `active` from here as they
 * will take it from the freshness server.
 * SEAM: replaced by the freshness server's re-read of `collectionState()`.
 */
export function chainReadGroup(group: Omit<MintGroup, 'active'>, blockTimestamp: number): MintGroup {
  const scheduledReached = group.scheduledStart !== 0 && blockTimestamp >= group.scheduledStart
  return { ...group, active: group.flag || scheduledReached }
}

/**
 * Sample values a screen needs beyond its props. Each names the real source.
 */
export const SAMPLE = {
  /** SEAM: the freshness server's `readAt` / block timestamp for the collection. */
  readAt: DEMO_NOW,
  /** SEAM: whitelist entries and the chunk table. */
  whitelists: DEMO_WHITELISTS,
  /** SEAM: the mint page settings row (avatar and the public switch on the overview). */
  mintPage: DEMO_MINT_PAGE_SETTINGS,
  /**
   * SEAM: the collection's `getTransferValidator()`. Limit Break's default validator, the
   * `DEFAULT_TRANSFER_VALIDATOR` constant of creator-token-standards, same address on every chain.
   */
  transferValidator: '0x721C008fdff27BF06E7E123956E2Fe03B63342e3' as Address,
  /** SEAM: `render_jobs.metadata_cid` of the finished render job, the reveal target. */
  metadataCid: DEMO_RENDER_JOBS.done.metadataCid,
} as const

/**
 * Saves off-chain settings (mint page details).
 * SEAM: a server action that checks the session and ownership, then writes the settings row.
 */
export async function saveOffChain(): Promise<void> {
  await wait(900)
}
