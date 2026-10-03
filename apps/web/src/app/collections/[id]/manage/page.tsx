import { OverviewScreen } from '@/components/manage/overview-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_ACTIVITY, DEMO_DEPLOYMENT, DEMO_MINT_GROUPS, DEMO_TOTAL_MINTED, getChain } from '@/lib/demo'
import { LockedStagePage, stageContext, type CollectionParams } from '../_lib/stage'

/** Manage drop, overview. Sample data until the contract reads and writes are wired. */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'manage', 'manage')
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const chain = getChain(DEMO_DEPLOYMENT.chainId)!

  return (
    <StagePage
      title="Overview"
      description="How the drop is doing: supply minted, live phases, recent mints and proceeds."
      sampleNotice={ctx.sampleNotice}
      width="wide"
    >
      <OverviewScreen
        collection={collection}
        deployment={DEMO_DEPLOYMENT}
        chain={chain}
        groups={DEMO_MINT_GROUPS}
        activity={DEMO_ACTIVITY}
        totalMinted={DEMO_TOTAL_MINTED}
        mintPageHref={collection.slug ? `/${collection.slug}` : null}
      />
    </StagePage>
  )
}
