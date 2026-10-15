'use client'

import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cobweb/ui/components/tooltip'
import { cn } from '@cobweb/ui/lib/utils'
import {
  explorerAddressUrl,
  explorerTxUrl,
  shortAddress,
  type Address,
  type Hex,
  type SupportedChain,
} from '@/lib/demo'
import { count } from './format'

/** Copies `value` and confirms with a tick for a moment. */
export function CopyButton({
  value,
  label,
  className,
  size = 'icon-xs',
}: {
  value: string
  /** What is copied, for screen readers: "Copy contract address". */
  label: string
  className?: string
  size?: 'icon-xs' | 'icon-sm'
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy. Select the text and copy it by hand.')
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={copy}
          className={className}
          aria-label={label}
        >
          {copied ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : label}</TooltipContent>
    </Tooltip>
  )
}

/** An address in mono, shortened, with copy and an explorer link. */
export function AddressLine({
  address,
  chain,
  full,
  className,
}: {
  address: Address
  chain: SupportedChain
  /** Show all 42 characters instead of `0x1234…abcd`. */
  full?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <span className={cn('numeric min-w-0 text-sm', full ? 'break-all' : 'truncate')} title={address}>
        {full ? address : shortAddress(address)}
      </span>
      <CopyButton value={address} label="Copy address" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" asChild>
            <a
              href={explorerAddressUrl(chain, address)}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in explorer"
            >
              <ExternalLinkIcon />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open in explorer</TooltipContent>
      </Tooltip>
    </span>
  )
}

/** Previous, "Page 2 of 17", next. For tables paged in the browser. */
export function Pager({
  page,
  pages,
  total,
  pageSize,
  onPage,
  noun,
}: {
  page: number
  pages: number
  total: number
  pageSize: number
  onPage: (page: number) => void
  noun: string
}) {
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <nav aria-label={`${noun} pages`} className="flex items-center justify-between gap-3 text-[0.8125rem]">
      <p className="text-muted-foreground" aria-live="polite">
        <span className="numeric text-foreground">
          {count(from)} to {count(to)}
        </span>{' '}
        of <span className="numeric text-foreground">{count(total)}</span> {noun}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPage(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
        >
          <ChevronLeftIcon />
        </Button>
        <span className="numeric text-muted-foreground px-1">
          {page + 1} / {Math.max(1, pages)}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages - 1}
          aria-label="Next page"
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  )
}

/** A transaction: a link to the chain's explorer, or the hash as text where it has none (Anvil). */
export function TxLink({ chain, hash, label }: { chain: SupportedChain; hash: Hex; label?: string }) {
  if (!chain.explorerUrl)
    return <span className="numeric text-muted-foreground text-[0.8125rem] break-all">{hash}</span>
  return (
    <a
      href={explorerTxUrl(chain, hash)}
      target="_blank"
      rel="noreferrer"
      className="numeric text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-[0.8125rem] outline-none focus-visible:ring-2"
    >
      {label && <span className="font-sans">{label}</span>}
      {shortAddress(hash, 6)}
      <ExternalLinkIcon aria-hidden="true" className="size-3" />
      <span className="sr-only">(opens the block explorer)</span>
    </a>
  )
}

/** A label and value on one line, value right-aligned in mono. For summaries and receipts. */
export function Row({
  label,
  children,
  strong,
  className,
}: {
  label: React.ReactNode
  children: React.ReactNode
  strong?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5 text-sm', className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('numeric text-right', strong && 'text-base font-medium')}>{children}</dd>
    </div>
  )
}
