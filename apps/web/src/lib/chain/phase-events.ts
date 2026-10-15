import { collectionAbi } from '@cobweb/shared/collection-abi'
import { decodeEventLog, type Abi, type Address } from 'viem'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import type { ExpectedEvent } from '@/lib/manage/phase-calls'
import type { ReceiptLike } from './art-paid'

/** What `matchPhaseEvent` reads of a transaction receipt. viem's `TransactionReceipt` fits it. */
export type PhaseReceipt = ReceiptLike & { from: Address; to: Address | null }

/** A match answers the event's decoded arguments, so a confirm can read what the event carried. */
export type PhaseEventMatch = { ok: true; args: Record<string, unknown> } | { ok: false; error: string }

/**
 * Whether every wanted argument equals the decoded one: a string (an address) without case, anything else (a
 * bigint, a boolean, a number) exactly. Close all names only its status; a withdrawal names nothing.
 */
function sameArgs(decoded: Record<string, unknown>, wanted: Record<string, unknown>): boolean {
  return Object.entries(wanted).every(([name, value]) => {
    const got = decoded[name]
    return typeof value === 'string' && typeof got === 'string'
      ? got.toLowerCase() === value.toLowerCase()
      : got === value
  })
}

/**
 * Checks that a receipt made the change the creator asked for (docs/specs/2026-10-15-phases.md, section
 * 6.3): sent to the contract (`NOT_THIS_CONTRACT`), from the sign-in wallet (`NOT_FROM_WALLET`), and
 * carrying, among the logs that contract emitted, the expected event with the expected arguments
 * (`NOT_THIS_CHANGE`), decoded with `abi` (the collection's unless given: the validator's for the level call,
 * docs/specs/2026-10-15-airdrop-settings.md, section 6.4). Addresses compare without case. The confirm checks a
 * reverted receipt first.
 */
export function matchPhaseEvent(
  receipt: PhaseReceipt,
  expected: { contract: Address; from: string; event: ExpectedEvent; abi?: Abi },
): PhaseEventMatch {
  const contract = expected.contract.toLowerCase()
  if (receipt.to?.toLowerCase() !== contract) return { ok: false, error: NOT_THIS_CONTRACT }
  if (receipt.from.toLowerCase() !== expected.from.toLowerCase()) return { ok: false, error: NOT_FROM_WALLET }
  if (receipt.status !== 'success') return { ok: false, error: NOT_THIS_CHANGE }
  const wanted: { eventName: string; args: Record<string, unknown> } = expected.event
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract) continue
    try {
      const event = decodeEventLog({ abi: expected.abi ?? collectionAbi, data: log.data, topics: log.topics })
      // viem decodes any event of the ABI by its topic, so the name is compared here.
      if (event.eventName !== wanted.eventName) continue
      const args = event.args as unknown as Record<string, unknown>
      if (sameArgs(args, wanted.args)) return { ok: true, args }
    } catch {
      // A log the ABI does not decode.
    }
  }
  return { ok: false, error: NOT_THIS_CHANGE }
}
