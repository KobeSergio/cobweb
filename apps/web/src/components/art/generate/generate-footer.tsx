import { ArrowLeftIcon, ArrowRightIcon, LockIcon } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@cobweb/ui/components/button'
import type { FlowLink } from '@/lib/steps'

/**
 * The Generate step's footer. Same frame as `StageFooter`, plus a standing line about locking,
 * which `StageFooter` only shows while Continue is disabled.
 */
export function GenerateFooter({
  previous,
  next,
  blockedReason,
  locked,
  extra,
  lockNote,
}: {
  previous?: FlowLink
  next?: FlowLink
  /** Why the set cannot go on to locking yet, or null. */
  blockedReason: string | null
  /** The art is already locked. */
  locked?: boolean
  /** A secondary action beside Continue, such as "Finish the art later". */
  extra?: React.ReactNode
  /** Replaces the standing line about locking. */
  lockNote?: string
}) {
  const label = next ? `Continue to ${next.name}` : undefined
  return (
    <footer className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-10 -mx-6 mt-auto flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4 backdrop-blur">
      {previous ? (
        <Button asChild variant="ghost">
          <Link href={previous.href}>
            <ArrowLeftIcon />
            {previous.name}
          </Link>
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {locked
            ? 'The art is locked. This is the set that is rendered.'
            : (blockedReason ??
              lockNote ??
              'Locking freezes the art. Layers, rules and tokens cannot be edited after it.')}
        </p>
        {extra}
        {next &&
          label &&
          (blockedReason ? (
            <Button disabled>
              {label}
              <ArrowRightIcon />
            </Button>
          ) : (
            <Button asChild>
              <Link href={next.href}>
                {label}
                <ArrowRightIcon />
              </Link>
            </Button>
          ))}
      </div>
    </footer>
  )
}
