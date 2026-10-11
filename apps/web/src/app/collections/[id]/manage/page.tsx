import { OverviewScreen } from '@/components/manage/overview-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import {
  DEMO_ACTIVITY,
  DEMO_COLLECTION,
  DEMO_DEFERRED_RENDER_JOBS,
  DEMO_DEPLOYMENT,
  getChain,
  sampleSupply,
  scaleSampleToSupply,
} from '@/lib/demo'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../_lib/stage'

/**
 * Manage drop, overview. Sample data until the contract reads and writes are wired. In sample mode
 * `?art=deferred` shows the deferred-art scenario, whose real set is not rendered yet.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: CollectionParams
  searchParams: SearchParams
}) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'manage', 'manage', { art: await searchParam(searchParams, 'art') })
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const chain = getChain(DEMO_DEPLOYMENT.chainId)!
  // Seam: the groups and the minted total come from the freshness server once Phase 6 lands.
  const sample = scaleSampleToSupply(sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply))

  return (
    <StagePage
      title="Overview"
      description="How the drop is doing: supply minted, the contract, the mint page, live phases and proceeds."
      width="wide"
    >
      <OverviewScreen
        // Manage drop is the deployed collection's home; sample mode opens it before deploy, so the
        // mint page link reads as a deployed one there too (no reservation wording).
        collection={{ ...collection, status: 'deployed' }}
        deployment={DEMO_DEPLOYMENT}
        chain={chain}
        groups={sample.groups}
        activity={DEMO_ACTIVITY}
        totalMinted={sample.totalMinted}
        slug={collection.slug}
        // Seam: the real set is rendered when the collection's finished render job has its metadata CID.
        realArtRendered={!ctx.artDeferred || DEMO_DEFERRED_RENDER_JOBS.done.placeholderImageCid === null}
      />
    </StagePage>
  )
}
