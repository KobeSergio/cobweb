import { getAddress } from 'viem'
import { getAirdrop } from '@/app/actions/airdrop'
import { AirdropScreen } from '@/components/manage/airdrop-screen'
import { sampleAirdropView } from '@/components/manage/airdrop-sim'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { DEMO_MINTER, SUPPORTED_CHAINS } from '@/lib/demo'
import type { AirdropView } from '@/lib/manage/airdrop-types'
import { snapshotChains } from '@/lib/manage/snapshot-core'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../../_lib/stage'

/** The holder snapshot runs as a server action from this page: up to 20,000 `ownerOf` reads. */
export const maxDuration = 300

const TITLE = 'Airdrop'
const DESCRIPTION =
  'Send tokens straight to wallets, or burn some. Each token costs the airdrop fee and uses collection supply.'

/**
 * Manage drop, Airdrop (docs/specs/2026-10-15-airdrop-settings.md, section 7.3): the contract's fee, supply and
 * owner read on the server, with the collection's airdrops, Cobweb's and those the indexer read
 * (docs/specs/2026-10-16-indexer-overview.md, section 7.3). Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the sample
 * on any collection, `?chain=unreachable` shows the record alone with its alert, `?owner=other` the owner check,
 * `?batch=pending` a batch waiting to be confirmed, `?activity=counting` the history before the indexer has read
 * the contract.
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
  const ctx = stageContext(collection, 'manage', 'manage')
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const wallet = getAddress(user.walletAddress)

  let view: AirdropView
  if (ctx.demo) {
    view = sampleAirdropView(collection, wallet, {
      chainReachable: (await searchParam(searchParams, 'chain')) !== 'unreachable',
      owner: (await searchParam(searchParams, 'owner')) === 'other' ? getAddress(DEMO_MINTER) : undefined,
      counted: (await searchParam(searchParams, 'activity')) !== 'counting',
    })
  } else {
    const result = await getAirdrop(collection.id)
    if (!result.ok)
      return (
        <StagePage title={TITLE} description={DESCRIPTION} width="default">
          <ManageUnavailable title="The airdrop could not be read" message={result.error} />
        </StagePage>
      )
    view = result.data
  }

  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="default">
      <AirdropScreen
        collection={collection}
        view={view}
        wallet={wallet}
        sample={ctx.demo}
        samplePending={ctx.demo && (await searchParam(searchParams, 'batch')) === 'pending'}
        snapshotChainIds={ctx.demo ? SUPPORTED_CHAINS.map((entry) => entry.id) : snapshotChains()}
      />
    </StagePage>
  )
}
