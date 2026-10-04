'use client'

import { CheckIcon, ExternalLinkIcon, WalletIcon, XIcon } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cobweb/ui/components/dialog'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainName } from '@/components/chains/chain-icon'
import { explorerTxUrl, formatNative, shortAddress, type Hex, type SupportedChain } from '@/lib/demo'
import type { TxRequest } from './simulate'
import { TX_STEPS, useTransaction, type TxState, type TxStep } from './use-transaction'

export type TransactionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  /** Fields or a summary, shown until the transaction starts. */
  children?: React.ReactNode
  /** The call to send; null while the form above is incomplete or invalid. */
  request: TxRequest | null
  /** The button that starts the sequence, e.g. "Open phase". */
  actionLabel: string
  /** Red action button, for irreversible or risky calls. */
  destructive?: boolean
  chain: SupportedChain
  /** Shown in the toast and the done state, e.g. "Owl List is open". */
  successMessage: string
  onConfirmed?: (hash: Hex) => void
  onFailed?: (message: string, step: TxStep) => void
  className?: string
}

/**
 * The one dialog for every on-chain action in Manage drop. It shows what will be sent, then
 * walks the honest sequence: checking, confirm in wallet, confirming, done, with a clear failure
 * at whichever step failed and a way to try again.
 */
export function TransactionDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  request,
  actionLabel,
  destructive,
  chain,
  successMessage,
  onConfirmed,
  onFailed,
  className,
}: TransactionDialogProps) {
  const tx = useTransaction({
    onConfirmed: (hash) => {
      onConfirmed?.(hash)
      toast.success(successMessage)
    },
    onFailed,
  })
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const { state } = tx

  function handleOpenChange(next: boolean) {
    clearTimeout(resetTimer.current)
    // A transaction in flight keeps going if the dialog closes; the toast reports the result.
    if (!next && !tx.busy) resetTimer.current = setTimeout(tx.reset, 200)
    onOpenChange(next)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (request && state.phase === 'idle') tx.start(request)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn('sm:max-w-lg', className)}>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          {state.phase === 'idle' ? (
            <>
              {children}
              {request && <CallReview request={request} chain={chain} />}
            </>
          ) : (
            <TxProgress state={state} chain={chain} onRespond={tx.respond} successMessage={successMessage} />
          )}

          <DialogFooter>
            {state.phase === 'idle' && (
              <>
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={!request}>
                  {actionLabel}
                </Button>
              </>
            )}
            {tx.busy && (
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {state.phase === 'confirming' ? 'Close and keep waiting' : 'Close'}
              </Button>
            )}
            {state.phase === 'failed' && (
              <>
                <Button type="button" variant="outline" onClick={tx.reset}>
                  {state.step === 'checking' ? 'Back to edit' : 'Back'}
                </Button>
                <Button
                  type="button"
                  variant={destructive ? 'destructive' : 'default'}
                  disabled={!request}
                  onClick={() => request && tx.start(request)}
                >
                  Try again
                </Button>
              </>
            )}
            {state.phase === 'done' && (
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The call as it will be sent: contract, function, arguments, value. */
export function CallReview({ request, chain }: { request: TxRequest; chain: SupportedChain }) {
  return (
    <div className="bg-well shadow-inset rounded-lg border px-4 py-3">
      <p className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-1 text-xs font-medium">
        Sends to the {request.contract.toLowerCase()} on
        <ChainName chain={chain} className="text-foreground" iconClassName="size-3.5" />
      </p>
      <p className="numeric text-sm break-all">{request.functionName}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.8125rem]">
        {request.args.map((arg) => (
          <div key={arg.name} className="contents">
            <dt className="text-muted-foreground">{arg.name}</dt>
            <dd className="numeric min-w-0 text-right break-all">{arg.value}</dd>
          </div>
        ))}
        {request.valueWei && (
          <div className="contents">
            <dt className="text-muted-foreground">Value</dt>
            <dd className="numeric text-right">{formatNative(request.valueWei, chain.nativeSymbol)}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

const ORDER: TxStep[] = ['checking', 'wallet', 'confirming']

function stepStatus(state: TxState, step: TxStep): 'todo' | 'active' | 'done' | 'failed' {
  if (state.phase === 'done') return 'done'
  if (state.phase === 'idle') return 'todo'
  const current = state.phase === 'failed' ? state.step : state.phase
  const diff = ORDER.indexOf(step) - ORDER.indexOf(current)
  if (diff < 0) return 'done'
  if (diff > 0) return 'todo'
  return state.phase === 'failed' ? 'failed' : 'active'
}

/** The three steps with their state, the simulated wallet, and the result. */
export function TxProgress({
  state,
  chain,
  onRespond,
  successMessage,
}: {
  state: TxState
  chain: SupportedChain
  onRespond: (answer: 'approve' | 'reject' | 'approve-revert') => void
  successMessage: string
}) {
  const hash = 'hash' in state ? state.hash : undefined
  return (
    <div className="grid gap-4">
      <ol className="grid gap-0" aria-label="Transaction progress">
        {TX_STEPS.map(({ step, label, detail }, index) => {
          const status = stepStatus(state, step)
          return (
            <li key={step} className="relative flex gap-3 pb-4 last:pb-0">
              {index < TX_STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute top-7 bottom-1 left-3 w-px',
                    status === 'done' ? 'bg-primary-line' : 'bg-border',
                  )}
                />
              )}
              <StepIcon status={status} />
              <div className="min-w-0 pt-0.5">
                <p
                  className={cn('text-sm font-medium', status === 'todo' && 'text-muted-foreground')}
                  aria-current={status === 'active' ? 'step' : undefined}
                >
                  {label}
                  <span className="sr-only">
                    {status === 'done' ? ', done' : status === 'failed' ? ', failed' : ''}
                  </span>
                </p>
                {status === 'active' && <p className="text-muted-foreground text-[0.8125rem]">{detail}</p>}
              </div>
            </li>
          )
        })}
      </ol>

      <div aria-live="polite" className="grid gap-3">
        {state.phase === 'wallet' && <SimulatedWallet onRespond={onRespond} />}
        {state.phase === 'failed' && (
          <p role="alert" className="bg-destructive-soft rounded-lg px-4 py-3 text-sm">
            {state.message}
          </p>
        )}
        {state.phase === 'done' && (
          <p className="bg-success-soft flex items-center gap-2 rounded-lg px-4 py-3 text-sm">
            <CheckIcon aria-hidden="true" className="text-success-foreground size-4 shrink-0" />
            {successMessage}
          </p>
        )}
        {hash && (
          <a
            href={explorerTxUrl(chain, hash)}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex w-fit items-center gap-1.5 rounded-sm text-[0.8125rem] underline-offset-4 outline-none hover:underline focus-visible:ring-2"
          >
            Transaction <span className="numeric">{shortAddress(hash, 6)}</span>
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens the block explorer)</span>
          </a>
        )}
      </div>
    </div>
  )
}

function StepIcon({ status }: { status: 'todo' | 'active' | 'done' | 'failed' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border',
        status === 'todo' && 'border-border-strong bg-card',
        status === 'active' && 'border-primary-line bg-primary-soft text-primary',
        status === 'done' && 'border-transparent bg-primary text-primary-foreground',
        status === 'failed' && 'bg-destructive-soft text-destructive-foreground border-transparent',
      )}
    >
      {status === 'active' && <Spinner className="size-3.5" />}
      {status === 'done' && <CheckIcon className="size-3.5" strokeWidth={3} />}
      {status === 'failed' && <XIcon className="size-3.5" strokeWidth={3} />}
    </span>
  )
}

/**
 * Stands in for the wallet's own confirmation window while transactions are simulated.
 * SEAM: removed when `writeContract` is wired; the real wallet prompt replaces it.
 */
function SimulatedWallet({
  onRespond,
}: {
  onRespond: (answer: 'approve' | 'reject' | 'approve-revert') => void
}) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <WalletIcon aria-hidden="true" className="text-muted-foreground size-4" />
        Simulated wallet
      </p>
      <p className="text-muted-foreground mt-1 text-[0.8125rem]">
        Your wallet would open here. Choose how it answers.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" autoFocus onClick={() => onRespond('approve')}>
          Approve
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onRespond('reject')}>
          Reject
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onRespond('approve-revert')}>
          Approve, then revert
        </Button>
      </div>
    </div>
  )
}
