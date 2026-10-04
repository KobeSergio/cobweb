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
import { useMint } from './mint-context'
import { MintSuccess } from './mint-success'
import type { MintFailureKind } from './types'
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
  const { flow, closeFlow, data } = useMint()
  const mobile = useIsMobile()
  const open = flow.step !== 'idle'
  const locked = flow.step === 'wallet' || flow.step === 'confirming'
  const onOpenChange = (next: boolean) => {
    if (!next && !locked) closeFlow()
  }
  const { title, description } = heading(flow, data.collection.name)

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

function heading(flow: FlowState, name: string): { title: string; description: string } {
  if (flow.step === 'success') {
    const count = flow.tokenIds.length
    return {
      title: `Welcome to ${name}`,
      description: `${count === 1 ? 'Your new token is' : `Your ${count} new tokens are`} in your wallet.`,
    }
  }
  if (flow.step === 'error') return FAILURE[flow.kind]
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

const FAILURE: Record<MintFailureKind, { title: string; description: string }> = {
  rejected: {
    title: 'You cancelled in your wallet',
    description: 'Nothing was sent and nothing was charged. You can try again whenever you are ready.',
  },
  'phase-closed': {
    title: 'This phase is no longer open',
    description:
      'The check found the phase closed before your mint. Nothing was sent. The page now shows which phases are open.',
  },
  'quota-exceeded': {
    title: 'That is more than this wallet can mint',
    description:
      'The contract allows fewer tokens than you asked for, often because another mint from this wallet landed first. Nothing was sent.',
  },
  'insufficient-balance': {
    title: 'Not enough funds in this wallet',
    description: 'The wallet cannot cover the total plus gas. Nothing was sent.',
  },
  reverted: {
    title: 'The transaction failed on-chain',
    description:
      'The network rejected it, usually because the phase closed or sold out while it waited. No tokens were minted; only gas was spent.',
  },
}

function FlowBody() {
  const { flow, act, closeFlow, data, setQuantity } = useMint()
  const reduce = useReducedMotion()
  if (flow.step === 'idle') return null
  if (flow.step === 'success') return <MintSuccess />

  const { params } = flow
  const chain = data.collection.chain
  const total = formatNative(params.valueWei, chain.nativeSymbol)
  const group = data.groups.find((entry) => entry.id === params.groupId)
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
        {flow.step === 'error' && flow.kind === 'insufficient-balance' && (
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

      {flow.hash && (
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
            {flow.kind === 'phase-closed' ? (
              <Button className="sm:col-span-2" onClick={closeFlow}>
                See open phases
              </Button>
            ) : flow.kind === 'quota-exceeded' || flow.kind === 'insufficient-balance' ? (
              <>
                <Button
                  onClick={() => {
                    setQuantity(1)
                    closeFlow()
                  }}
                >
                  Mint fewer
                </Button>
                <Button variant="secondary" onClick={act}>
                  Try again
                </Button>
              </>
            ) : (
              <>
                <Button onClick={act}>Try again</Button>
                <Button variant="secondary" onClick={closeFlow}>
                  Close
                </Button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
