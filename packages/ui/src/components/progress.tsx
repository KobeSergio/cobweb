'use client'

import * as React from 'react'
import { cn } from '@cobweb/ui/lib/utils'
import { Progress as ProgressPrimitive } from 'radix-ui'

/**
 * Progress is always the accent: minted of supply, rendered of total. The track is a recessed
 * well; the bar moves with a transform so it stays smooth.
 */
function Progress({
  className,
  value,
  size = 'default',
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { size?: 'sm' | 'default' | 'lg' }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-size={size}
      value={value}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-well shadow-inset',
        'data-[size=sm]:h-1 data-[size=default]:h-2 data-[size=lg]:h-3',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 rounded-full bg-primary transition-transform duration-500 ease-out-expo"
        style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, value || 0))}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
