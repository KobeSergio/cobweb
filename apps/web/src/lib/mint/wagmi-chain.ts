import type { Hex, TransactionReceipt } from 'viem'
import type { Config } from 'wagmi'
import { getPublicClient, simulateContract, writeContract } from 'wagmi/actions'
import { causes } from '@/components/deploy/tx-errors'
import type { MintCall } from './mint-call'
import type { MintChain } from './mint-run'

/** How long the page waits for a mint's receipt before it reads as unconfirmed. */
export const RECEIPT_WINDOW_MS = 180_000
/** The pause before waiting again after an RPC error. */
export const RECEIPT_RETRY_MS = 2_000

/** viem's `waitForTransactionReceipt`, as the receipt's wait calls it. */
export type ReceiptWait = (parameters: {
  hash: Hex
  timeout: number
  onReplaced: (replacement: { transaction: { hash: Hex } }) => void
}) => Promise<TransactionReceipt>

/** The time the window is measured on, and the pause between waits. */
export type ReceiptClock = { now(): number; sleep(ms: number): Promise<void> }

const systemClock: ReceiptClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** viem's transport errors; its JSON-RPC errors are each named `...RpcError`. */
const TRANSPORT_ERRORS = new Set([
  'HttpRequestError',
  'RpcRequestError',
  'TimeoutError',
  'WebSocketRequestError',
  'SocketClosedError',
])

/**
 * An RPC error that is not a "not found", as a rate-limited or busy public endpoint answers: the endpoint failed,
 * not the transaction. viem itself keeps polling through a receipt that is not there yet.
 */
function endpointFailed(error: unknown): boolean {
  const names = causes(error).map((entry) => String((entry as { name?: unknown }).name))
  if (names.some((name) => name.includes('NotFound'))) return false
  return names.some((name) => TRANSPORT_ERRORS.has(name) || name.endsWith('RpcError'))
}

/**
 * The receipt of `hash` within the window. viem's wait follows a replacement (a speed-up, a cancel, or another
 * transaction with the nonce) to the mined transaction's receipt and names its hash to `replaced`. It rejects at
 * once on an RPC error, so the wait starts again on the time left: only the window's end (viem's own timeout), a
 * "not found" or an error that is not an RPC error ends it, and the page reads unconfirmed only after the window.
 */
export async function receiptWithin(
  wait: ReceiptWait,
  hash: Hex,
  replaced?: (hash: Hex) => void,
  clock: ReceiptClock = systemClock,
): Promise<TransactionReceipt> {
  const deadline = clock.now() + RECEIPT_WINDOW_MS
  for (;;) {
    try {
      return await wait({
        hash,
        // viem reads a timeout of 0 as none.
        timeout: Math.max(1, deadline - clock.now()),
        onReplaced: (replacement) => replaced?.(replacement.transaction.hash),
      })
    } catch (error) {
      if (!endpointFailed(error) || deadline - clock.now() <= RECEIPT_RETRY_MS) throw error
      await clock.sleep(RECEIPT_RETRY_MS)
    }
  }
}

/**
 * The live chain for the page's mints (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5): wagmi
 * simulates the call through the chain's public transport and sends the simulated request through the connected
 * wallet; the receipt is read through the same transport within three minutes (`receiptWithin`). Both concern
 * the visitor's own transaction, not shared state (CLAUDE.md rule 3).
 */
export function wagmiMintChain(config: Config): MintChain {
  return {
    simulate: async (call: MintCall) => {
      const simulated = await simulateContract(config, { ...call })
      // CLAUDE.md rule 2: the wallet gets exactly the request the simulation passed.
      return () => writeContract(config, simulated.request)
    },
    receipt: async (hash, chainId, replaced) => {
      const client = getPublicClient(config, { chainId })
      if (!client) throw new Error('No RPC for this chain')
      return receiptWithin((parameters) => client.waitForTransactionReceipt(parameters), hash, replaced)
    },
  }
}
