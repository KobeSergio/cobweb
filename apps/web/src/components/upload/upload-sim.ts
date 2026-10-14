/**
 * Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the Lock and upload actions simulated in client
 * state, so every state can be reviewed without a wallet, a chain or a database, as the Art screens
 * do. Real mode uses `realActions` (upload-actions.ts) and pays through wagmi (pay-machine.ts).
 *
 * The render is a scripted job stepped through the same `reload` the real screen polls
 * (docs/specs/2026-10-14-render-screen-wiring.md, section 11): paid to rendering, two batches a call,
 * then finalizing, then the done sample. Failures are driven by `?outcome=` on the first attempt only,
 * so every failure state can be reviewed and the way out then works: `check-failed` gives the sample
 * set two identical tokens for the duplicates check; `batch-failed` stops the run two batches after its
 * start on a worker failure the creator retries; `art-problem` stops it on a layer problem the creator
 * unlocks to fix. An unlock of a failed job leaves a credit, as the server's does: the next lock is
 * answered waived and the render starts at once, so the pay step is skipped.
 */
import type { TxFailure, TxPhase } from '@/components/deploy/tx-progress'
import { jobBase } from '@/lib/art/render-job'
import { JOB_NOT_FAILED } from '@/lib/art/result'
import { sampleTxHash } from '@/lib/demo/helpers'
import type { Hex, RenderJob } from '@/lib/demo/types'
import { RENDER_BATCH_SIZE } from './render-follow'
import type { UploadActions } from './upload-shared'

export type UploadOutcome =
  'rejected' | 'reverted' | 'balance' | 'check-failed' | 'batch-failed' | 'art-problem'

export const UPLOAD_OUTCOMES: UploadOutcome[] = [
  'rejected',
  'reverted',
  'balance',
  'check-failed',
  'batch-failed',
  'art-problem',
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

/** How many batches each `reload` moves a rendering sample job on by. */
export const SAMPLE_BATCHES_PER_RELOAD = 2
/** The worker's sentence the `batch-failed` outcome stops on. */
export const SAMPLE_BATCH_FAILURE = 'The pinning service answered with a different CID.'
/** The render problem the `art-problem` outcome stops on. */
export const SAMPLE_ART_PROBLEM =
  'The image for trait "Moon" in layer "Sky" is 2047 by 2048; every layer image must be 2048 by 2048.'

type DoneJob = Extract<RenderJob, { state: 'done' }>
type Rendering = Extract<RenderJob, { state: 'rendering' }>
type WithBatches = Extract<RenderJob, { state: 'paid' | 'waived' | 'rendering' | 'finalizing' | 'failed' }>

/**
 * The screen's actions in sample mode: they wait like the real ones and write nothing. `reload` steps
 * the scripted render from wherever the job is; `done` is the job the run ends on (the screen passes
 * the scenario's done sample, which keeps the run's own lock, quote, payment and batch counts).
 */
export function sampleActions(
  initial: RenderJob,
  options: { outcome?: UploadOutcome; done?: DoneJob } = {},
): UploadActions {
  const base = jobBase(initial)
  const batches = {
    total: Math.max(1, Math.ceil(base.tokenCount / RENDER_BATCH_SIZE)),
    done: 0,
    size: RENDER_BATCH_SIZE,
  }
  let current: RenderJob = initial
  // The render outcome fires once: a retry or an unlock clears it.
  let outcome = options.outcome
  // How many batches were done when the run started, for the stop two batches later.
  let startDone: number | null = null
  // The credit: set by an unlock of a failed job, spent by the next lock (one lock, as the database's).
  let creditNext = false

  const paid = (txHash: Hex | null): RenderJob => ({
    ...base,
    state: 'paid',
    payment: txHash ? { txHash, paidAt: nowSeconds(), amountWei: base.quote.totalWei } : null,
    batches,
  })

  const rendering = (from: WithBatches, done: number): Rendering => ({
    ...jobBase(from),
    state: 'rendering',
    payment: from.payment,
    batches: { ...from.batches, done },
    startedAt: 'startedAt' in from ? from.startedAt : nowSeconds(),
    failedBatch: null,
  })

  const failed = (from: Rendering, done: number, kind: 'batch-failed' | 'art-problem'): RenderJob => ({
    ...jobBase(from),
    state: 'failed',
    payment: from.payment,
    batches: { ...from.batches, done },
    error: kind === 'batch-failed' ? SAMPLE_BATCH_FAILURE : SAMPLE_ART_PROBLEM,
    errorCode: kind === 'batch-failed' ? 'cid-mismatch' : 'layer-size',
    retries: 0,
    failedBatch: done + 1,
    retryable: true,
  })

  const finished = (from: Rendering, done: DoneJob): RenderJob => ({
    ...done,
    ...jobBase(from),
    payment: from.payment,
    batches: { ...from.batches, done: from.batches.total },
    startedAt: from.startedAt,
    finishedAt: nowSeconds(),
  })

  /** One poll: the next scripted state of the job, or the same job when nothing follows it. */
  function step(job: RenderJob): RenderJob {
    if (job.state === 'paid' || job.state === 'waived') {
      startDone ??= 0
      return rendering(job, 0)
    }
    if (job.state === 'rendering') {
      startDone ??= job.batches.done
      const { total, done } = job.batches
      if (done >= total)
        return {
          ...jobBase(job),
          state: 'finalizing',
          payment: job.payment,
          batches: job.batches,
          startedAt: job.startedAt,
        }
      const stopAt = Math.min(startDone + SAMPLE_BATCHES_PER_RELOAD, total)
      const next = Math.min(done + SAMPLE_BATCHES_PER_RELOAD, total)
      if ((outcome === 'batch-failed' || outcome === 'art-problem') && next >= stopAt)
        return failed(job, stopAt - 1, outcome)
      return { ...job, batches: { ...job.batches, done: next } }
    }
    if (job.state === 'finalizing')
      return options.done ? finished(rendering(job, job.batches.total), options.done) : job
    return job
  }

  return {
    lock: async () => {
      await sleep(1200)
      const lockedAt = nowSeconds()
      const quote = { ...base.quote, expiresAt: lockedAt + DAY }
      if (creditNext) {
        // The credit pays the fee: the lock is recorded waived and the render starts at once.
        creditNext = false
        current = { ...base, lockedAt, quote, state: 'waived', payment: null, batches, credited: true }
        return { ok: true, data: current }
      }
      current = { ...base, lockedAt, quote, state: 'payment_due', payment: null }
      return { ok: true, data: current }
    },
    unlock: async () => {
      await sleep(600)
      // A failed job that is unlocked leaves its credit, whatever stopped it.
      if (current.state === 'failed') creditNext = true
      outcome = undefined
      startDone = null
      current = { ...base, state: 'locked' }
      return { ok: true, data: null }
    },
    requote: async () => {
      current = {
        ...base,
        quote: { ...base.quote, expiresAt: nowSeconds() + DAY },
        state: 'payment_due',
        payment: null,
      }
      return { ok: true, data: current }
    },
    confirm: async (_jobId, txHash) => {
      current = paid(txHash)
      return { ok: true, data: current }
    },
    reload: async () => {
      current = step(current)
      return { ok: true, data: current }
    },
    retry: async () => {
      await sleep(600)
      if (current.state !== 'failed') return { ok: false, error: JOB_NOT_FAILED }
      outcome = undefined
      startDone = null
      current = rendering(current, current.batches.done)
      return { ok: true, data: current }
    },
    lockPlaceholder: async () => {
      await sleep(1200)
      current = { ...paid(null), lockedAt: nowSeconds() }
      return { ok: true, data: current }
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
