'use client'

import { CheckIcon, ExternalLinkIcon, XIcon } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Button } from '@cobweb/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@cobweb/ui/components/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@cobweb/ui/components/drawer'
import { Spinner } from '@cobweb/ui/components/spinner'
import { useIsMobile } from '@cobweb/ui/hooks/use-mobile'
import { transition } from '@cobweb/ui/lib/motion'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainName } from '@/components/chains/chain-icon'
import { explorerTxUrl, formatNative, shortAddress } from '@/lib/demo/helpers'
import { failureActions, failureCopy, type FailureAction } from '@/lib/mint/mint-failure'
import { useMint } from './mint-context'
import { MintSuccess } from './mint-success'
import type { FlowState, FlowStep } from './use-mint-flow'

const STEPS: { step: FlowStep; title: string }[] = [
  { step: 'checking', title: 'Check the mint' },
  { step: 'wallet', title: 'Confirm in your wallet' },
  { step: 'confirming', title: 'Confirm on-chain' },
]

/**
 * The mint, from the check to the result. A dialog on larger screens, a bottom sheet on phones.
 * It cannot be dismissed while the wallet is open or the transaction is in flight, so the visitor
 * always sees how it ended.
 */
export function MintFlowDialog() {
  const { flow, closeFlow, page } = useMint()
  const mobile = useIsMobile()
  const open = flow.step !== 'idle'
  const locked = flow.step === 'wallet' || flow.step === 'confirming'
  const onOpenChange = (next: boolean) => {
    if (!next && !locked) closeFlow()
  }
  const { title, description } = heading(flow, page.name, page.chain.name)

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} dismissible={!locked}>
        <DrawerContent className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-md overflow-y-auto pt-4">
            <DrawerTitle className="text-title">{title}</DrawerTitle>
            <DrawerDescription className="mt-1.5 text-sm leading-relaxed">{description}</DrawerDescription>
            <FlowBody />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={!locked}
        onEscapeKeyDown={(event) => locked && event.preventDefault()}
        onInteractOutside={(event) => locked && event.preventDefault()}
        className={cn('gap-0 sm:max-w-md', flow.step === 'success' && 'sm:max-w-xl')}
      >
        <DialogTitle className="text-title pr-8">{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm leading-relaxed">{description}</DialogDescription>
        <FlowBody />
      </DialogContent>
    </Dialog>
  )
}

function heading(flow: FlowState, name: string, chainName: string): { title: string; description: string } {
  if (flow.step === 'success') {
    const count = flow.tokenIds.length
    return {
      title: `Welcome to ${name}`,
      description: `${count === 1 ? 'Your new token is' : `Your ${count} new tokens are`} in your wallet.`,
    }
  }
  if (flow.step === 'error') {
    const copy = failureCopy(flow.failure, chainName)
    return { title: copy.title, description: copy.sentence }
  }
  if (flow.step === 'wallet')
    return {
      title: 'Confirm in your wallet',
      description: 'Your wallet is open with the checked transaction.',
    }
  if (flow.step === 'confirming')
    return { title: 'Minting', description: 'Sent. The network is including your transaction.' }
  return {
    title: 'Checking your mint',
    description: 'Nothing is sent yet. The mint is checked against the contract first.',
  }
}

/** The label of a way forward; null for one this flow cannot offer. */
function actionLabel(action: FailureAction, hasExplorer: boolean): string | null {
  switch (action.kind) {
    case 'retry':
      return 'Try again'
    case 'close':
      return 'Close'
    case 'see-phases':
      return 'See open phases'
    case 'mint-count':
      return `Mint ${action.count}`
    case 'mint-fewer':
      return 'Mint fewer'
    case 'use-wallet':
      return 'Use this wallet'
    case 'view-transaction':
      return hasExplorer ? 'View transaction' : null
  }
}

function FlowBody() {
  const { flow, act, closeFlow, page, live, setQuantity, setVault } = useMint()
  const reduce = useReducedMotion()
  if (flow.step === 'idle') return null
  if (flow.step === 'success') return <MintSuccess />

  const { params } = flow
  const chain = page.chain
  const total = formatNative(params.valueWei, chain.nativeSymbol)
  const group = live?.groups.find((entry) => entry.id === params.groupId)
  const actions =
    flow.step === 'error'
      ? failureActions(flow.failure).flatMap((action) => {
          const label = actionLabel(action, !!chain.explorerUrl && !!flow.hash)
          return label ? [{ action, label }] : []
        })
      : []
  const run = (action: FailureAction) => {
    if (action.kind === 'retry') return act()
    if (action.kind === 'mint-count' || action.kind === 'mint-fewer') setQuantity(action.count)
    if (action.kind === 'use-wallet') setVault(null)
    if (action.kind === 'view-transaction' && flow.hash) {
      window.open(explorerTxUrl(chain, flow.hash), '_blank', 'noreferrer')
      return
    }
    closeFlow()
  }
  const current = flow.step === 'error' ? flow.failedAt : flow.step
  const currentIndex = STEPS.findIndex((entry) => entry.step === current)

  return (
    <div className="mt-6">
      <div className="rounded-lg bg-surface-2 px-4 py-3.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span>
            <span className="numeric">{params.amount}</span> {params.amount === 1 ? 'token' : 'tokens'} from{' '}
            {group?.name}
          </span>
          <span className="numeric font-medium">{total}</span>
        </div>
        {params.vault && (
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            Using the allowance of vault <span className="numeric">{shortAddress(params.vault)}</span>
          </p>
        )}
        {flow.step === 'error' && flow.failure.kind === 'insufficient-balance' && (
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            Add {chain.nativeSymbol} on <ChainName chain={chain} iconClassName="size-3.5" /> to{' '}
            <span className="numeric">{shortAddress(params.account)}</span>, or mint fewer.
          </p>
        )}
      </div>

      <ol className="mt-5 space-y-3" aria-live="polite">
        {STEPS.map((entry, index) => {
          const failed = flow.step === 'error' && index === currentIndex
          const done = index < currentIndex
          const active = index === currentIndex && !failed
          return (
            <li key={entry.step} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs',
                  done && 'border-transparent bg-success-soft text-success-foreground',
                  active && 'border-primary-line bg-primary-soft text-primary',
                  failed && 'border-transparent bg-destructive-soft text-destructive-foreground',
                  !done && !active && !failed && 'border-border-strong text-muted-foreground',
                )}
              >
                {done ? (
                  <CheckIcon className="size-3.5" strokeWidth={3} />
                ) : failed ? (
                  <XIcon className="size-3.5" strokeWidth={3} />
                ) : active ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <span className="numeric">{index + 1}</span>
                )}
              </span>
              <span className={cn('text-sm', !done && !active && !failed && 'text-muted-foreground')}>
                {entry.title}
                <span className="sr-only">
                  {done ? ', done' : active ? ', in progress' : failed ? ', failed' : ''}
                </span>
              </span>
            </li>
          )
        })}
      </ol>

      {flow.hash && chain.explorerUrl && (
        <a
          href={explorerTxUrl(chain, flow.hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          View transaction <span className="numeric">{shortAddress(flow.hash, 6)}</span>
          <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
        </a>
      )}

      <AnimatePresence initial={false}>
        {flow.step === 'error' && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition.base}
            className="mt-6 grid gap-2.5 sm:grid-cols-2"
          >
            {actions.map(({ action, label }, index) => (
              <Button
                key={action.kind}
                variant={index === 0 ? 'default' : 'secondary'}
                className={actions.length === 1 ? 'sm:col-span-2' : undefined}
                onClick={() => run(action)}
              >
                {label}
              </Button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
