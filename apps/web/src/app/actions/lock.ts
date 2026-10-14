'use server'

import {
  confirmCore,
  lockCore,
  lockPlaceholderCore,
  quoteCore,
  renderJobCore,
  retryCore,
  reviewLock,
  unlockCore,
} from '@/lib/art/lock-core'
import type { ReviewData } from '@/lib/art/lock-review'
import { lockArtInput, txHash as txHashSchema, type LockArtInput } from '@/lib/art/lock-schemas'
import { lockWrite } from '@/lib/art/lock-write'
import type { ActionResult } from '@/lib/art/result'
import { parse, uuid } from '@/lib/art/schemas'
import type { RenderJob } from '@/lib/demo/types'

/** The review step's checks, counts and supply for the art as it is stored now. */
export async function reviewArt(collectionId: string): Promise<ActionResult<ReviewData>> {
  return lockWrite(collectionId, async (ctx) => ({ data: await reviewLock(ctx) }))
}

/** Locks the art and quotes the fee on the collection's chain, or the one the creator's wallet is on. */
export async function lockArt(collectionId: string, options: LockArtInput): Promise<ActionResult<RenderJob>> {
  const input = parse(lockArtInput, options)
  if (!input.ok) return input
  return lockWrite(collectionId, (ctx) => lockCore(ctx, input.data))
}

/** Unlocks the art: an unpaid lock is cancelled; a paid render that failed is released and leaves a credit for the next lock. The Art step opens again. */
export async function unlockArt(collectionId: string): Promise<ActionResult<null>> {
  return lockWrite(collectionId, (ctx) => unlockCore(ctx))
}

/** Deferred art: locks the placeholder alone, at no cost. */
export async function lockPlaceholder(
  collectionId: string,
  uploadId: string,
): Promise<ActionResult<RenderJob>> {
  const input = parse(uuid, uploadId)
  if (!input.ok) return input
  return lockWrite(collectionId, (ctx) => lockPlaceholderCore(ctx, input.data))
}

/** The open job, quoted again from the factory's current rate when its quote expired. */
export async function quoteArt(collectionId: string): Promise<ActionResult<RenderJob>> {
  return lockWrite(collectionId, (ctx) => quoteCore(ctx))
}

/** Checks a payment against its receipt's ArtPaid log and the quote, then marks the job paid. */
export async function confirmArtPayment(
  collectionId: string,
  jobId: string,
  txHash: string,
): Promise<ActionResult<RenderJob>> {
  const job = parse(uuid, jobId)
  if (!job.ok) return job
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  return lockWrite(collectionId, (ctx) => confirmCore(ctx, job.data, hash.data))
}

/** The job Lock and upload shows, or null before anything is locked. */
export async function getRenderJob(collectionId: string): Promise<ActionResult<RenderJob | null>> {
  return lockWrite(collectionId, (ctx) => renderJobCore(ctx))
}

/** Retries a failed render: re-queues the failed batches and sends the start message with the new retry count. */
export async function retryRender(collectionId: string): Promise<ActionResult<RenderJob>> {
  return lockWrite(collectionId, (ctx) => retryCore(ctx))
}
