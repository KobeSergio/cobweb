import { getAddress } from 'viem'
import { getDeployment } from '@/app/actions/deploy'
import { getMintPageSettings } from '@/app/actions/mint-page'
import { getPhases } from '@/app/actions/phases'
import { getSettings } from '@/app/actions/settings'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { OverviewScreen } from '@/components/manage/overview-screen'
import { SAMPLE } from '@/components/manage/manage-sim'
import { sampleSettingsView } from '@/components/manage/settings-sim'
import { StagePage } from '@/components/shell/stage-page'
import { NOT_DEPLOYED } from '@/lib/art/result'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { chainView } from '@/lib/chain/chain-view'
import {
  DEMO_ACTIVITY,
  DEMO_COLLECTION,
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
 * Manage drop, overview (docs/specs/2026-10-15-airdrop-settings.md, section 7.5). The header's chain, contract and
 * deploy time come from the deployment record; minted and the live phases from the server's read of the chain;
 * what the base URI points at, Reveal and proceeds from the settings read; the avatar and the mint page bar's public
 * switch from the mint page's row (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9). Holders and recent
 * mints keep their sample values until the indexer, and "Paid by minters" shows in sample mode only.
 * In sample mode `?art=deferred` shows the deferred-art scenario, whose real set is not rendered yet, and
 * `?art=revealed` a collection already revealed.
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
  const user = await requireUser()
  const art = await searchParam(searchParams, 'art')
  const ctx = stageContext(collection, 'manage', 'manage', { art })
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const wallet = getAddress(user.walletAddress)

  if (ctx.demo) {
    const maxSupply = sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)
    const sample = scaleSampleToSupply(maxSupply)
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
        <OverviewScreen
          // Manage drop is the deployed collection's home; sample mode opens it before deploy, so the
          // mint page link reads as a deployed one there too (no reservation wording).
          collection={{ ...collection, status: 'deployed' }}
          contract={DEMO_DEPLOYMENT.contractAddress}
          deployedAt={DEMO_DEPLOYMENT.deployedAt}
          chain={getChain(DEMO_DEPLOYMENT.chainId)!}
          groups={sample.groups}
          activity={DEMO_ACTIVITY}
          totalMinted={sample.totalMinted}
          maxSupply={maxSupply}
          readAt={DEMO_NOW}
          chainReachable
          slug={collection.slug}
          settings={sampleSettingsView(collection, wallet, { art })}
          wallet={wallet}
          sample
          paidByMintersWei={DEMO_ACTIVITY.proceeds.grossWei}
          mintPage={{ avatarUrl: SAMPLE.mintPage.avatarUrl, published: SAMPLE.mintPage.published }}
        />
      </StagePage>
    )
  }

  const [record, phases, settings, mintPage] = await Promise.all([
    getDeployment(collection.id),
    getPhases(collection.id),
    getSettings(collection.id),
    getMintPageSettings(collection.id),
  ])
  if (!record.ok || !record.data || !phases.ok || !settings.ok || !mintPage.ok) {
    const message = !record.ok
      ? record.error
      : !phases.ok
        ? phases.error
        : !settings.ok
          ? settings.error
          : !mintPage.ok
            ? mintPage.error
            : NOT_DEPLOYED
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
        contract={record.data.contractAddress}
        deployedAt={record.data.deployedAt}
        chain={chainView(view.chainId)}
        groups={view.groups}
        activity={DEMO_ACTIVITY}
        totalMinted={view.chainReachable ? view.totalMinted : null}
        maxSupply={view.maxSupply}
        readAt={view.readAt}
        chainReachable={view.chainReachable}
        slug={collection.slug}
        settings={settings.data}
        wallet={wallet}
        sample={false}
        paidByMintersWei={null}
        mintPage={{ avatarUrl: mintPage.data.media.avatar?.url ?? null, published: mintPage.data.published }}
      />
    </StagePage>
  )
}
