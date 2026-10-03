'use client'

import Link from 'next/link'
import { useSelectedLayoutSegments } from 'next/navigation'
import { cn } from '@cobweb/ui/lib/utils'
import { MANAGE_TABS, manageTabHref } from '@/lib/steps'

/**
 * The tabs of Manage drop. Not a sequence: after deploy the creator moves between them freely.
 * Rendered by `StageNav` as its second row while a Manage route is open.
 */
export function ManageNav({ collectionId }: { collectionId: string }) {
  const segments = useSelectedLayoutSegments()
  // Under the collection layout the segments are ['manage'] for the overview, ['manage', '<tab>'] otherwise.
  const selected = segments[0] === 'manage' ? (segments[1] ?? '') : null

  return (
    <nav
      aria-label="Manage drop"
      className="bg-card/40 flex h-11 items-end gap-1 overflow-x-auto border-t px-6"
    >
      {MANAGE_TABS.map((tab) => {
        const current = tab.slug === selected
        return (
          <Link
            key={tab.key}
            href={manageTabHref(collectionId, tab.key)}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-11 shrink-0 items-center border-b-2 border-transparent px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-inset',
              current && 'text-foreground border-primary',
            )}
          >
            {tab.name}
          </Link>
        )
      })}
    </nav>
  )
}
