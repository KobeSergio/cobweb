import { ArtRail } from '@/components/shell/art-rail'
import { requireOwnedCollection } from '@/lib/auth'
import { sampleArtDeferred } from '@/lib/demo'
import { artSubSteps, isDemoMode } from '@/lib/steps'

type Props = { children: React.ReactNode; params: Promise<{ id: string }> }

/**
 * The Art stage: its sub-steps as a rail on the left (a segmented control above the screen below
 * 1024px), the Art screens to its right. A project type with a single Art screen has no rail.
 */
export default async function ArtLayout({ children, params }: Props) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  if (artSubSteps(collection.project_type).length < 2) return children

  const demo = isDemoMode()
  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <ArtRail
        collectionId={collection.id}
        status={collection.status}
        projectType={collection.project_type}
        demo={demo}
        artDeferred={demo ? sampleArtDeferred(undefined) : false}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
