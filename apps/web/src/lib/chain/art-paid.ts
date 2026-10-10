import { factoryAbi } from '@cobweb/shared'
import { decodeEventLog, type Address, type Hex, type Log } from 'viem'
import { NOT_THIS_JOB, OTHER_WALLET, SHORT_PAYMENT } from '@/lib/art/result'

/** What `matchArtPaid` reads of a transaction receipt. viem's `TransactionReceipt` fits it. */
export type ReceiptLike = {
  status: 'success' | 'reverted'
  logs: readonly Pick<Log, 'address' | 'data' | 'topics'>[]
}

export type ArtPaidMatch = { ok: true; payer: Address; amount: bigint } | { ok: false; error: string }

/**
 * Finds the factory's `ArtPaid` log for a job in a receipt and checks it against the quote (spec
 * section 7): the log must come from the factory's address and carry the job's id; the payer must
 * be the quote's wallet and the amount at least the quote. The payer and amount come from the log,
 * never from the browser.
 */
export function matchArtPaid(
  receipt: ReceiptLike,
  expected: { factory: Address; jobId: Hex; payer: string; minAmount: bigint },
): ArtPaidMatch {
  if (receipt.status !== 'success') return { ok: false, error: NOT_THIS_JOB }
  const paid: { payer: Address; amount: bigint }[] = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== expected.factory.toLowerCase()) continue
    try {
      const event = decodeEventLog({
        abi: factoryAbi,
        eventName: 'ArtPaid',
        data: log.data,
        topics: log.topics,
      })
      if (event.args.jobId.toLowerCase() === expected.jobId.toLowerCase())
        paid.push({ payer: event.args.payer, amount: event.args.amount })
    } catch {
      // Another event of the factory.
    }
  }
  if (paid.length === 0) return { ok: false, error: NOT_THIS_JOB }
  const fromPayer = paid.filter((entry) => entry.payer.toLowerCase() === expected.payer.toLowerCase())
  if (fromPayer.length === 0) return { ok: false, error: OTHER_WALLET }
  const enough = fromPayer.find((entry) => entry.amount >= expected.minAmount)
  if (!enough) return { ok: false, error: SHORT_PAYMENT }
  return { ok: true, payer: enough.payer, amount: enough.amount }
}
