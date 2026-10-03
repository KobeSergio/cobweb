import { MintPageScreen } from '@/components/manage/mint-page-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_MINT_PAGE_SETTINGS, DEMO_TOKENS, getMintPageData } from '@/lib/demo'
import { LockedStagePage, stageContext, type CollectionParams } from '../../_lib/stage'

/** Manage drop, mint page. Sample data until the contract reads and writes are wired. */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'manage', 'manage')
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />

  return (
    <StagePage
      title="Mint page"
      description="The public page where collectors mint: its look, its links and the tokens it features."
      sampleNotice={ctx.sampleNotice}
      width="wide"
    >
      <MintPageScreen
        collection={collection}
        settings={DEMO_MINT_PAGE_SETTINGS}
        featuredCandidates={DEMO_TOKENS.filter((token) => token.previewUrl)}
        preview={getMintPageData(collection.slug ?? '', 'allowlist-live')}
      />
    </StagePage>
  )
}
