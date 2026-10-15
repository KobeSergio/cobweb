import { zeroAddress, type Address } from 'viem'

/**
 * The collection's transfer level as Cobweb reads it (docs/specs/2026-10-16-freshness-server.md, section
 * 5.1), shared by Settings and the freshness server. Pure.
 */

/** The validator's levels Cobweb sends: royalties enforced, royalties not enforced, and locked. */
export const TRANSFER_LEVELS = { enforced: 0, open: 1, locked: 9 } as const
export type TransferLevelValue = (typeof TRANSFER_LEVELS)[keyof typeof TRANSFER_LEVELS]

/**
 * The collection's transfer level on its validator: none (no validator, or no code at its address), not read
 * (the validator did not answer), or the level the validator holds.
 */
export type TransferLevelState =
  { kind: 'none'; reason: 'zero' | 'no-code' } | { kind: 'unread' } | { kind: 'level'; level: number }

/**
 * The level a read gives: none for the zero address or a validator without code, unread when it did not
 * answer.
 */
export function levelOf(
  validator: Address,
  hasCode: boolean,
  policyLevel: number | null,
): TransferLevelState {
  if (validator.toLowerCase() === zeroAddress) return { kind: 'none', reason: 'zero' }
  if (!hasCode) return { kind: 'none', reason: 'no-code' }
  return policyLevel === null ? { kind: 'unread' } : { kind: 'level', level: policyLevel }
}
