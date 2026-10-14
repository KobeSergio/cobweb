'use client'

import { CheckIcon, WalletIcon } from 'lucide-react'
import { useEffect, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Hex } from 'viem'
import { useAccount } from 'wagmi'
import { Button } from '@cobweb/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cobweb/ui/components/dialog'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainName } from '@/components/chains/chain-icon'
import { deployReducer, retryHash, type DeployEvent } from '@/components/deploy/deploy-machine'
import { classifyError } from '@/components/deploy/tx-errors'
import {
  isTxRunning,
  TX_IDLE,
  TxProgress,
  type StepView,
  type TxFailure,
} from '@/components/deploy/tx-progress'
import { explorerTxUrl, formatNative, type SupportedChain } from '@/lib/demo'
import type { ManageRequest, TxRequest } from './manage-actions'
import { useManageActions } from './manage-context'
import { runManage } from './manage-machine'

export type TransactionDialogProps<T> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  /** Fields or a summary, shown until the transaction starts. */
  children?: React.ReactNode
  /** The change to send; null while the form above is incomplete or invalid. */
  request: ManageRequest<T> | null
  /** The button that starts the sequence, e.g. "Open phase". */
  actionLabel: string
  /** Red action button, for irreversible or risky calls. */
  destructive?: boolean
  chain: SupportedChain
  /** Shown in the toast and the done state, e.g. "Owl List is open". */
  successMessage: string
  /**
   * The server's answer once the change is confirmed: the fresh view on Phases, the hash on a tab still on
   * sample data. Called even when the run ends after the dialog closed or unmounted.
   */
  onConfirmed?: (result: T) => void
  /**
   * The failure's sentence, when the sequence ends without a confirmed change. Called even when the run ends
   * after the dialog closed or unmounted, where only the parent can still tell the creator.
   */
  onFailed?: (message: string) => void
  className?: string
}

/**
 * The one dialog for every on-chain change in Manage drop (docs/specs/2026-10-15-phases.md, section 7.3).
 * It shows what will be sent, then runs the manage machine with the context's actions, the sign-in wallet
 * and the wallet's account and chain: switch when needed, check, confirm in the wallet, confirming, and
 * reading the contract, with the failure at whichever step failed and a way forward. The simulated wallet
 * shows only on sample actions.
 */
export function TransactionDialog<T>({
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
}: TransactionDialogProps<T>) {
  const { actions, chainId, wallet } = useManageActions()
  const account = useAccount()
  const sample = actions.answer !== undefined
  const [phase, dispatch] = useReducer(deployReducer, TX_IDLE)
  const [switching, setSwitching] = useState(false)
  const run = useRef(0)
  // False once the dialog has unmounted (another dialog opened in its place): a run still in flight then
  // updates no state here, but its end still reaches the parent's callbacks.
  const mounted = useRef(true)
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const running = isTxRunning(phase)
  // A change sent but not confirmed in time is checked again, never sent again.
  const sentHash = retryHash(phase)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function reset() {
    run.current++
    dispatch({ type: 'set', phase: TX_IDLE })
  }

  function handleOpenChange(next: boolean) {
    clearTimeout(resetTimer.current)
    // A transaction in flight keeps going if the dialog closes; the parent's callbacks and the toast still
    // report its end.
    if (!next && !running) resetTimer.current = setTimeout(reset, 200)
    onOpenChange(next)
  }

  async function start(checkHash?: Hex) {
    if (!request) return
    const current = request
    // The parent's callbacks as they were when the run started: they answer its end even after the dialog
    // closed or unmounted, so a late success still applies and a late failure still reaches the creator.
    const confirmed = onConfirmed
    const failed = onFailed
    const id = ++run.current
    // Each run starts from idle: a refusal before any step is its first event, and must not keep the last
    // run's step or transaction.
    dispatch({ type: 'set', phase: TX_IDLE })
    const last: { failure: TxFailure | null } = { failure: null }
    const report = (event: DeployEvent) => {
      // A run superseded within this dialog (Try again, Back) reports nothing more.
      if (id !== run.current) return
      if (event.type === 'failed') last.failure = event.failure
      // An unmounted dialog has no state to update; its parent still hears the end below.
      if (mounted.current) dispatch(event)
    }
    setSwitching(!sample && !checkHash && account.chainId !== chainId)
    const call = current.call
    let result: T | null = null
    try {
      result = await runManage<T>(
        {
          call,
          // Sample actions stand in for the wallet: the sign-in wallet on the collection's chain.
          account: sample ? wallet : account.address,
          wallet,
          chainId,
          connectedChainId: sample ? chainId : account.chainId,
          sentHash: checkHash,
          addId: call?.functionName === 'registerMintGroup' ? Number(call.args[0]) : undefined,
        },
        {
          switchChain: (target) => actions.switchChain(target),
          simulate: (next) => {
            if (next) return actions.simulate(next)
            if (actions.review) return actions.review(current.review)
            return Promise.reject(new Error('This change runs on sample data only.'))
          },
          wait: (hash) => actions.wait(hash),
          confirm: (hash) => current.confirm(hash),
          remember: current.pending ? (hash) => current.pending?.remember(hash) : undefined,
          forget: current.pending ? () => current.pending?.forget() : undefined,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        },
        report,
      )
    } catch (error) {
      // The machine words every failure it expects; one it did not must not leave the dialog on a spinner.
      report({ type: 'failed', failure: classifyError(error, 'confirming', 'manage') })
    }
    if (id !== run.current) return
    if (result !== null) {
      confirmed?.(result)
      toast.success(successMessage)
      return
    }
    if (last.failure) failed?.(last.failure.message)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (request && phase.step === 'idle') void start()
  }

  const steps: StepView[] = [
    ...(switching
      ? [
          {
            step: 'switching' as const,
            label: `Switch to ${chain.name}`,
            detail: 'Approve the network switch in your wallet.',
          },
        ]
      : []),
    {
      step: 'simulating',
      label: 'Checking the change',
      detail: 'A dry run against the contract, so the wallet only opens for a change that will go through.',
    },
    {
      step: 'wallet',
      label: 'Confirm in your wallet',
      detail: sample
        ? 'Answer for your wallet below.'
        : 'Your wallet shows a call to the collection contract and the gas for it.',
    },
    {
      step: 'confirming',
      label: `Confirming on ${chain.name}`,
      detail: 'Sent. Waiting for the transaction to be included in a block.',
    },
    {
      step: 'verifying',
      label: 'Reading the contract',
      detail:
        'Cobweb checks the receipt and reads the contract again, so the screen shows what the chain holds.',
    },
  ]
  const failedAt = phase.step === 'failed' ? phase.at : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn('sm:max-w-lg', className)}>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          {phase.step === 'idle' ? (
            <>
              {children}
              {request && <CallReview request={request.review} chain={chain} />}
            </>
          ) : (
            <div className="grid gap-3">
              <TxProgress
                phase={phase}
                steps={steps}
                txUrl={chain.explorerUrl ? (hash) => explorerTxUrl(chain, hash) : undefined}
              />
              {sample && phase.step === 'wallet' && (
                <SimulatedWallet onRespond={(choice) => actions.answer?.(choice)} />
              )}
              {phase.step === 'success' && (
                <p className="bg-success-soft flex items-center gap-2 rounded-lg px-4 py-3 text-sm">
                  <CheckIcon aria-hidden="true" className="text-success-foreground size-4 shrink-0" />
                  {successMessage}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {phase.step === 'idle' && (
              <>
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={!request}>
                  {actionLabel}
                </Button>
              </>
            )}
            {running && (
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {phase.step === 'confirming' || phase.step === 'verifying'
                  ? 'Close and keep waiting'
                  : 'Close'}
              </Button>
            )}
            {phase.step === 'failed' && (
              <>
                <Button type="button" variant="outline" onClick={reset}>
                  {failedAt === 'simulating' ? 'Back to edit' : 'Back'}
                </Button>
                <Button
                  type="button"
                  variant={destructive ? 'destructive' : 'default'}
                  disabled={!request}
                  onClick={() => void start(sentHash)}
                >
                  {sentHash ? 'Check again' : 'Try again'}
                </Button>
              </>
            )}
            {phase.step === 'success' && (
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

/** Stands in for the wallet's own confirmation window on sample actions. */
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
