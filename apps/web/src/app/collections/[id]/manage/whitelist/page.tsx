import { getAddress } from 'viem'
import { getWhitelist } from '@/app/actions/whitelist'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { WhitelistScreen } from '@/components/manage/whitelist-screen'
import { sampleWhitelistView } from '@/components/manage/whitelist-sim'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { SUPPORTED_CHAINS } from '@/lib/demo'
import { snapshotChains } from '@/lib/manage/snapshot-core'
import type { WhitelistView } from '@/lib/manage/whitelist-types'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../../_lib/stage'

/** The holder snapshot runs as a server action from this page: up to 20,000 `ownerOf` reads. */
export const maxDuration = 300

const TITLE = 'Whitelist'
const DESCRIPTION =
  'Wallet addresses and how many each may mint, per phase. Lists are written on-chain in batches.'

/**
 * Manage drop, Whitelist (docs/specs/2026-10-15-whitelist.md, section 7.3): the whitelist groups and their lists,
 * read on the server with the contract's state. Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the sample lists on
 * any collection, `?chain=unreachable` shows the copy with its alert, `?chunk=pending` a chunk waiting to be
 * confirmed.
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

  let view: WhitelistView
  if (ctx.demo) {
    view = sampleWhitelistView(collection, (await searchParam(searchParams, 'chain')) !== 'unreachable')
  } else {
    const result = await getWhitelist(collection.id)
    if (!result.ok)
      return (
        <StagePage title={TITLE} description={DESCRIPTION} width="wide">
          <ManageUnavailable title="The whitelist could not be read" message={result.error} />
        </StagePage>
      )
    view = result.data
  }

  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="wide">
      <WhitelistScreen
        collection={collection}
        view={view}
        wallet={getAddress(user.walletAddress)}
        sample={ctx.demo}
        samplePending={ctx.demo && (await searchParam(searchParams, 'chunk')) === 'pending'}
        snapshotChainIds={ctx.demo ? SUPPORTED_CHAINS.map((chain) => chain.id) : snapshotChains()}
      />
    </StagePage>
  )
}
