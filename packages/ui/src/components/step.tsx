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
  done: 'bg-primary-soft text-primary ring-1 ring-primary-line ring-inset',
  current: 'bg-primary text-primary-foreground shadow-button',
  next: 'ring-1 ring-primary ring-inset text-primary',
  pending: 'ring-1 ring-border-strong ring-inset text-muted-foreground',
}

const LABEL: Record<StepState, string> = {
  done: 'text-foreground',
  current: 'text-foreground font-semibold',
  next: 'text-foreground',
  pending: 'text-muted-foreground',
}

/**
 * One step of a linear flow: a status dot and a label. Wrap it in a link or button to make it
 * navigable; on its own it is presentational. Pass `index` to number the dot of a step that is
 * not finished.
 */
function Step({
  state,
  completed = state === 'done',
  index,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & {
  state: StepState
  /** Whether the step is finished. Lets the step being viewed still show its tick. */
  completed?: boolean
  /** One-based position, shown in the dot when the step is not finished. */
  index?: number
}) {
  return (
    <span
      data-slot="step"
      data-state={state}
      className={cn(
        'inline-flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm leading-tight font-medium transition-colors',
        LABEL[state],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'numeric flex size-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold transition-[background-color,box-shadow,color] duration-200',
          DOT[state],
        )}
      >
        {completed ? (
          <CheckIcon className="size-3.5" strokeWidth={3} />
        ) : index !== undefined ? (
          index
        ) : (
          state === 'current' && <span className="size-2 rounded-full bg-primary-foreground" />
        )}
      </span>
      {children}
    </span>
  )
}

/** A short rule between two steps. Pass `done` when the step before it is finished. */
function StepSeparator({ className, done = false }: { className?: string; done?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('h-px w-5 shrink-0 rounded-full', done ? 'bg-primary-line' : 'bg-border-strong', className)}
    />
  )
}

export { Step, StepSeparator, type StepState }
