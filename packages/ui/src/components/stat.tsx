import * as React from 'react'
import { cn } from '@cobweb/ui/lib/utils'

/**
 * A labelled number: minted, supply, price, time left. The value is set in the mono face with
 * tabular figures, so a ticking countdown or a changing count does not jitter.
 *
 *   <Stat label="Minted" value="1,204" suffix="/ 5,000" />
 *   <Stat label="Price" value="0.025" suffix="ETH" size="lg" />
 */
function Stat({
  label,
  value,
  suffix,
  hint,
  size = 'default',
  accent = false,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  label: React.ReactNode
  value: React.ReactNode
  /** Unit or denominator, shown smaller and muted after the value. */
  suffix?: React.ReactNode
  /** One short line under the value. */
  hint?: React.ReactNode
  size?: 'sm' | 'default' | 'lg'
  /** Yellow value. Only for a live figure (time left in a live phase, minted while live). */
  accent?: boolean
}) {
  return (
    <div data-slot="stat" className={cn('flex min-w-0 flex-col gap-1.5', className)} {...props}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'numeric font-medium tracking-tight',
            size === 'sm' && 'text-base',
            size === 'default' && 'text-2xl',
            size === 'lg' && 'text-[2.5rem] leading-none',
            accent ? 'text-primary' : 'text-foreground',
          )}
        >
          {value}
        </span>
        {suffix && <span className="numeric text-sm text-muted-foreground">{suffix}</span>}
      </dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

/** A row of stats. Renders a <dl>, so Stat's <dt>/<dd> stay valid. */
function StatGroup({ className, ...props }: React.ComponentProps<'dl'>) {
  return <dl data-slot="stat-group" className={cn('flex flex-wrap gap-x-10 gap-y-5', className)} {...props} />
}

export { Stat, StatGroup }
