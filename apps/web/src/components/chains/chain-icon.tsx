import { cn } from '@cobweb/ui/lib/utils'

type MarkProps = React.SVGProps<SVGSVGElement>

/**
 * Simplified marks for the launch chains, drawn on a 24 px grid in `currentColor` so they take the
 * text colour around them (DESIGN.md: colours come from tokens). Recognisable, not pixel copies of
 * each brand's artwork.
 */
const MARKS: Record<number, (props: MarkProps) => React.ReactElement> = {
  // Ethereum: the two-part octahedron.
  1: (props) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2 5.5 12.4 12 16.2l6.5-3.8L12 2Z" />
      <path d="M12 17.5 5.5 13.7 12 22l6.5-8.3-6.5 3.8Z" opacity="0.6" />
    </svg>
  ),
  // Arbitrum: a hexagon with the two strokes of the A.
  42161: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M12 2.5 20.2 7.25v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5Z" strokeLinejoin="round" />
      <path d="M9.6 16.8 13 7.6M13.3 13.2l1.6 3.6" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  ),
  // Base: the disc with the flat cut from the left.
  8453: (props) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path fillRule="evenodd" d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2.3 10.9h11.4v2.2H2.3v-2.2Z" />
    </svg>
  ),
  // Berachain: a bear's head with two ears and two eyes.
  80094: (props) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="6" cy="6.5" r="3.2" />
      <circle cx="18" cy="6.5" r="3.2" />
      <path
        fillRule="evenodd"
        d="M12 21.5c4.7 0 8-3.1 8-7.4S16.7 6 12 6s-8 3.8-8 8.1 3.3 7.4 8 7.4ZM9 13.4a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm6 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm-3 4.6c1.2 0 2.2-.7 2.2-1.5S13.2 15 12 15s-2.2.7-2.2 1.5.9 1.5 2.2 1.5Z"
      />
    </svg>
  ),
  // Monad: a rounded diamond with a diamond-shaped hole.
  143: (props) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path
        fillRule="evenodd"
        d="M10.2 2.8a2.6 2.6 0 0 1 3.6 0l7.4 7.4a2.6 2.6 0 0 1 0 3.6l-7.4 7.4a2.6 2.6 0 0 1-3.6 0l-7.4-7.4a2.6 2.6 0 0 1 0-3.6l7.4-7.4ZM12 7.6 7.6 12l4.4 4.4 4.4-4.4L12 7.6Z"
      />
    </svg>
  ),
  // Robinhood Chain: the feather.
  4663: (props) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20 2.5c-7.4 1.5-12.2 6.6-13.6 14.2l2 .4C10.6 11.5 14.6 7.2 20 5.6V2.5Z" />
      <path d="M20 7.4c-3.5 1.5-6 4.6-7 8.6l-1 4.8-2.1-.4.6-2.7c.6-3 3.6-8.4 9.5-10.3Z" opacity="0.6" />
      <path d="M6.2 18.2 5 21.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
}

/** The chain's mark, 24 px by default. Decorative: the chain's name is always written beside it. */
export function ChainIcon({ chainId, className }: { chainId: number; className?: string }) {
  const Mark = MARKS[chainId]
  const classes = cn('size-6 shrink-0', className)
  if (!Mark) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={classes}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
      </svg>
    )
  }
  return <Mark className={classes} aria-hidden="true" />
}

/** A chain's icon and name on one line, for summaries and labels. */
export function ChainName({
  chain,
  className,
  iconClassName,
}: {
  chain: { id: number; name: string }
  className?: string
  iconClassName?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <ChainIcon chainId={chain.id} className={cn('size-4', iconClassName)} />
      {chain.name}
    </span>
  )
}
