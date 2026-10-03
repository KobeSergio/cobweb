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
  icon,
  className,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive.Item>, 'children' | 'title'> & {
  title: React.ReactNode
  description?: React.ReactNode
  /** An optional lucide icon, shown before the title. */
  icon?: React.ReactNode
}) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="choice-card"
      className={cn(
        'group relative flex cursor-pointer items-start gap-3.5 rounded-xl border border-border-strong bg-surface-2/40 p-4 text-left',
        'transition-[border-color,background-color,box-shadow] duration-150 ease-out outline-none',
        'hover:border-input hover:bg-surface-2',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft data-[state=checked]:shadow-raised',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {/* The radio mark: an empty ring that fills when chosen. */}
      <span
        aria-hidden="true"
        className="absolute top-4 right-4 flex size-[1.125rem] items-center justify-center rounded-full border border-input bg-well transition-colors group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary"
      >
        <span className="size-1.5 scale-0 rounded-full bg-primary-foreground transition-transform duration-200 ease-out-expo group-data-[state=checked]:scale-100" />
      </span>
      {icon && (
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-3 text-muted-foreground shadow-raised transition-colors group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground [&_svg:not([class*='size-'])]:size-[1.125rem]"
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 pr-7">
        <span className="block text-sm font-semibold">{title}</span>
        {description && (
          <span className="mt-1 block text-[0.8125rem] leading-snug text-muted-foreground group-data-[state=checked]:text-foreground/80">
            {description}
          </span>
        )}
      </span>
    </RadioGroupPrimitive.Item>
  )
}

export { ChoiceCards, ChoiceCard }
