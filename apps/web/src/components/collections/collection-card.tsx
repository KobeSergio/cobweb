import { ArrowRightIcon } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@cobweb/ui/components/badge'
import type { Tables } from '@/lib/database.types'
import { PROJECT_TYPES } from '@/lib/collections'
import { nextStep, type CollectionStatus } from '@/lib/steps'

export const STATUS_LABELS: Record<CollectionStatus, string> = {
  draft: 'Draft',
  art_locked: 'Art locked',
  rendering: 'Rendering',
  rendered: 'Ready to deploy',
  deployed: 'Deployed',
}

/** A collection on the dashboard. The whole card opens the step the creator should do next. */
export function CollectionCard({ collection }: { collection: Tables<'collections'> }) {
  const next = nextStep(collection.status)
  const type = PROJECT_TYPES.find((entry) => entry.value === collection.project_type)

  return (
    <Link
      href={`/collections/${collection.id}/${next.slug}`}
      className="group bg-card hover:border-border-strong focus-visible:ring-ring/50 flex gap-4 rounded-lg border p-5 transition-colors outline-none focus-visible:ring-[3px]"
    >
      {/* Stands in for the collection's artwork until there is some. */}
      <span
        aria-hidden="true"
        className="bg-primary-soft text-primary flex size-16 shrink-0 items-center justify-center rounded-md text-2xl font-semibold"
      >
        {collection.name.trim().charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{collection.name}</h2>
            <p className="text-muted-foreground mt-1 truncate text-sm">
              <span className="font-mono text-[0.8125rem]">{collection.symbol}</span> · {type?.name} ·{' '}
              {collection.max_supply.toLocaleString('en-US')} tokens
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {STATUS_LABELS[collection.status]}
          </Badge>
        </div>
        <p className="text-muted-foreground group-hover:text-primary flex items-center gap-1.5 text-sm font-medium transition-colors">
          Next: {next.name}
          <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
        </p>
      </div>
    </Link>
  )
}
