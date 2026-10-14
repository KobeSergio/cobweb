import { getDeployment } from '@/app/actions/deploy'
import { getPhases } from '@/app/actions/phases'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { OverviewScreen } from '@/components/manage/overview-screen'
import { StagePage } from '@/components/shell/stage-page'
import { NOT_DEPLOYED } from '@/lib/art/result'
import { requireOwnedCollection } from '@/lib/auth'
import { chainView } from '@/lib/chain/chain-view'
import {
  DEMO_ACTIVITY,
  DEMO_COLLECTION,
  DEMO_DEFERRED_RENDER_JOBS,
  DEMO_DEPLOYMENT,
  DEMO_NOW,
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

const TITLE = 'Overview'
const DESCRIPTION =
  'How the drop is doing: supply minted, the contract, the mint page, live phases and proceeds.'

/**
 * Manage drop, overview (docs/specs/2026-10-15-phases.md, section 7.5). The header's chain, contract and
 * deploy time come from the deployment record; minted and the live phases from the server's read of the
 * chain. The pointer and Reveal, holders, the mint page bar's published state, proceeds and recent mints
 * keep their sample values until their sub-projects. In sample mode `?art=deferred` shows the deferred-art
 * scenario, whose real set is not rendered yet.
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
  // Seam: the real set is rendered when the collection's finished render job is not the placeholder's (no placeholder image CID).
  const realArtRendered = !ctx.artDeferred || DEMO_DEFERRED_RENDER_JOBS.done.placeholderImageCid === null

  if (ctx.demo) {
    const maxSupply = sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)
    const sample = scaleSampleToSupply(maxSupply)
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
        <OverviewScreen
          // Manage drop is the deployed collection's home; sample mode opens it before deploy, so the
          // mint page link reads as a deployed one there too (no reservation wording).
          collection={{ ...collection, status: 'deployed' }}
          deployment={DEMO_DEPLOYMENT}
          chain={getChain(DEMO_DEPLOYMENT.chainId)!}
          groups={sample.groups}
          activity={DEMO_ACTIVITY}
          totalMinted={sample.totalMinted}
          maxSupply={maxSupply}
          readAt={DEMO_NOW}
          chainReachable
          slug={collection.slug}
          realArtRendered={realArtRendered}
        />
      </StagePage>
    )
  }

  const [record, phases] = await Promise.all([getDeployment(collection.id), getPhases(collection.id)])
  if (!record.ok || !record.data || !phases.ok) {
    const message = !record.ok ? record.error : !phases.ok ? phases.error : NOT_DEPLOYED
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
        <ManageUnavailable title="The drop could not be read" message={message} />
      </StagePage>
    )
  }
  const view = phases.data
  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="wide">
      <OverviewScreen
        collection={collection}
        // Seam: the pointer (base URI, revealed), fees, royalty and payout stay sample until the settings sub-project.
        deployment={{
          ...DEMO_DEPLOYMENT,
          chainId: record.data.chainId,
          contractAddress: record.data.contractAddress,
          txHash: record.data.txHash,
          deployer: record.data.deployer,
          deployedAt: record.data.deployedAt,
        }}
        chain={chainView(view.chainId)}
        groups={view.groups}
        activity={DEMO_ACTIVITY}
        totalMinted={view.chainReachable ? view.totalMinted : null}
        maxSupply={view.maxSupply}
        readAt={view.readAt}
        chainReachable={view.chainReachable}
        slug={collection.slug}
        realArtRendered={realArtRendered}
      />
    </StagePage>
  )
}
