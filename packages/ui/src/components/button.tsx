import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@cobweb/ui/lib/utils'
import { Slot } from 'radix-ui'

/*
 * Buttons. One primary per view: it is the only yellow control on screen. Everything else is
 * secondary (raised graphite), outline, ghost or destructive. Every variant has a pressed state
 * (it settles 1px) and the same focus ring.
 */
const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap select-none',
    'transition-[background-color,color,box-shadow,transform,border-color] duration-150 ease-out',
    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
    'aria-invalid:ring-2 aria-invalid:ring-destructive/60',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          'bg-primary font-semibold text-primary-foreground shadow-button hover:bg-primary-hover active:bg-primary-pressed active:shadow-none',
        secondary:
          'bg-surface-2 text-foreground shadow-raised hover:bg-surface-3 active:bg-surface-3 active:shadow-inset',
        outline:
          'border border-border-strong bg-transparent text-foreground hover:border-input hover:bg-surface-2 active:bg-surface-3',
        ghost: 'text-muted-foreground hover:bg-surface-2 hover:text-foreground active:bg-surface-3',
        destructive:
          'bg-destructive font-semibold text-foreground shadow-raised hover:bg-destructive/90 active:bg-destructive/80 focus-visible:ring-destructive',
        link: 'h-auto! px-0! text-primary underline-offset-4 hover:underline active:translate-y-0',
      },
      size: {
        default: 'h-10 px-4 has-[>svg]:px-3.5',
        xs: "h-7 gap-1 rounded-sm px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: 'h-8 gap-1.5 px-3 text-[0.8125rem] has-[>svg]:px-2.5',
        lg: 'h-12 gap-2.5 px-6 text-[0.9375rem] has-[>svg]:px-5',
        icon: 'size-10',
        'icon-xs': "size-7 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': 'size-8',
        'icon-lg': 'size-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
