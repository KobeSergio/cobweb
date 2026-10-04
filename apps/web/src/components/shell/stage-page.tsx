import { cn } from '@cobweb/ui/lib/utils'

export type StagePageProps = {
  /** Small line above the title, e.g. "Art · Step 2 of 3". */
  eyebrow?: string
  title: string
  description?: React.ReactNode
  /** Controls on the right of the header (filters, a secondary action). */
  actions?: React.ReactNode
  /** `wide` for editors and tables, `narrow` for forms. */
  width?: 'narrow' | 'default' | 'wide'
  /** Usually a `StageFooter`. */
  footer?: React.ReactNode
  /** The body renders its own `StageFooter` (for example inside a form), so no bottom padding is added. */
  bodyHasFooter?: boolean
  children: React.ReactNode
}

const WIDTH = { narrow: 'max-w-3xl', default: 'max-w-5xl', wide: 'max-w-7xl' }

/** The frame of every screen in the collection workspace: header, body, footer. */
export function StagePage({
  eyebrow,
  title,
  description,
  actions,
  width = 'default',
  footer,
  bodyHasFooter,
  children,
}: StagePageProps) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-1 flex-col gap-8 px-6 pt-8',
        WIDTH[width],
        !footer && !bodyHasFooter && 'pb-10',
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          {eyebrow && <p className="text-muted-foreground text-sm font-medium">{eyebrow}</p>}
          <h2 className="text-2xl font-semibold">{title}</h2>
          {description && (
            <p className="text-muted-foreground max-w-2xl text-base text-pretty">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
      {footer}
    </div>
  )
}
