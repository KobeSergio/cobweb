'use client'

import { CheckIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { transition } from '@cobweb/ui/lib/motion'
import { cn } from '@cobweb/ui/lib/utils'

export type ProgressionState = 'done' | 'current' | 'pending'

/**
 * One state of a vertical progression. The current one is expanded into a card; finished ones
 * collapse to a one-line receipt; later ones show only their title. A rail joins the dots.
 */
export function ProgressionItem({
  index,
  title,
  state,
  receipt,
  status,
  last = false,
  children,
}: {
  index: number
  title: string
  state: ProgressionState
  /** The one-line summary shown once the state is done. */
  receipt?: React.ReactNode
  /** A badge beside the title of the current state. */
  status?: React.ReactNode
  last?: boolean
  /** The body of the current state. */
  children?: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const headingId = `progression-${index}`

  return (
    <li
      aria-labelledby={headingId}
      aria-current={state === 'current' ? 'step' : undefined}
      className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 sm:gap-x-5"
    >
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={cn(
            'numeric flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
            'transition-[background-color,box-shadow,color] duration-300 ease-out-expo',
            state === 'done' && 'bg-primary-soft text-primary ring-primary-line ring-1 ring-inset',
            state === 'current' && 'bg-primary text-primary-foreground shadow-button',
            state === 'pending' && 'text-muted-foreground ring-border-strong ring-1 ring-inset',
          )}
        >
          {state === 'done' ? <CheckIcon className="size-4" strokeWidth={3} /> : index}
        </span>
        {!last && (
          <span
            aria-hidden="true"
            className={cn(
              'my-2 w-px flex-1 rounded-full',
              state === 'done' ? 'bg-primary-line' : 'bg-border',
            )}
          />
        )}
      </div>

      <div className={cn('min-w-0', last ? 'pb-2' : state === 'current' ? 'pb-10' : 'pb-7')}>
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h3
            id={headingId}
            className={cn('text-heading', state === 'pending' && 'text-muted-foreground font-medium')}
          >
            {title}
            <span className="sr-only">
              {state === 'done' ? ', done' : state === 'current' ? ', current step' : ', not started'}
            </span>
          </h3>
          {state === 'current' && status}
        </div>
        {state === 'done' && receipt && (
          <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem]">
            {receipt}
          </p>
        )}
        {state === 'current' && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition.slow}
            className="bg-card shadow-raised mt-4 rounded-xl border"
          >
            {children}
          </motion.div>
        )}
      </div>
    </li>
  )
}

/** A dot between parts of a receipt line. */
export function Dot() {
  return <span aria-hidden="true" className="bg-faint size-0.5 rounded-full" />
}
