import { cn } from '@cobweb/ui/lib/utils'
import { rarityTier, TIER_RANGES, type RarityTier } from '../state/token-logic'

/**
 * Tier looks, from the status tokens only and in falling strength. The legacy tiers had their own
 * five hues; Cobweb has no tier tokens yet, so these borrow warning, success and the neutrals.
 */
const CHIP: Record<RarityTier['key'], string> = {
  legendary: 'border-warning/60 text-warning-foreground',
  epic: 'border-success/50 text-success-foreground',
  rare: 'border-border-strong text-foreground',
  uncommon: 'border-border text-muted-foreground',
  common: 'border-transparent text-muted-foreground',
}

const DOT: Record<RarityTier['key'], string> = {
  legendary: 'bg-warning',
  epic: 'bg-success',
  rare: 'bg-foreground',
  uncommon: 'bg-muted-foreground',
  common: 'bg-faint',
}

export function TierDot({ tier, className }: { tier: RarityTier['key']; className?: string }) {
  return <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT[tier], className)} />
}

/** Rank and tier as a chip. `onArt` adds a backing so it reads over artwork. */
export function RankBadge({
  rank,
  total,
  onArt,
  className,
}: {
  rank: number
  total: number
  onArt?: boolean
  className?: string
}) {
  const tier = rarityTier(rank, total)
  return (
    <span
      title={`${tier.label}: ${TIER_RANGES[tier.key].toLowerCase()} by rarity`}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        onArt ? 'bg-background/80 backdrop-blur-sm' : 'bg-surface-2',
        CHIP[tier.key],
        className,
      )}
    >
      <TierDot tier={tier.key} />
      <span className="sr-only">{tier.label}, rank </span>
      <span className="numeric">#{rank.toLocaleString('en-US')}</span>
    </span>
  )
}

export function TierLegend() {
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Rarity tiers">
      {(Object.keys(TIER_RANGES) as RarityTier['key'][]).map((key) => (
        <li key={key} className="flex items-center gap-1.5">
          <TierDot tier={key} />
          <span className="text-foreground capitalize">{key}</span> {TIER_RANGES[key].toLowerCase()}
        </li>
      ))}
    </ul>
  )
}
