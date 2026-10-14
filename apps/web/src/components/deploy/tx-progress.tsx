'use client'

import { CheckIcon, ExternalLinkIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import type { Hex } from '@/lib/demo/types'

/**
 * The steps a wallet transaction goes through, in order (rule 2: simulate, then send the
 * simulated request). Not every flow uses every step: only deploy prepares on the server and
 * switches chain; both wait for the server to verify the event.
 */
export type TxStep = 'preparing' | 'switching' | 'simulating' | 'wallet' | 'confirming' | 'verifying'

export type TxFailure = {
  /**
   * rejected: cancelled in the wallet. reverted: the simulation or the transaction failed. balance:
   * not enough funds. switch: the wallet is on another chain. refused: a check before the wallet, or
   * the server, refused it. unconfirmed: sent but not confirmed in time; trying again checks it again.
   */
  kind: 'rejected' | 'reverted' | 'balance' | 'switch' | 'refused' | 'unconfirmed'
  title: string
  message: string
}

export type TxPhase =
  | { step: 'idle' }
  | { step: TxStep; txHash?: Hex }
  | { step: 'success'; txHash: Hex }
  | { step: 'failed'; at: TxStep; failure: TxFailure; txHash?: Hex }

export const TX_IDLE: TxPhase = { step: 'idle' }

export function isTxRunning(phase: TxPhase): boolean {
  return phase.step !== 'idle' && phase.step !== 'success' && phase.step !== 'failed'
}

type StepView = { step: TxStep; label: string; detail?: React.ReactNode }

function stepIndex(steps: StepView[], phase: TxPhase): number {
  if (phase.step === 'idle') return -1
  if (phase.step === 'success') return steps.length
  const at = phase.step === 'failed' ? phase.at : phase.step
  return steps.findIndex((entry) => entry.step === at)
}

/**
 * The transaction as a short checklist: done steps ticked, the current one spinning, a failed
 * one crossed out. The current step is announced to screen readers.
 */
export function TxProgress({
  steps,
  phase,
  txUrl,
  className,
}: {
  steps: StepView[]
  phase: TxPhase
  /** Explorer link for a sent transaction. */
  txUrl?: (hash: Hex) => string
  className?: string
}) {
  const current = stepIndex(steps, phase)
  const failed = phase.step === 'failed'
  const txHash = phase.step === 'idle' ? undefined : phase.txHash
  // A failure is announced by its Alert (role="alert"), so the live region stays quiet then.
  const live =
    phase.step === 'failed'
      ? ''
      : phase.step === 'success'
        ? 'Transaction confirmed.'
        : (steps[current]?.label ?? '')

  return (
    <div className={cn('space-y-3', className)}>
      <ol className="space-y-1">
        {steps.map((entry, index) => {
          const state =
            index < current ? 'done' : index === current ? (failed ? 'failed' : 'current') : 'pending'
          return (
            <li
              key={entry.step}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex items-start gap-3 py-1.5"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-px flex size-5 shrink-0 items-center justify-center rounded-full',
                  state === 'done' && 'bg-success-soft text-success-foreground',
                  state === 'current' && 'text-primary',
                  state === 'failed' && 'bg-destructive-soft text-destructive-foreground',
                  state === 'pending' && 'ring-border-strong ring-1 ring-inset',
                )}
              >
                {state === 'done' && <CheckIcon className="size-3" strokeWidth={3} />}
                {state === 'current' && <Spinner className="size-4" />}
                {state === 'failed' && <XIcon className="size-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block text-sm',
                    state === 'pending' ? 'text-muted-foreground' : 'text-foreground',
                    state === 'current' && 'font-medium',
                  )}
                >
                  {entry.label}
                </span>
                {state === 'current' && entry.detail && (
                  <span className="text-muted-foreground mt-0.5 block text-[0.8125rem] leading-snug">
                    {entry.detail}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>

      {txHash && txUrl && (
        <a
          href={txUrl(txHash)}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[0.8125rem] underline-offset-4 hover:underline"
        >
          Transaction <span className="numeric">{`${txHash.slice(0, 10)}…${txHash.slice(-6)}`}</span>
          <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}

      {phase.step === 'failed' && (
        <Alert variant="destructive">
          <XIcon aria-hidden="true" />
          <AlertTitle>{phase.failure.title}</AlertTitle>
          <AlertDescription>{phase.failure.message}</AlertDescription>
        </Alert>
      )}

      <p aria-live="polite" className="sr-only">
        {live}
      </p>
    </div>
  )
}
