import type { ProjectType } from '@/lib/collections'

/** The quote in wei: the factory's rate times the tokens. A single asset pays nothing (MASTER_PLAN, art fee). */
export function quoteTotalWei(projectType: ProjectType, feePerTokenWei: bigint, tokenCount: number): bigint {
  return projectType === 'single_asset' ? 0n : feePerTokenWei * BigInt(tokenCount)
}

/** Whether a quote that runs until `expiresAt` (unix seconds) has expired at `now` (unix seconds). */
export function quoteExpired(expiresAt: number, now: number): boolean {
  return expiresAt < now
}

/** A rate the lock can quote from: read from a configured factory, and above zero (zero would be a free job). */
export function feeReady(fee: bigint | null): fee is bigint {
  return fee !== null && fee > 0n
}
