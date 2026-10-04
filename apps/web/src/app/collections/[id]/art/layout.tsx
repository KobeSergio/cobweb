import { ArtLiveNotice } from '@/components/shell/art-live-notice'
import { ArtRail } from '@/components/shell/art-rail'
import { requireOwnedCollection } from '@/lib/auth'
import { sampleArtDeferred } from '@/lib/demo'
import { artSubSteps, isDemoMode, isDeployed } from '@/lib/steps'

type Props = { children: React.ReactNode; params: Promise<{ id: string }> }

/**
 * The Art stage: its sub-steps as a rail on the left (a segmented control above the screen below
 * 1024px), the Art screens to its right. A project type with a single Art screen has no rail.
 * Once deployed, Art is open only while the art is deferred; a one-line notice above it says the
 * drop is live and the art is revealed from Settings.
 */
export default async function ArtLayout({ children, params }: Props) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const demo = isDemoMode()
  const artDeferred = demo ? sampleArtDeferred(undefined) : false
  const notice = (
    <ArtLiveNotice
      collectionId={collection.id}
      deployed={isDeployed(collection.status)}
      demo={demo}
      artDeferred={artDeferred}
    />
  )

  if (artSubSteps(collection.project_type).length < 2) {
    return (
      <>
        {notice}
        {children}
      </>
    )
  }
  return (
    <>
      {notice}
      <div className="flex flex-1 flex-col lg:flex-row">
        <ArtRail
          collectionId={collection.id}
          status={collection.status}
          projectType={collection.project_type}
          demo={demo}
          artDeferred={artDeferred}
        />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </>
  )
}
