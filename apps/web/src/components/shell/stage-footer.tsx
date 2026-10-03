import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@cobweb/ui/components/button'
import type { FlowLink } from '@/lib/steps'

export type StageFooterProps = {
  /** The screen before this one. Usually from `flowNeighbours(...)`. Omit for none. */
  previous?: FlowLink
  /** The screen after this one. Rendered as "Continue to <name>". Omit for none. */
  next?: FlowLink
  /** Shows Continue as disabled, for example until the screen's work is saved. */
  nextDisabled?: boolean
  /** Why Continue is disabled, shown beside it. */
  nextHint?: React.ReactNode
  /** Overrides the Continue label. */
  nextLabel?: string
  /**
   * The screen's own primary action (Save, Lock art, Deploy). When given it takes the primary
   * style and Continue drops to secondary.
   */
  children?: React.ReactNode
  /** A secondary action beside Continue (ghost or outline). Unlike `children`, Continue stays primary. */
  extra?: React.ReactNode
}

/**
 * The bar at the bottom of every flow screen: Back on the left; the screen's own action and
 * Continue on the right. Sticks to the bottom of the viewport on long screens.
 */
export function StageFooter({
  previous,
  next,
  nextDisabled,
  nextHint,
  nextLabel,
  children,
  extra,
}: StageFooterProps) {
  const label = nextLabel ?? (next ? `Continue to ${next.name}` : undefined)
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
      <div className="flex flex-wrap items-center justify-end gap-3">
        {nextDisabled && nextHint && <p className="text-muted-foreground text-sm">{nextHint}</p>}
        {extra}
        {children}
        {next &&
          label &&
          (nextDisabled ? (
            <Button variant={children ? 'secondary' : 'default'} disabled>
              {label}
              <ArrowRightIcon />
            </Button>
          ) : (
            <Button asChild variant={children ? 'secondary' : 'default'}>
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
