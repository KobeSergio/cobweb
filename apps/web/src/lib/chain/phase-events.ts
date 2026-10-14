import { collectionAbi } from '@cobweb/shared/collection-abi'
import { decodeEventLog, type Address } from 'viem'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import type { ExpectedEvent } from '@/lib/manage/phase-calls'
import type { ReceiptLike } from './art-paid'

/** What `matchPhaseEvent` reads of a transaction receipt. viem's `TransactionReceipt` fits it. */
export type PhaseReceipt = ReceiptLike & { from: Address; to: Address | null }

export type PhaseEventMatch = { ok: true } | { ok: false; error: string }

/** Whether every wanted argument equals the decoded one (Close all names only its status). */
function sameArgs(decoded: Record<string, unknown>, wanted: Record<string, bigint | boolean>): boolean {
  return Object.entries(wanted).every(([name, value]) => decoded[name] === value)
}

/**
 * Checks that a receipt made the change the creator asked for (docs/specs/2026-10-15-phases.md, section
 * 6.3): sent to the collection (`NOT_THIS_CONTRACT`), from the sign-in wallet (`NOT_FROM_WALLET`), and
 * carrying, among the logs the collection emitted, the expected event with the expected arguments
 * (`NOT_THIS_CHANGE`). Addresses compare without case. The confirm checks a reverted receipt first.
 */
export function matchPhaseEvent(
  receipt: PhaseReceipt,
  expected: { contract: Address; from: string; event: ExpectedEvent },
): PhaseEventMatch {
  const contract = expected.contract.toLowerCase()
  if (receipt.to?.toLowerCase() !== contract) return { ok: false, error: NOT_THIS_CONTRACT }
  if (receipt.from.toLowerCase() !== expected.from.toLowerCase()) return { ok: false, error: NOT_FROM_WALLET }
  if (receipt.status !== 'success') return { ok: false, error: NOT_THIS_CHANGE }
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract) continue
    try {
      const event = decodeEventLog({ abi: collectionAbi, data: log.data, topics: log.topics })
      // viem decodes any event of the ABI by its topic, so the name is compared here.
      if (event.eventName !== expected.event.eventName) continue
      if (sameArgs(event.args as Record<string, unknown>, expected.event.args)) return { ok: true }
    } catch {
      // A log the collection's ABI does not decode.
    }
  }
  return { ok: false, error: NOT_THIS_CHANGE }
}
