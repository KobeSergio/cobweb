'use client'

import * as React from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'

import { cn } from '@cobweb/ui/lib/utils'

/**
 * A radio group whose options are cards. One tab stop; arrow keys move between options. Give it a
 * `name` and it submits with a form like any radio group.
 */
function ChoiceCards({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root data-slot="choice-cards" className={cn('grid gap-3', className)} {...props} />
  )
}

function ChoiceCard({
  title,
  description,
  className,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive.Item>, 'children' | 'title'> & {
  title: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="choice-card"
      className={cn(
        'group border-input hover:border-foreground/60 focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="block text-sm font-medium">{title}</span>
      {description && (
        <span className="text-muted-foreground group-data-[state=checked]:text-foreground/85 mt-1 block text-xs leading-snug">
          {description}
        </span>
      )}
    </RadioGroupPrimitive.Item>
  )
}

export { ChoiceCards, ChoiceCard }
