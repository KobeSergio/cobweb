import { getMintPageSettings } from '@/app/actions/mint-page'
import { getPhases } from '@/app/actions/phases'
import { sampleMintPageView } from '@/components/manage/manage-sim'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import type { PreviewData } from '@/components/manage/mint-page-preview'
import { MintPageScreen } from '@/components/manage/mint-page-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { chainView } from '@/lib/chain/chain-view'
import { getMintPageData } from '@/lib/demo'
import { ipfsGateway } from '@/lib/mint/page-urls'
import { LockedStagePage, stageContext, type CollectionParams } from '../../_lib/stage'

const TITLE = 'Mint page'
const DESCRIPTION =
  'The public page where collectors mint: its look, its links, its sections and the tokens it features.'

/**
 * Manage drop, mint page (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9): the row with its media and
 * sections, and the phases view for the miniature, read on the server; sample mode keeps the sample row.
 */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'manage', 'manage')
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />

  if (ctx.demo) {
    const data = getMintPageData(collection.slug ?? '', 'allowlist-live')
    const preview: PreviewData = {
      name: data.collection.name,
      symbol: data.collection.symbol,
      slug: collection.slug,
      chain: data.collection.chain,
      minted: data.supply.minted,
      max: data.supply.max,
      live: data.groups.find((group) => group.active) ?? null,
    }
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
        <MintPageScreen
          // Manage drop is the deployed collection's home; sample mode opens it before deploy, so the
          // mint page link reads as a deployed one there too (no reservation wording).
          collection={{ ...collection, status: 'deployed' }}
          view={sampleMintPageView(collection)}
          preview={preview}
          gateway={ipfsGateway()}
          sample
        />
      </StagePage>
    )
  }

  const [settings, phases] = await Promise.all([getMintPageSettings(collection.id), getPhases(collection.id)])
  if (!settings.ok || !phases.ok) {
    return (
      <StagePage title={TITLE} description={DESCRIPTION} width="wide">
        <ManageUnavailable
          title="The mint page could not be read"
          message={!settings.ok ? settings.error : !phases.ok ? phases.error : ''}
        />
      </StagePage>
    )
  }
  const view = phases.data
  const preview: PreviewData = {
    name: collection.name,
    symbol: collection.symbol,
    slug: collection.slug,
    chain: chainView(view.chainId),
    minted: view.chainReachable ? view.totalMinted : 0,
    max: view.maxSupply,
    live: view.chainReachable ? (view.groups.find((group) => group.active) ?? null) : null,
  }
  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="wide">
      <MintPageScreen
        collection={collection}
        view={settings.data}
        preview={preview}
        gateway={ipfsGateway()}
        sample={false}
      />
    </StagePage>
  )
}
