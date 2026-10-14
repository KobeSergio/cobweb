import { getAddress } from 'viem'
import { getPhases } from '@/app/actions/phases'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { samplePhasesView } from '@/components/manage/manage-sim'
import { PhasesScreen } from '@/components/manage/phases-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import type { PhasesView } from '@/lib/manage/phases-types'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../../_lib/stage'

const TITLE = 'Phases'
const DESCRIPTION =
  'The public sale and whitelist phases: price, supply and when each opens. A phase stays open until you close it.'

/**
 * Manage drop, Phases (docs/specs/2026-10-15-phases.md, section 7.4): the contract's groups, read on the
 * server and joined with Cobweb's rows. Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the sample phases on
 * any collection, `?chain=unreachable` shows the copy with its alert, `?pending=add` an add waiting to be
 * recorded.
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

  let view: PhasesView
  if (ctx.demo) {
    view = samplePhasesView(collection, (await searchParam(searchParams, 'chain')) !== 'unreachable')
  } else {
    const result = await getPhases(collection.id)
    if (!result.ok)
      return (
        <StagePage title={TITLE} description={DESCRIPTION} width="wide">
          <ManageUnavailable title="The phases could not be read" message={result.error} />
        </StagePage>
      )
    view = result.data
  }

  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="wide">
      <PhasesScreen
        collection={collection}
        view={view}
        wallet={getAddress(user.walletAddress)}
        sample={ctx.demo}
        samplePending={ctx.demo && (await searchParam(searchParams, 'pending')) === 'add'}
      />
    </StagePage>
  )
}
