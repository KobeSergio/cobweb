import {
  HttpRequestError,
  LimitExceededRpcError,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'
import {
  RECEIPT_RETRY_MS,
  RECEIPT_WINDOW_MS,
  receiptWithin,
  type ReceiptClock,
  type ReceiptWait,
} from './wagmi-chain'

const HASH: Hex = `0x${'cd'.repeat(32)}`
const REPLACEMENT: Hex = `0x${'ef'.repeat(32)}`
const receipt = { status: 'success', blockNumber: 77n, logs: [] } as unknown as TransactionReceipt
const rateLimited = () => new HttpRequestError({ url: 'https://rpc.example', status: 429, body: {} })

/** A clock that moves only when the wait sleeps or a fake wait lets time `pass`. */
function fakeClock() {
  let time = 0
  const slept: number[] = []
  const clock: ReceiptClock = {
    now: () => time,
    sleep: async (ms) => {
      slept.push(ms)
      time += ms
    },
  }
  return { clock, slept, pass: (ms: number) => (time += ms) }
}

/** A wait that answers each call from the queue: an error rejects, a receipt resolves. */
function fakeWait(answers: (Error | TransactionReceipt)[], during: () => void = () => {}) {
  return vi.fn<ReceiptWait>(async () => {
    during()
    const next = answers.shift()
    if (!next || next instanceof Error) throw next ?? new Error('no answer')
    return next
  })
}

describe('receiptWithin (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5; fix round 1, item 4)', () => {
  it('waits again with the time left after an RPC error that is not a "not found"', async () => {
    const { clock, slept } = fakeClock()
    const wait = fakeWait([rateLimited(), new LimitExceededRpcError(new Error('limit')), receipt])
    await expect(receiptWithin(wait, HASH, undefined, clock)).resolves.toBe(receipt)
    expect(wait.mock.calls.map(([parameters]) => [parameters.hash, parameters.timeout])).toEqual([
      [HASH, RECEIPT_WINDOW_MS],
      [HASH, RECEIPT_WINDOW_MS - RECEIPT_RETRY_MS],
      [HASH, RECEIPT_WINDOW_MS - 2 * RECEIPT_RETRY_MS],
    ])
    expect(slept).toEqual([RECEIPT_RETRY_MS, RECEIPT_RETRY_MS])
  })

  it("goes on through RPC errors to the window's end, where viem's own timeout ends the wait", async () => {
    const { clock, pass } = fakeClock()
    // The endpoint answers 429 after 50 s each time, unless the wait's timeout comes first.
    const wait = vi.fn<ReceiptWait>(async ({ hash, timeout }) => {
      if (timeout <= 50_000) {
        pass(timeout)
        throw new WaitForTransactionReceiptTimeoutError({ hash })
      }
      pass(50_000)
      throw rateLimited()
    })
    await expect(receiptWithin(wait, HASH, undefined, clock)).rejects.toBeInstanceOf(
      WaitForTransactionReceiptTimeoutError,
    )
    expect(clock.now()).toBe(RECEIPT_WINDOW_MS)
    expect(wait).toHaveBeenCalledTimes(4)
  })

  it('ends at once on a "not found", an error that is not an RPC error, or an RPC error with no time to wait again', async () => {
    for (const error of [new TransactionReceiptNotFoundError({ hash: HASH }), new Error('boom')]) {
      const wait = fakeWait([error, receipt])
      await expect(receiptWithin(wait, HASH, undefined, fakeClock().clock)).rejects.toBe(error)
      expect(wait).toHaveBeenCalledOnce()
    }
    const { clock, pass } = fakeClock()
    const late = rateLimited()
    const wait = fakeWait([late, receipt], () => pass(RECEIPT_WINDOW_MS - RECEIPT_RETRY_MS))
    await expect(receiptWithin(wait, HASH, undefined, clock)).rejects.toBe(late)
    expect(wait).toHaveBeenCalledOnce()
  })

  it("names the replacement's hash, whose receipt viem resolves with", async () => {
    const replaced = vi.fn()
    const wait = vi.fn<ReceiptWait>(async ({ onReplaced }) => {
      onReplaced({ transaction: { hash: REPLACEMENT } })
      return receipt
    })
    await expect(receiptWithin(wait, HASH, replaced, fakeClock().clock)).resolves.toBe(receipt)
    expect(replaced).toHaveBeenCalledWith(REPLACEMENT)
  })
})
