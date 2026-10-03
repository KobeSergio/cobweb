import * as React from 'react'
import { cn } from '@cobweb/ui/lib/utils'

/**
 * Field surface shared by Input, Textarea, SelectTrigger and InputGroup: a recessed well with a
 * control-strength edge. The edge turns yellow and a soft ring appears on focus.
 */
const fieldSurface = cn(
  'rounded-md border border-input bg-well text-foreground shadow-inset',
  'transition-[border-color,box-shadow,background-color] duration-150 ease-out',
  'hover:border-muted-foreground/70',
  'placeholder:text-muted-foreground',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

const fieldFocus = 'outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20'

const fieldInvalid =
  'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:hover:border-destructive'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldSurface,
        fieldFocus,
        fieldInvalid,
        'h-10 w-full min-w-0 px-3.5 text-sm',
        'file:mr-3 file:inline-flex file:h-7 file:rounded-sm file:border-0 file:bg-surface-3 file:px-2.5 file:text-xs file:font-medium file:text-foreground',
        type === 'number' && 'numeric',
        className,
      )}
      {...props}
    />
  )
}

export { Input, fieldSurface, fieldFocus, fieldInvalid }
