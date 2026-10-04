import { PhasesScreen } from '@/components/manage/phases-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_DEPLOYMENT, DEMO_MINT_GROUPS, DEMO_NOW, DEMO_PUBLIC_MAX_PER_WALLET, getChain } from '@/lib/demo'
import { LockedStagePage, stageContext, type CollectionParams } from '../../_lib/stage'

/** Manage drop, phases. Sample data until the contract reads and writes are wired. */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'manage', 'manage')
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const chain = getChain(DEMO_DEPLOYMENT.chainId)!

  return (
    <StagePage
      title="Phases"
      description="The public sale and whitelist phases: price, supply and when each opens. A phase stays open until you close it."
      width="wide"
    >
      <PhasesScreen
        collection={collection}
        deployment={DEMO_DEPLOYMENT}
        chain={chain}
        groups={DEMO_MINT_GROUPS}
        publicMaxMintPerWallet={DEMO_PUBLIC_MAX_PER_WALLET}
        blockTimestamp={DEMO_NOW}
      />
    </StagePage>
  )
}
