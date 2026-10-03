'use client'

import { CheckIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cobweb/ui/components/tooltip'
import { cn } from '@cobweb/ui/lib/utils'

/**
 * A value that is data (an address, a hash, a CID) in mono, with a copy button and an optional
 * external link. `label` names it for the buttons' accessible names ("Copy contract address").
 */
export function CopyValue({
  value,
  label,
  display,
  href,
  linkLabel,
  wrap = false,
  className,
}: {
  value: string
  label: string
  /** Shorter text to show instead of the full value. The full value is still copied. */
  display?: string
  href?: string
  /** Names the link, e.g. "View on Basescan". */
  linkLabel?: string
  /** Break the full value across lines instead of truncating it. */
  wrap?: boolean
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  function copy() {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true)
        toast.success(`${label} copied.`)
      },
      () => toast.error(`Could not copy the ${label.toLowerCase()}. Select it and copy it by hand.`),
    )
  }

  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      <span
        title={display ? value : undefined}
        className={cn('numeric min-w-0 text-[0.8125rem]', wrap ? 'break-all' : 'truncate')}
      >
        {display ?? value}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
            {copied ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? 'Copied' : 'Copy'}</TooltipContent>
      </Tooltip>
      {href && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon-xs">
              <a href={href} target="_blank" rel="noreferrer" aria-label={`${linkLabel ?? 'Open'} (new tab)`}>
                <ExternalLinkIcon />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{linkLabel ?? 'Open'}</TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}

/** A label and value row for summaries and receipts. Use inside a `<dl>`. */
export function SummaryRow({
  label,
  children,
  className,
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-baseline justify-between gap-4 py-2.5', className)}>
      <dt className="text-muted-foreground shrink-0 text-[0.8125rem]">{label}</dt>
      <dd className="flex min-w-0 justify-end text-right text-sm">{children}</dd>
    </div>
  )
}
