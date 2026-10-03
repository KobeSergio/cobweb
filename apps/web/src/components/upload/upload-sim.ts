/**
 * SIMULATION SEAM for Lock and upload. Nothing here talks to a server or a chain; each function
 * stands in for one real action and reports the same states the real one will. Replace them
 * one by one when Phase 4 lands:
 *
 *  - `lockArt`      → a server action that submits the token list, runs the checks (MASTER_PLAN, Art: lock check),
 *                     stores and hashes it, and returns the job with its quote.
 *  - `payArtFee`    → wagmi: `simulateContract(payForArt(jobId), value: quote.totalWei)`, then
 *                     `writeContract(request)`, `waitForTransactionReceipt`, then poll the job
 *                     until the server has verified the `ArtPaid` event against the quote.
 *  - `followRender` → a subscription to the render job's progress (batches, then metadata).
 *  - `retryBatch`   → a server action that re-queues one failed batch.
 *
 * Failures are driven by `?outcome=` in sample mode, on the first attempt only, so every
 * failure state can be reviewed and "Try again" then succeeds.
 */
import type { Hex } from '@/lib/demo/types'
import { sampleTxHash } from '@/lib/demo/helpers'
import type { TxFailure, TxPhase } from '@/components/deploy/tx-progress'

export type UploadOutcome = 'rejected' | 'reverted' | 'balance' | 'check-failed' | 'batch-failed'

export const UPLOAD_OUTCOMES: UploadOutcome[] = [
  'rejected',
  'reverted',
  'balance',
  'check-failed',
  'batch-failed',
]

/** Tokens per render batch for a fresh job. */
export const RENDER_BATCH_SIZE = 100

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

// ---------------------------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------------------------

export type LockCheck = 'supply' | 'duplicates' | 'rules' | 'constants'
export type CheckState = 'waiting' | 'running' | 'passed' | 'failed'

export type LockResult = { ok: true; lockedAt: number } | { ok: false; check: LockCheck; message: string }

const CHECK_ORDER: LockCheck[] = ['supply', 'duplicates', 'rules', 'constants']

/**
 * Submits the token list and runs the server's checks, reporting each as it runs. With deferred
 * art only the placeholder is locked, so `checks` is empty and nothing about the set is checked.
 */
export async function lockArt(
  onCheck: (check: LockCheck, state: CheckState) => void,
  options: { outcome?: UploadOutcome; signal: AbortSignal; checks?: LockCheck[] },
): Promise<LockResult> {
  for (const check of options.checks ?? CHECK_ORDER) {
    onCheck(check, 'running')
    await sleep(450, options.signal)
    if (check === 'duplicates' && options.outcome === 'check-failed') {
      onCheck(check, 'failed')
      return {
        ok: false,
        check,
        message: 'Tokens 118 and 540 have the same traits. Regenerate or edit one of them, then lock again.',
      }
    }
    onCheck(check, 'passed')
  }
  await sleep(300, options.signal)
  return { ok: true, lockedAt: Math.floor(Date.now() / 1000) }
}

// ---------------------------------------------------------------------------------------------
// Pay
// ---------------------------------------------------------------------------------------------

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
        'The check against the factory reverted with AlreadyPaid: this wallet has a payment for this job already. Refresh the page; if the job still asks for payment, contact support.',
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

/** Pays the art fee: simulate, open the wallet, wait for the receipt, wait for the server to verify. */
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

// ---------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------

export type RenderProgress = {
  phase: 'images' | 'metadata' | 'done'
  total: number
  done: number
  size: number
  /** The batch number (1-based) that failed, while it waits for a retry. */
  failedBatch?: number
}

/**
 * Follows the render from `start` until the metadata is pinned. With the `batch-failed` outcome,
 * the batch after the starting point fails once and the run stops until `followRender` is called
 * again from that point (the retry).
 */
export async function followRender(
  start: RenderProgress,
  onProgress: (progress: RenderProgress) => void,
  options: { outcome?: UploadOutcome; signal: AbortSignal },
): Promise<void> {
  const failAt = options.outcome === 'batch-failed' ? Math.min(start.done + 2, start.total) : null
  let progress = { ...start, failedBatch: undefined }
  while (progress.done < progress.total) {
    await sleep(750, options.signal)
    if (failAt !== null && progress.done + 1 === failAt) {
      onProgress({ ...progress, failedBatch: failAt })
      return
    }
    progress = { ...progress, done: progress.done + 1 }
    onProgress(progress)
  }
  progress = { ...progress, phase: 'metadata' }
  onProgress(progress)
  await sleep(2400, options.signal)
  onProgress({ ...progress, phase: 'done' })
}

/** Rough real-world time per batch, for the estimate shown to the creator. */
export const SECONDS_PER_BATCH = 95
