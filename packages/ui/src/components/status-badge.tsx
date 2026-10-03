import * as React from 'react'
import { CheckIcon } from 'lucide-react'
import { cn } from '@cobweb/ui/lib/utils'

/**
 * The lifecycle states a collection, phase or job can be in. Each has one look across the app.
 *
 * draft      not started or not published. Neutral.
 * scheduled  set to start at a known time. Outlined.
 * live       happening now. The accent, with a pulse. Only when the chain says it is live.
 * closed     ended before selling out. Neutral, dimmed.
 * soldout    every token minted. Success.
 * done       a task or step that is finished. Success, with a tick.
 * error      failed and needs attention. Destructive.
 * pending    working in the background (rendering, confirming). Warning.
 */
type Status = 'draft' | 'scheduled' | 'live' | 'closed' | 'soldout' | 'done' | 'error' | 'pending'

const LABEL: Record<Status, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  closed: 'Closed',
  soldout: 'Sold out',
  done: 'Done',
  error: 'Failed',
  pending: 'In progress',
}

const CHIP: Record<Status, string> = {
  draft: 'border-border-strong bg-surface-2 text-muted-foreground',
  scheduled: 'border-border-strong bg-transparent text-foreground',
  live: 'border-primary-line bg-primary-soft text-primary',
  closed: 'border-border bg-transparent text-muted-foreground',
  soldout: 'border-transparent bg-success-soft text-success-foreground',
  done: 'border-transparent bg-success-soft text-success-foreground',
  error: 'border-transparent bg-destructive-soft text-destructive-foreground',
  pending: 'border-transparent bg-warning-soft text-warning-foreground',
}

const DOT: Record<Status, string> = {
  draft: 'bg-faint',
  scheduled: 'border border-foreground bg-transparent',
  live: 'bg-primary',
  closed: 'bg-faint rounded-[1px]',
  soldout: 'bg-success',
  done: '',
  error: 'bg-destructive',
  pending: 'bg-warning',
}

function StatusBadge({
  status,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & {
  status: Status
  /** Overrides the default label, for example "Ready to deploy" for a draft. */
  children?: React.ReactNode
}) {
  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        'inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap',
        CHIP[status],
        className,
      )}
      {...props}
    >
      {status === 'done' ? (
        <CheckIcon aria-hidden="true" className="size-3" strokeWidth={3} />
      ) : (
        <span aria-hidden="true" className="relative flex size-1.5 shrink-0">
          {status === 'live' && (
            <span className="animate-live-pulse absolute inset-0 rounded-full bg-primary" />
          )}
          <span className={cn('relative size-1.5 rounded-full', DOT[status])} />
        </span>
      )}
      {children ?? LABEL[status]}
    </span>
  )
}

export { StatusBadge, type Status }
