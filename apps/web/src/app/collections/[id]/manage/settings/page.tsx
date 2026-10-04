import { SettingsScreen } from '@/components/manage/settings-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_ACTIVITY, DEMO_DEFERRED_RENDER_JOBS, DEMO_DEPLOYMENT, getChain } from '@/lib/demo'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../../_lib/stage'

/**
 * Manage drop, settings. Sample data until the contract reads and writes are wired. In sample mode
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

  return (
    <StagePage
      title="Settings"
      description="Withdraw proceeds, the payout address, royalties and reveal. Advanced holds tradability and mint on behalf."
      sampleNotice={ctx.sampleNotice}
      width="default"
    >
      <SettingsScreen
        collection={collection}
        deployment={DEMO_DEPLOYMENT}
        chain={chain}
        activity={DEMO_ACTIVITY}
        // Seam: the real set is rendered when the collection's finished render job has its metadata CID.
        realArtRendered={!ctx.artDeferred || DEMO_DEFERRED_RENDER_JOBS.done.metadataCid !== null}
      />
    </StagePage>
  )
}
