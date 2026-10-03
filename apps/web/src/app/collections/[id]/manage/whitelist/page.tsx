import { WhitelistScreen } from '@/components/manage/whitelist-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_DEPLOYMENT, DEMO_MINT_GROUPS, DEMO_WHITELISTS, getChain } from '@/lib/demo'
import { LockedStagePage, stageContext, type CollectionParams } from '../../_lib/stage'

/** Manage drop, whitelist. Sample data until the contract reads and writes are wired. */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const ctx = stageContext(collection, 'manage', 'manage')
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const chain = getChain(DEMO_DEPLOYMENT.chainId)!

  return (
    <StagePage
      title="Whitelist"
      description="Wallet addresses and how many each may mint, per phase. Lists are written on-chain in batches."
      sampleNotice={ctx.sampleNotice}
      width="wide"
    >
      <WhitelistScreen
        collection={collection}
        chain={chain}
        groups={DEMO_MINT_GROUPS.filter((group) => group.kind === 'whitelist')}
        whitelists={DEMO_WHITELISTS}
      />
    </StagePage>
  )
}
