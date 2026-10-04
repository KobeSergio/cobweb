'use client'

import { useSearchParams, useSelectedLayoutSegments } from 'next/navigation'
import { ManageNav } from '@/components/shell/manage-nav'
import { StageNav } from '@/components/shell/step-nav'
import { isDeployed, type CollectionStatus, type ProjectType } from '@/lib/steps'

type Props = {
  collectionId: string
  status: CollectionStatus
  projectType: ProjectType
  /** Sample-data mode: every route is open, and `?art=deferred` picks the deferred-art scenario. */
  demo: boolean
  artDeferred?: boolean
}

/**
 * What sits under the collection's top bar, depending on the stage. Before deploy: the stepper of
 * the four build stages and nothing about Manage drop. After deploy the setup is done: no stepper,
 * the Manage tabs instead, with a quiet "Finish the art" entry while the art is deferred. A Manage
 * route opened by URL before deploy (sample mode) renders as if deployed: tabs, no stepper.
 */
export function WorkspaceNav({ collectionId, status, projectType, demo, artDeferred = false }: Props) {
  const [segment] = useSelectedLayoutSegments()
  const searchParams = useSearchParams()
  const sampleDeferred = demo && searchParams.get('art') === 'deferred'

  if (isDeployed(status) || segment === 'manage') {
    return (
      <ManageNav
        collectionId={collectionId}
        projectType={projectType}
        artDeferred={artDeferred || sampleDeferred}
        sampleDeferred={sampleDeferred}
      />
    )
  }
  return (
    <StageNav
      collectionId={collectionId}
      status={status}
      projectType={projectType}
      demo={demo}
      artDeferred={artDeferred}
    />
  )
}
