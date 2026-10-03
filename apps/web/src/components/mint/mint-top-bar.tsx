import { TriangleAlertIcon } from 'lucide-react'
import type { MintPageData } from '@/lib/demo'
import { WalletButton } from './wallet-button'

/** The slim bar: the collection's identity on the left, the wallet on the right. No app chrome. */
export function MintTopBar({ data }: { data: MintPageData }) {
  const { collection } = data
  return (
    <header className="relative z-10 mx-auto flex h-16 max-w-[90rem] items-center justify-between gap-4 px-4 sm:h-[4.5rem] sm:px-8">
      <a
        href="#mint"
        className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src={collection.avatarUrl}
          alt=""
          className="size-9 shrink-0 rounded-full border border-border-strong bg-well object-cover"
        />
        <span className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em]">{collection.name}</span>
        <span className="numeric hidden text-xs text-muted-foreground sm:inline">{collection.symbol}</span>
      </a>
      <WalletButton />
    </header>
  )
}

/**
 * Shown when the freshness server could not read the chain recently. What the page shows may be a
 * little old; the mint itself is still checked against the chain before the wallet opens.
 */
export function DegradedBanner({ minutes }: { minutes?: number }) {
  return (
    <div role="status" className="mx-auto max-w-[90rem] px-4 sm:px-8">
      <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
        <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <p className="text-[0.8125rem] leading-snug">
          <span className="font-medium text-warning-foreground">Live status may be out of date.</span>{' '}
          <span className="text-foreground/85">
            We have not reached the chain{minutes ? ` for ${minutes} minutes` : ' for a little while'}, so
            counts and phase status can lag. Every mint is still checked against the chain before your wallet
            opens.
          </span>
        </p>
      </div>
    </div>
  )
}
