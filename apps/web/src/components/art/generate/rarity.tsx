import { cn } from '@cobweb/ui/lib/utils'
import { rarityTier, TIER_RANGES, type RarityTier } from '../state/token-logic'
import { TIER_CHIP, TierDot, tierTitle } from './tier-colors'

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
      title={tierTitle(tier)}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        onArt ? 'bg-background/80 backdrop-blur-sm' : 'bg-surface-2',
        TIER_CHIP[tier.key],
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
