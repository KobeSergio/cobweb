import { cn } from '@cobweb/ui/lib/utils'

/** A titled group of settings on one card. `id` makes it a link target (`#advanced`). */
export function SettingsGroup({
  title,
  id,
  children,
}: {
  title: string
  id?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-label={title} className="grid scroll-mt-6 gap-3">
      <h2 className="text-muted-foreground text-sm font-medium">{title}</h2>
      <div className="bg-card shadow-raised divide-y rounded-xl border">{children}</div>
    </section>
  )
}

/** One setting: what it is on the left, its state and one action on the right. */
export function Setting({
  title,
  description,
  danger,
  children,
}: {
  title: string
  description: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'grid gap-4 p-5 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:gap-10 lg:p-6',
        danger && 'bg-destructive-soft/30 rounded-xl',
      )}
    >
      <div className="space-y-1">
        <h3 className={cn('text-heading', danger && 'text-destructive-foreground')}>{title}</h3>
        <p className="text-muted-foreground text-[0.8125rem] leading-relaxed">{description}</p>
      </div>
      <div className="min-w-0 self-center">{children}</div>
    </div>
  )
}
