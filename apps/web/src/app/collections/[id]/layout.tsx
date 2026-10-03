import type { Metadata } from 'next'
import { SessionGuard } from '@/components/auth/session-guard'
import { CollectionTopbar } from '@/components/shell/collection-topbar'
import { SmallScreen } from '@/components/shell/small-screen'
import { StageNav } from '@/components/shell/step-nav'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { sampleArtDeferred } from '@/lib/demo'
import { isDemoMode } from '@/lib/steps'

type Props = { children: React.ReactNode; params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  return { title: collection.name }
}

/** Working on one collection: its top bar, the launch stages (with Art steps or Manage tabs), then the screen. */
export default async function CollectionLayout({ children, params }: Props) {
  const { id } = await params
  const user = await requireUser()
  const collection = await requireOwnedCollection(id)
  const demo = isDemoMode()

  return (
    <>
      <SessionGuard sessionAddress={user.walletAddress} />
      <SmallScreen />
      <div className="hidden min-h-svh flex-col sm:flex">
        <div className="bg-background sticky top-0 z-40">
          <CollectionTopbar
            name={collection.name}
            status={collection.status}
            walletAddress={user.walletAddress}
            demo={demo}
          />
          <StageNav
            collectionId={collection.id}
            status={collection.status}
            projectType={collection.project_type}
            demo={demo}
            artDeferred={demo ? sampleArtDeferred(undefined) : false}
          />
        </div>
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </>
  )
}
