import * as React from 'react'
import { cn } from '@cobweb/ui/lib/utils'

/**
 * A section of a page: surface-1, 16px corners, the inner top light. Give it a title to get a
 * header row with an optional action on the right. Content padding is yours to set; the default
 * body has 24px. For a thing the creator acts on (a collection, a phase), use Card instead.
 */
function Panel({
  title,
  description,
  action,
  className,
  bodyClassName,
  children,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  bodyClassName?: string
}) {
  return (
    <section
      data-slot="panel"
      className={cn('rounded-xl border bg-card text-card-foreground shadow-raised', className)}
      {...props}
    >
      {title && (
        <header className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-heading">{title}</h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn('p-6', bodyClassName)}>{children}</div>
    </section>
  )
}

export { Panel }
