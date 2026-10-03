import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@cobweb/ui/lib/utils'
import { Slot } from 'radix-ui'

/*
 * Small labels. Always fully round. For a lifecycle status (draft, live, sold out...) use
 * StatusBadge instead, which adds the dot and the right colour for you.
 */
const badgeVariants = cva(
  [
    'inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 text-xs font-medium whitespace-nowrap',
    'transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    '[&>svg]:pointer-events-none [&>svg]:size-3',
  ],
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary-hover',
        secondary: 'border-transparent bg-surface-3 text-foreground [a&]:hover:bg-surface-3/80',
        outline: 'border-border-strong text-muted-foreground [a&]:hover:text-foreground',
        ghost: 'border-transparent text-muted-foreground [a&]:hover:bg-surface-2',
        accent: 'border-primary-line bg-primary-soft text-primary',
        success: 'border-transparent bg-success-soft text-success-foreground',
        warning: 'border-transparent bg-warning-soft text-warning-foreground',
        destructive: 'border-transparent bg-destructive-soft text-destructive-foreground',
        link: 'border-transparent text-primary underline-offset-4 [a&]:hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
