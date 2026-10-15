import { getAddress } from 'viem'
import { getSettings } from '@/app/actions/settings'
import { ManageUnavailable } from '@/components/manage/manage-unavailable'
import { SettingsScreen } from '@/components/manage/settings-screen'
import { sampleSettingsView } from '@/components/manage/settings-sim'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection, requireUser } from '@/lib/auth'
import { DEMO_MINTER } from '@/lib/demo'
import type { SettingsView } from '@/lib/manage/settings-types'
import {
  LockedStagePage,
  searchParam,
  stageContext,
  type CollectionParams,
  type SearchParams,
} from '../../_lib/stage'

const TITLE = 'Settings'
const DESCRIPTION =
  'Withdraw proceeds, the payout address, royalties and reveal. Advanced holds tradability and mint on behalf.'

/**
 * Manage drop, Settings (docs/specs/2026-10-15-airdrop-settings.md, section 7.4): the contract's settings and
 * balances read on the server at one block, with the reveal targets and the withdrawals Cobweb confirmed. Sample
 * mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the sample on any collection, `?chain=unreachable` shows the copies with
 * their alert, `?owner=other` the owner check, `?art=deferred` no real set to reveal to, `?art=revealed` a
 * collection already revealed.
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
  const art = await searchParam(searchParams, 'art')
  const ctx = stageContext(collection, 'manage', 'manage', { art })
  if (ctx.access === 'locked') return <LockedStagePage collection={collection} stage="manage" />
  const wallet = getAddress(user.walletAddress)

  let view: SettingsView
  if (ctx.demo) {
    view = sampleSettingsView(collection, wallet, {
      chainReachable: (await searchParam(searchParams, 'chain')) !== 'unreachable',
      owner: (await searchParam(searchParams, 'owner')) === 'other' ? getAddress(DEMO_MINTER) : undefined,
      art,
    })
  } else {
    const result = await getSettings(collection.id)
    if (!result.ok)
      return (
        <StagePage title={TITLE} description={DESCRIPTION} width="default">
          <ManageUnavailable title="The settings could not be read" message={result.error} />
        </StagePage>
      )
    view = result.data
  }

  return (
    <StagePage title={TITLE} description={DESCRIPTION} width="default">
      <SettingsScreen collection={collection} view={view} wallet={wallet} sample={ctx.demo} />
    </StagePage>
  )
}
