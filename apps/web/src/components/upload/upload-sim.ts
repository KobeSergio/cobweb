/**
 * Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the Lock and upload actions simulated in client
 * state, so every state can be reviewed without a wallet, a chain or a database, as the Art screens
 * do. Real mode uses `realActions` (upload-actions.ts) and pays through wagmi (pay-machine.ts);
 * rendering is simulated in both until Phase 4 (render-sim.ts).
 *
 * Failures are driven by `?outcome=` in sample mode, on the first attempt only, so every failure
 * state can be reviewed and "Try again" then succeeds. `check-failed` gives the sample set two
 * identical tokens, so the duplicates check on the Review step can be reviewed.
 */
import type { TxFailure, TxPhase } from '@/components/deploy/tx-progress'
import { jobBase } from '@/lib/art/render-job'
import { sampleTxHash } from '@/lib/demo/helpers'
import type { Hex, RenderJob } from '@/lib/demo/types'
import { RENDER_BATCH_SIZE } from './render-sim'
import type { UploadActions } from './upload-shared'

export type UploadOutcome = 'rejected' | 'reverted' | 'balance' | 'check-failed' | 'batch-failed'

export const UPLOAD_OUTCOMES: UploadOutcome[] = [
  'rejected',
  'reverted',
  'balance',
  'check-failed',
  'batch-failed',
]

/** The creator's choices under "Lock options", stored with the job (`RenderJob['lockOptions']`). */
export type LockOptions = {
  /** Accept identical trait combinations; the server honours it when it validates the list at lock. */
  allowDuplicates: boolean
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

const DAY = 24 * 60 * 60
const nowSeconds = () => Math.floor(Date.now() / 1000)

/** The screen's actions in sample mode: they wait like the real ones and write nothing. */
export function sampleActions(initial: RenderJob): UploadActions {
  const base = jobBase(initial)
  const batches = {
    total: Math.max(1, Math.ceil(base.tokenCount / RENDER_BATCH_SIZE)),
    done: 0,
    size: RENDER_BATCH_SIZE,
  }
  const paid = (txHash: Hex | null): RenderJob => ({
    ...base,
    state: 'paid',
    payment: txHash ? { txHash, paidAt: nowSeconds(), amountWei: base.quote.totalWei } : null,
    batches,
  })
  return {
    lock: async () => {
      await sleep(1200)
      return {
        ok: true,
        data: {
          ...base,
          lockedAt: nowSeconds(),
          quote: { ...base.quote, expiresAt: nowSeconds() + DAY },
          state: 'payment_due',
          payment: null,
        },
      }
    },
    unlock: async () => {
      await sleep(600)
      return { ok: true, data: null }
    },
    requote: async () => ({
      ok: true,
      data: {
        ...base,
        quote: { ...base.quote, expiresAt: nowSeconds() + DAY },
        state: 'payment_due',
        payment: null,
      },
    }),
    confirm: async (_jobId, txHash) => ({ ok: true, data: paid(txHash) }),
    reload: async () => ({ ok: true, data: initial }),
    lockPlaceholder: async () => {
      await sleep(1200)
      return { ok: true, data: { ...paid(null), lockedAt: nowSeconds() } }
    },
    uploadPlaceholder: null,
    removePlaceholder: async () => ({ ok: true, data: undefined }),
  }
}

const FAILURES: Record<
  'rejected' | 'reverted' | 'balance',
  { at: 'simulating' | 'wallet'; failure: TxFailure }
> = {
  rejected: {
    at: 'wallet',
    failure: {
      kind: 'rejected',
      title: 'Payment cancelled in your wallet',
      message: 'Nothing was sent and nothing was charged. Try again when you are ready.',
    },
  },
  reverted: {
    at: 'simulating',
    failure: {
      kind: 'reverted',
      title: 'The payment would fail',
      message:
        'The check against the factory reverted with JobAlreadyPaid: this wallet has a payment for this job already. Refresh the page; if the job still asks for payment, contact support.',
    },
  },
  balance: {
    at: 'simulating',
    failure: {
      kind: 'balance',
      title: 'Not enough funds in this wallet',
      message:
        'The fee and network gas are more than this wallet holds on the network. Add funds, then try again.',
    },
  },
}

/** Sample mode's payment: simulate, the wallet, the receipt and the server's check, with pauses. */
export async function payArtFee(
  onPhase: (phase: TxPhase) => void,
  options: { outcome?: UploadOutcome; signal: AbortSignal },
): Promise<Hex | null> {
  const { signal, outcome } = options
  const failure = outcome && outcome in FAILURES ? FAILURES[outcome as keyof typeof FAILURES] : null

  onPhase({ step: 'simulating' })
  await sleep(900, signal)
  if (failure?.at === 'simulating') {
    onPhase({ step: 'failed', ...failure })
    return null
  }

  onPhase({ step: 'wallet' })
  await sleep(1600, signal)
  if (failure?.at === 'wallet') {
    onPhase({ step: 'failed', ...failure })
    return null
  }

  const txHash = sampleTxHash(Math.floor(Date.now() / 1000) % 100_000)
  onPhase({ step: 'confirming', txHash })
  await sleep(1800, signal)
  onPhase({ step: 'verifying', txHash })
  await sleep(2000, signal)
  onPhase({ step: 'success', txHash })
  return txHash
}
