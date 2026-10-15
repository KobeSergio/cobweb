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
  SUPPORTED_CHAINS,
} from '@/lib/demo'
import { snapshotChains } from '@/lib/manage/snapshot-core'
import { LockedStagePage, stageContext, type CollectionParams } from '../../_lib/stage'

/** The holder snapshot runs as a server action from this page: up to 20,000 `ownerOf` reads. */
export const maxDuration = 300

/**
 * Manage drop, airdrop. Sample data until the contract reads and writes are wired (the fourth sub-project); the
 * holder snapshot reads the chain (docs/specs/2026-10-15-whitelist.md, section 7.2), or the sample in sample mode.
 */
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
        snapshotChainIds={ctx.demo ? SUPPORTED_CHAINS.map((entry) => entry.id) : snapshotChains()}
        sample={ctx.demo}
      />
    </StagePage>
  )
}
