import * as React from 'react'
import { cn } from '@cobweb/ui/lib/utils'
import { fieldFocus, fieldInvalid, fieldSurface } from '@cobweb/ui/components/input'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldSurface,
        fieldFocus,
        fieldInvalid,
        'flex field-sizing-content min-h-24 w-full px-3.5 py-2.5 text-sm leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
