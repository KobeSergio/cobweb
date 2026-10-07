import { AirdropScreen } from '@/components/manage/airdrop-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import {
  DEMO_AIRDROPS,
  DEMO_COLLECTION,
  DEMO_DEPLOYMENT,
  getChain,
  sampleSupply,
  scaleSampleToSupply,
} from '@/lib/demo'
import { LockedStagePage, stageContext, type CollectionParams } from '../../_lib/stage'

/** Manage drop, airdrop. Sample data until the contract reads and writes are wired. */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'manage', 'manage')
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const chain = getChain(DEMO_DEPLOYMENT.chainId)!

  return (
    <StagePage
      title="Airdrop"
      description="Send tokens straight to wallets, or burn some. Each token costs the airdrop fee and uses collection supply."
      width="default"
    >
      <AirdropScreen
        collection={collection}
        deployment={DEMO_DEPLOYMENT}
        chain={chain}
        airdrops={DEMO_AIRDROPS}
        // Seam: the minted total comes from the freshness server once Phase 6 lands.
        totalMinted={
          scaleSampleToSupply(sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)).totalMinted
        }
      />
    </StagePage>
  )
}
