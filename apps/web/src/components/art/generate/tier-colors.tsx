import { TIER_RANGES, type RarityTier } from '@cobweb/dna'
import { cn } from '@cobweb/ui/lib/utils'

/**
 * Tier looks, from the status tokens only and in falling strength. The legacy tiers had their own
 * five hues; Cobweb has no tier tokens yet, so these borrow warning, success and the neutrals.
 *
 * Shared by Generate's rank badge (rarity.tsx) and the mint page's success view. This module imports nothing
 * of Generate's: the public page takes the maps, the dot and the title, not Generate's state.
 */
export const TIER_CHIP: Record<RarityTier['key'], string> = {
  legendary: 'border-warning/60 text-warning-foreground',
  epic: 'border-success/50 text-success-foreground',
  rare: 'border-border-strong text-foreground',
  uncommon: 'border-border text-muted-foreground',
  common: 'border-transparent text-muted-foreground',
}

export const TIER_DOT: Record<RarityTier['key'], string> = {
  legendary: 'bg-warning',
  epic: 'bg-success',
  rare: 'bg-foreground',
  uncommon: 'bg-muted-foreground',
  common: 'bg-faint',
}

export function TierDot({ tier, className }: { tier: RarityTier['key']; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', TIER_DOT[tier], className)} />
  )
}

/** A tier chip's title: the tier and the share of the set it covers, as `Legendary: top 5% by rarity`. */
export function tierTitle(tier: RarityTier): string {
  return `${tier.label}: ${TIER_RANGES[tier.key].toLowerCase()} by rarity`
}
