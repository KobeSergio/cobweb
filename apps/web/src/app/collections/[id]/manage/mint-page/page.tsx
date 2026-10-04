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
      width="wide"
    >
      <MintPageScreen
        // Manage drop is the deployed collection's home; sample mode opens it before deploy, so the
        // mint page link reads as a deployed one there too (no reservation wording).
        collection={{ ...collection, status: 'deployed' }}
        settings={DEMO_MINT_PAGE_SETTINGS}
        featuredCandidates={DEMO_TOKENS.filter((token) => token.previewUrl)}
        preview={getMintPageData(collection.slug ?? '', 'allowlist-live')}
      />
    </StagePage>
  )
}
