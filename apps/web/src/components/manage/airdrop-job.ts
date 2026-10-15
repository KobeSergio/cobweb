import type { Hex } from 'viem'
import type { AirdropJob } from '@/lib/manage/airdrop-types'
import { batchesOf, BURN_ADDRESS, tokensOf } from '@/lib/manage/airdrop-view'
import type { Recipient } from './recipients'

/**
 * The airdrop in progress, pure (docs/specs/2026-10-15-airdrop-settings.md, section 7.2): the list frozen into its
 * batches at the first send, a burn kept only while its hash is pending, and the job after a batch is sent or
 * confirmed. The screen holds it and the store keeps it across a reload (manage-machine.ts).
 */

/** The list frozen into its batches, in its order, none sent yet. */
export function frozenJob(rows: readonly Recipient[]): AirdropJob {
  return { kind: 'airdrop', batches: batchesOf(rows), sent: 0, pending: null }
}

/** A burn sent and not confirmed yet: one batch of one entry to the dead address, with its hash. */
export function burnJob(amount: number, hash: Hex): AirdropJob {
  return { kind: 'burn', batches: [[{ address: BURN_ADDRESS, amount }]], sent: 0, pending: hash }
}

/** The job with the current batch's hash pending, or forgotten; a burn without its hash is no job. */
export function withPending(job: AirdropJob, hash: Hex | null): AirdropJob | null {
  if (job.kind === 'burn' && hash === null) return null
  return { ...job, pending: hash }
}

/** The job once its current batch is confirmed: on to the next, no hash; no job after the last batch. */
export function withConfirmed(job: AirdropJob): AirdropJob | null {
  const sent = job.sent + 1
  return sent >= job.batches.length ? null : { ...job, sent, pending: null }
}

/** The tokens of the batches not confirmed yet, the pending one included. */
export function unsentTokens(job: AirdropJob): number {
  return job.batches.slice(job.sent).reduce((sum, batch) => sum + tokensOf(batch), 0)
}
