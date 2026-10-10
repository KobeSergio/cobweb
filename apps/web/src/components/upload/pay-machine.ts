import type { TxFailure, TxPhase } from '@/components/deploy/tx-progress'
import {
  CHAIN_NOT_READY,
  NO_PAYMENT_FOR_JOB,
  NOT_CONFIRMED,
  NOT_THIS_JOB,
  OTHER_WALLET,
  PAYMENT_USED,
  SHORT_PAYMENT,
  THROWN,
  TIMED_OUT,
  type ActionResult,
} from '@/lib/art/result'
import type { Hex, RenderJob } from '@/lib/demo/types'

/**
 * The pay step's payment as a pure machine (docs/specs/2026-10-09-lock-and-pay.md, section 8), so
 * every path is tested in Node: the checks before the wallet opens, simulate, the wallet, the
 * receipt, then the server's confirmation polled every 3 seconds for up to 2 minutes. `PayStep`
 * wires the wagmi actions in. CLAUDE.md rule 2 holds by construction: `simulate` returns the only
 * way to send, and it sends the simulated request.
 */
export const CONFIRM_INTERVAL_MS = 3_000
export const CONFIRM_TIMEOUT_MS = 120_000

export type PayEvent =
  | { type: 'set'; phase: TxPhase }
  | { type: 'simulating' }
  | { type: 'wallet' }
  | { type: 'confirming'; txHash: Hex }
  | { type: 'verifying'; txHash: Hex }
  | { type: 'success'; txHash: Hex }
  | { type: 'failed'; failure: TxFailure }

export function payReducer(phase: TxPhase, event: PayEvent): TxPhase {
  switch (event.type) {
    case 'set':
      return event.phase
    case 'simulating':
      return { step: 'simulating' }
    case 'wallet':
      return { step: 'wallet' }
    case 'confirming':
      return { step: 'confirming', txHash: event.txHash }
    case 'verifying':
      return { step: 'verifying', txHash: event.txHash }
    case 'success':
      return { step: 'success', txHash: event.txHash }
    case 'failed': {
      if (phase.step === 'idle' || phase.step === 'success')
        return { step: 'failed', at: 'simulating', failure: event.failure }
      const at = phase.step === 'failed' ? phase.at : phase.step
      return phase.txHash
        ? { step: 'failed', at, failure: event.failure, txHash: phase.txHash }
        : { step: 'failed', at, failure: event.failure }
    }
  }
}

export type PayInput = {
  /** The quote's wallet: only its payment counts. */
  payer: string
  /** The connected account, if any. */
  account: string | undefined
  /** The quote's chain. */
  chainId: number
  connectedChainId: number | undefined
  chainName: string
  factory: string | null
  /** A transaction already sent for this job: check it instead of paying again. */
  sentHash?: Hex
}

export type PayDeps = {
  /** Simulates `payForArt`; resolves with the function that sends the simulated request, unchanged. */
  simulate(): Promise<() => Promise<Hex>>
  wait(hash: Hex): Promise<'success' | 'reverted'>
  confirm(hash: Hex): Promise<ActionResult<RenderJob>>
  reload(): Promise<ActionResult<RenderJob | null>>
  remember(hash: Hex): void
  forget(): void
  sleep(ms: number): Promise<void>
  now(): number
}

const REJECTED: TxFailure = {
  kind: 'rejected',
  title: 'Payment cancelled in your wallet',
  message: 'Nothing was sent and nothing was charged. Try again when you are ready.',
}
const BALANCE: TxFailure = {
  kind: 'balance',
  title: 'Not enough funds in this wallet',
  message:
    'The fee and network gas are more than this wallet holds on the network. Add funds, then try again.',
}
const REVERTED_ON_CHAIN: TxFailure = {
  kind: 'reverted',
  title: 'The payment failed on chain',
  message: 'The transaction was included but reverted, so nothing was paid. Try again.',
}

/** Why the wallet must not open yet, or null. */
export function preflight(input: PayInput): TxFailure | null {
  if (!input.factory)
    return { kind: 'refused', title: 'Payments are not open on this network', message: CHAIN_NOT_READY }
  if (!input.account)
    return {
      kind: 'refused',
      title: 'Connect your wallet',
      message: 'Connect your wallet to pay. Nothing was sent.',
    }
  if (input.account.toLowerCase() !== input.payer.toLowerCase())
    return {
      kind: 'refused',
      title: 'Use the wallet the quote was issued to',
      message: `Only a payment from ${input.payer} counts for this job. Switch to that account in your wallet, then try again.`,
    }
  if (input.connectedChainId !== input.chainId)
    return {
      kind: 'switch',
      title: `Switch to ${input.chainName}`,
      message: `The quote is on ${input.chainName}. Switch your wallet to it, then try again.`,
    }
  return null
}

function causes(error: unknown): unknown[] {
  const list: unknown[] = []
  let current: unknown = error
  for (let depth = 0; current && depth < 10; depth++) {
    list.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return list
}

/** A wallet or chain error as the creator reads it. */
export function classifyError(error: unknown, at: 'simulating' | 'wallet' | 'confirming'): TxFailure {
  const chain = causes(error)
  const rejected = chain.some(
    (entry) =>
      (entry as { name?: string }).name === 'UserRejectedRequestError' ||
      (entry as { code?: unknown }).code === 4001,
  )
  if (rejected) return REJECTED
  const text = chain.map((entry) => (entry instanceof Error ? entry.message : String(entry))).join(' ')
  if (/insufficient funds/i.test(text)) return BALANCE
  const short =
    (error as { shortMessage?: string }).shortMessage ??
    (error instanceof Error ? error.message : 'Unknown error.')
  if (at === 'simulating')
    return {
      kind: 'reverted',
      title: 'The payment would fail',
      message: `The check against the factory failed: ${short} Nothing was sent.`,
    }
  if (at === 'wallet')
    return {
      kind: 'rejected',
      title: 'The wallet did not send the payment',
      message: `${short} Nothing was charged.`,
    }
  return {
    kind: 'reverted',
    title: 'The payment could not be confirmed',
    message: `${short} Check your wallet's activity before you pay again.`,
  }
}

/**
 * Asks the server to confirm a payment every 3 seconds while it answers "not confirmed yet", for up
 * to 2 minutes. "Already used" and "no payment waiting for this job" are a confirmation that arrived
 * before when the job's recorded hash is this one. A confirm that throws is a transient failure.
 */
export async function verifyPayment(
  hash: Hex,
  deps: Pick<PayDeps, 'confirm' | 'reload' | 'sleep' | 'now'>,
): Promise<{ job: RenderJob } | { error: string }> {
  const started = deps.now()
  for (;;) {
    let result: ActionResult<RenderJob>
    try {
      result = await deps.confirm(hash)
    } catch {
      return { error: THROWN }
    }
    if (result.ok) return { job: result.data }
    if (result.error === PAYMENT_USED || result.error === NO_PAYMENT_FOR_JOB) {
      let current: ActionResult<RenderJob | null>
      try {
        current = await deps.reload()
      } catch {
        return { error: THROWN }
      }
      const job = current.ok ? current.data : null
      if (job && 'payment' in job && job.payment?.txHash.toLowerCase() === hash.toLowerCase()) {
        // A short payment is recorded with its hash but the job still waits: that is not a success.
        if (job.state === 'payment_due')
          return { error: `${SHORT_PAYMENT} Tell support about job ${job.jobId}.` }
        return { job }
      }
      // The reload itself failing says nothing about the payment: keep the hash.
      return { error: current.ok ? result.error : current.error }
    }
    if (result.error !== NOT_CONFIRMED) return { error: result.error }
    if (deps.now() - started + CONFIRM_INTERVAL_MS > CONFIRM_TIMEOUT_MS) return { error: TIMED_OUT }
    await deps.sleep(CONFIRM_INTERVAL_MS)
  }
}

/**
 * Whether the server's answer ends the payment for good, so this browser forgets the hash. Any other
 * refusal (signed out, a thrown action, an unsaved change, a chain not ready, a collection not found,
 * a network error) says nothing about the payment: the hash stays and "Check again" is offered.
 */
export function isTerminalAnswer(error: string): boolean {
  return (
    error === NOT_THIS_JOB ||
    error === OTHER_WALLET ||
    error === PAYMENT_USED ||
    error === NO_PAYMENT_FOR_JOB ||
    isShortPayment(error)
  )
}

/** Pays the art fee, or checks a payment already sent, reporting each step through `dispatch`. */
export async function runPayment(
  input: PayInput,
  deps: PayDeps,
  dispatch: (event: PayEvent) => void,
): Promise<RenderJob | null> {
  let hash = input.sentHash
  if (!hash) {
    const blocked = preflight(input)
    if (blocked) {
      dispatch({ type: 'failed', failure: blocked })
      return null
    }
    dispatch({ type: 'simulating' })
    let send: () => Promise<Hex>
    try {
      send = await deps.simulate()
    } catch (error) {
      dispatch({ type: 'failed', failure: classifyError(error, 'simulating') })
      return null
    }
    dispatch({ type: 'wallet' })
    try {
      hash = await send()
    } catch (error) {
      dispatch({ type: 'failed', failure: classifyError(error, 'wallet') })
      return null
    }
    deps.remember(hash)
    dispatch({ type: 'confirming', txHash: hash })
    let status: 'success' | 'reverted'
    try {
      status = await deps.wait(hash)
    } catch (error) {
      // The receipt could not be read: the transaction may still land, so keep the hash and offer a check.
      dispatch({
        type: 'failed',
        failure: { ...classifyError(error, 'confirming'), kind: 'unconfirmed' },
      })
      return null
    }
    if (status === 'reverted') {
      deps.forget()
      dispatch({ type: 'failed', failure: REVERTED_ON_CHAIN })
      return null
    }
  }
  dispatch({ type: 'verifying', txHash: hash })
  const verified = await verifyPayment(hash, deps)
  if ('job' in verified) {
    deps.forget()
    dispatch({ type: 'success', txHash: hash })
    return verified.job
  }
  if (!isTerminalAnswer(verified.error)) {
    // Timed out or a transient refusal: the payment may still be recorded, so the hash stays.
    dispatch({
      type: 'failed',
      failure: {
        kind: 'unconfirmed',
        title: 'Payment not confirmed yet',
        message: verified.error,
      },
    })
  } else {
    // A short payment is recorded on the job (it stays awaiting payment) and the server has its
    // hash, so this browser forgets it either way. The whole sentence says what to tell support.
    deps.forget()
    dispatch({
      type: 'failed',
      failure: {
        kind: 'refused',
        title: isShortPayment(verified.error)
          ? 'The payment was less than the quote'
          : 'Cobweb could not accept this payment',
        message: verified.error,
      },
    })
  }
  return null
}

/** The server's sentence for a payment that fell short of the quote. */
export const isShortPayment = (error: string) => error.startsWith(SHORT_PAYMENT)

/** The hash "Try again" checks again instead of paying: a payment sent but not confirmed in time. */
export function retryHash(phase: TxPhase): Hex | undefined {
  return phase.step === 'failed' && phase.failure.kind === 'unconfirmed' ? phase.txHash : undefined
}

export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const keyFor = (jobId: string) => `cobweb-art-payment:${jobId}`
const HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** The browser's localStorage, or null where it is blocked or absent. */
export function browserStore(): KeyStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function rememberPayment(store: KeyStore | null, jobId: string, hash: Hex): void {
  try {
    store?.setItem(keyFor(jobId), hash)
  } catch {
    // Storage blocked: the payment is still checked in this visit.
  }
}

/** A payment this browser sent for the job and the server has not recorded yet, or null. */
export function pendingPayment(store: KeyStore | null, jobId: string): Hex | null {
  try {
    const value = store?.getItem(keyFor(jobId)) ?? null
    return value && HASH_RE.test(value) ? (value as Hex) : null
  } catch {
    return null
  }
}

export function forgetPayment(store: KeyStore | null, jobId: string): void {
  try {
    store?.removeItem(keyFor(jobId))
  } catch {
    // Storage blocked: nothing was kept.
  }
}
