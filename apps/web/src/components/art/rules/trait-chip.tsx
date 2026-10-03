import { cn } from '@cobweb/ui/lib/utils'
import type { TraitEntry } from '../lib/trait-index'
import { Composite } from '../composite'

/** A trait as it reads inside a sentence: a small thumbnail and its name. */
export function TraitChip({
  entry,
  fallback,
  className,
}: {
  entry?: TraitEntry
  fallback?: string
  className?: string
}) {
  const name = entry?.trait.name ?? fallback ?? 'Removed trait'
  return (
    <span
      className={cn(
        'bg-surface-2 inline-flex h-8 max-w-full items-center gap-2 rounded-md border py-0.5 pr-2.5 pl-0.5 align-middle',
        className,
      )}
    >
      <Composite
        urls={entry?.trait.imageUrl ? [entry.trait.imageUrl] : []}
        alt=""
        seed={entry?.trait.id ?? name}
        className="size-7 shrink-0 rounded-sm"
      />
      <span className="truncate text-sm font-medium">{name}</span>
    </span>
  )
}
