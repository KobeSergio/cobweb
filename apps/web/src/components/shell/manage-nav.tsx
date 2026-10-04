'use client'

import { PaintbrushIcon } from 'lucide-react'
import Link from 'next/link'
import { useSelectedLayoutSegments } from 'next/navigation'
import { Button } from '@cobweb/ui/components/button'
import { cn } from '@cobweb/ui/lib/utils'
import { MANAGE_TABS, manageTabHref, stageHref, type ProjectType } from '@/lib/steps'

type Props = {
  collectionId: string
  projectType: ProjectType
  /**
   * The art is deferred (launched on a placeholder, MASTER_PLAN, Flow: pre-reveal): the one way
   * back into Art after deploy is the "Finish the art" entry at the right end of the row.
   */
  artDeferred?: boolean
  /** Sample mode carries the deferred scenario in the URL; keep it on every link. */
  sampleDeferred?: boolean
}

/**
 * The tabs of Manage drop, directly under the top bar once the collection is deployed. Not a
 * sequence: the creator moves between them freely. The setup stages have no entry here; only
 * deferred art stays reachable, as a quiet chip on the right.
 */
export function ManageNav({ collectionId, projectType, artDeferred = false, sampleDeferred = false }: Props) {
  const segments = useSelectedLayoutSegments()
  // Under the collection layout the segments are ['manage'] for the overview, ['manage', '<tab>'] otherwise.
  const selected = segments[0] === 'manage' ? (segments[1] ?? '') : null
  const onArt = segments[0] === 'art'
  const withScenario = (href: string) => (sampleDeferred ? `${href}?art=deferred` : href)

  return (
    <nav aria-label="Manage drop" className="bg-card/40 flex h-11 items-center gap-4 border-b px-6">
      <div className="scrollbar-hide flex h-full min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        {MANAGE_TABS.map((tab) => {
          const current = tab.slug === selected
          return (
            <Link
              key={tab.key}
              href={withScenario(manageTabHref(collectionId, tab.key))}
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
      </div>
      {artDeferred && (
        <Button
          asChild
          variant="outline"
          size="xs"
          className={cn('shrink-0 rounded-full', onArt && 'bg-surface-2 text-foreground')}
        >
          <Link
            href={withScenario(stageHref(collectionId, 'art', projectType))}
            aria-current={onArt ? 'page' : undefined}
          >
            <PaintbrushIcon aria-hidden="true" />
            Finish the art
          </Link>
        </Button>
      )}
    </nav>
  )
}
