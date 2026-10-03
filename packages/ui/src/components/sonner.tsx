'use client'

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/** Toasts are for transient confirmations. Errors that block a form belong inline, next to the field. */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success-foreground" />,
        info: <InfoIcon className="size-4 text-muted-foreground" />,
        warning: <TriangleAlertIcon className="size-4 text-warning-foreground" />,
        error: <OctagonXIcon className="size-4 text-destructive-foreground" />,
        loading: <Loader2Icon className="size-4 animate-spin text-primary" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'font-sans !gap-3 !rounded-lg !border-border-strong !bg-surface-2 !px-4 !py-3.5 !text-foreground !shadow-overlay',
          title: '!text-sm !font-medium',
          description: '!text-[0.8125rem] !text-muted-foreground',
          actionButton: '!rounded-sm !bg-primary !font-semibold !text-primary-foreground',
          cancelButton: '!rounded-sm !bg-surface-3 !text-foreground',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--surface-2)',
          '--normal-text': 'var(--foreground)',
          '--normal-border': 'var(--border-strong)',
          '--border-radius': '12px',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
