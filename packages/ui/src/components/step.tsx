import * as React from 'react'
import { CheckIcon } from 'lucide-react'

import { cn } from '@cobweb/ui/lib/utils'

/**
 * done     finished, and not the step being viewed
 * current  the step being viewed
 * next     the step to work on now, when it is not the one being viewed
 * pending  not reached yet
 */
type StepState = 'done' | 'current' | 'next' | 'pending'

const DOT: Record<StepState, string> = {
  done: 'bg-primary-soft text-primary',
  current: 'bg-primary text-primary-foreground',
  next: 'border-primary border',
  pending: 'border-muted-foreground/70 border',
}

const LABEL: Record<StepState, string> = {
  done: 'text-foreground',
  current: 'text-primary font-semibold',
  next: 'text-foreground',
  pending: 'text-muted-foreground',
}

/**
 * One step of a linear flow: a status dot and a label. Wrap it in a link or button to make it
 * navigable; on its own it is presentational.
 */
function Step({
  state,
  completed = state === 'done',
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & {
  state: StepState
  /** Whether the step is finished. Lets the step being viewed still show its tick. */
  completed?: boolean
}) {
  return (
    <span
      data-slot="step"
      data-state={state}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg p-2 text-sm leading-tight font-medium',
        LABEL[state],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', DOT[state])}
      >
        {completed ? (
          <CheckIcon className="size-4" />
        ) : (
          state === 'current' && <span className="bg-primary-foreground size-2 rounded-full" />
        )}
      </span>
      {children}
    </span>
  )
}

/** A short rule between two steps. */
function StepSeparator({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('bg-border-strong h-px w-4 shrink-0', className)} />
}

export { Step, StepSeparator, type StepState }
