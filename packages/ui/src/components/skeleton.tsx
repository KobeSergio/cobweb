import { cn } from '@cobweb/ui/lib/utils'

/**
 * A placeholder in the shape of what is loading. A soft light sweeps across it; with reduced
 * motion it holds still. Match the radius of the thing it stands in for.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'relative isolate overflow-hidden rounded-md bg-surface-2',
        'after:animate-shimmer after:absolute after:inset-0 after:bg-linear-to-r after:from-transparent after:via-highlight after:to-transparent',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
