import * as React from 'react'
import { cn } from '@cobweb/ui/lib/utils'

/**
 * The top of a page's content: one title, an optional line of description, and the page's
 * actions on the right. The title is the page's h1. Put at most one primary button in `actions`.
 */
function PageHeader({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'header'>, 'title'> & {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header
      data-slot="page-header"
      className={cn('flex flex-wrap items-end justify-between gap-x-8 gap-y-4', className)}
      {...props}
    >
      <div className="min-w-0 max-w-2xl space-y-2">
        <h1 className="text-display">{title}</h1>
        {description && (
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
      {children}
    </header>
  )
}

export { PageHeader }
