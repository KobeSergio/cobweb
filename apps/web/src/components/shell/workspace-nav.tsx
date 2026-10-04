'use client'

import { ArrowRightIcon, HistoryIcon } from 'lucide-react'
import Link from 'next/link'
import { useSelectedLayoutSegments } from 'next/navigation'
import { ManageNav } from '@/components/shell/manage-nav'
import { StageNav } from '@/components/shell/step-nav'
import { isDeployed, manageTabHref, type CollectionStatus, type ProjectType } from '@/lib/steps'

type Props = {
  collectionId: string
  status: CollectionStatus
  projectType: ProjectType
  /** Sample-data mode: every route is open. */
  demo: boolean
  artDeferred?: boolean
}

/**
 * What sits under the collection's top bar. Before deploy: the stepper of the four build stages
 * (and, in sample mode, the Manage tabs when a Manage route is opened ahead of deploy). Once
 * deployed there is no stepper: Manage routes show their tabs, and the build stages, reached from
 * the top bar's Setup menu, show a read-only notice instead.
 */
export function WorkspaceNav({ collectionId, status, projectType, demo, artDeferred }: Props) {
  const [segment] = useSelectedLayoutSegments()
  const onManage = segment === 'manage'

  if (isDeployed(status)) {
    return onManage ? <ManageNav collectionId={collectionId} /> : <SetupNotice collectionId={collectionId} />
  }
  return (
    <>
      <StageNav
        collectionId={collectionId}
        status={status}
        projectType={projectType}
        demo={demo}
        artDeferred={artDeferred}
      />
      {onManage && demo && <ManageNav collectionId={collectionId} />}
    </>
  )
}

/** Above a build stage of a deployed collection: it is history, not a step to take. */
function SetupNotice({ collectionId }: { collectionId: string }) {
  return (
    <div
      role="note"
      className="bg-card/40 text-muted-foreground flex h-11 items-center justify-between gap-4 border-b px-6 text-sm"
    >
      <p className="flex min-w-0 items-center gap-2">
        <HistoryIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">This collection is deployed. Setup is shown for reference.</span>
      </p>
      <Link
        href={manageTabHref(collectionId, 'overview')}
        className="text-foreground focus-visible:ring-ring/50 flex shrink-0 items-center gap-1.5 rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
      >
        Manage drop
        <ArrowRightIcon aria-hidden="true" className="size-4" />
      </Link>
    </div>
  )
}
