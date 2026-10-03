import { ArrowRightIcon } from 'lucide-react'
import Link from 'next/link'
import { Artwork } from '@cobweb/ui/components/artwork'
import { StatusBadge, type Status } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
import type { Tables } from '@/lib/database.types'
import { PROJECT_TYPES } from '@/lib/collections'
import { isDemoMode, isStepDone, nextStep, stageHref, STEPS, type CollectionStatus } from '@/lib/steps'

export const STATUS_LABELS: Record<CollectionStatus, string> = {
  draft: 'Draft',
  art_locked: 'Art locked',
  rendering: 'Rendering',
  rendered: 'Ready to deploy',
  deployed: 'Deployed',
}

/** How each collection status reads as a StatusBadge. Liveness of a mint is a chain read, not this. */
export const STATUS_BADGE: Record<CollectionStatus, Status> = {
  draft: 'draft',
  art_locked: 'pending',
  rendering: 'pending',
  rendered: 'scheduled',
  deployed: 'done',
}

/** In sample-data mode every collection shows the sample art, so give each card its own token. */
function demoCover(id: string) {
  let sum = 0
  for (const char of id) sum = (sum * 31 + char.charCodeAt(0)) % 9973
  return `/demo/tokens/${(sum % 24) + 1}.svg`
}

/**
 * A collection on the dashboard, led by its artwork. Without art yet, the frame is empty and lit,
 * with a cobweb drawn from the collection id. The whole card opens the stage to work on next.
 */
export function CollectionCard({
  collection,
  coverSrc,
}: {
  collection: Tables<'collections'>
  /** The collection's cover or first token preview, when it has one. */
  coverSrc?: string | null
}) {
  const next = nextStep(collection.status)
  const type = PROJECT_TYPES.find((entry) => entry.value === collection.project_type)
  const doneCount = STEPS.filter((step) => isStepDone(step.slug, collection.status)).length
  const cover = coverSrc ?? (isDemoMode() ? demoCover(collection.id) : null)

  return (
    <Link
      href={stageHref(collection.id, next.slug, collection.project_type)}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-raised outline-none',
        'transition-[transform,box-shadow,border-color] duration-300 ease-out-expo',
        'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lifted',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <Artwork
        src={cover}
        alt={`${collection.name} artwork`}
        seed={collection.id}
        label={cover ? undefined : 'No art yet'}
        className="aspect-[5/4] border-b"
        imageClassName="object-[center_30%] transition-transform duration-500 ease-out-expo group-hover:scale-[1.03]"
      >
        <StatusBadge
          status={STATUS_BADGE[collection.status]}
          className="absolute top-3 left-3 z-10 bg-background/75 backdrop-blur-sm"
        >
          {STATUS_LABELS[collection.status]}
        </StatusBadge>
      </Artwork>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="min-w-0 space-y-1.5">
          <h2 className="truncate text-heading">{collection.name}</h2>
          <p className="flex items-center gap-2 truncate text-[0.8125rem] text-muted-foreground">
            <span className="numeric text-foreground/85">{collection.symbol}</span>
            <span aria-hidden="true" className="size-0.5 rounded-full bg-faint" />
            <span>{type?.name}</span>
            <span aria-hidden="true" className="size-0.5 rounded-full bg-faint" />
            <span>
              <span className="numeric">{collection.max_supply.toLocaleString('en-US')}</span> tokens
            </span>
          </p>
        </div>

        <div className="mt-auto space-y-3">
          {/* Progress through the launch: one segment per stage. */}
          <div
            role="img"
            aria-label={`${doneCount} of ${STEPS.length} stages done`}
            className="flex gap-1"
          >
            {STEPS.map((step, index) => (
              <span
                key={step.slug}
                className={cn(
                  'h-1 flex-1 rounded-full',
                  index < doneCount ? 'bg-primary' : index === doneCount ? 'bg-primary-line' : 'bg-surface-3',
                )}
              />
            ))}
          </div>
          <p className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              Next <span className="font-medium text-foreground">{next.name}</span>
            </span>
            <ArrowRightIcon
              aria-hidden="true"
              className="size-4 text-faint transition-[transform,color] duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:text-primary"
            />
          </p>
        </div>
      </div>
    </Link>
  )
}
