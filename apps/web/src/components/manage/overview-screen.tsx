'use client'

import Link from 'next/link'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { cn } from '@cobweb/ui/lib/utils'
import type { Tables } from '@/lib/database.types'
import {
  formatNative,
  type Deployment,
  type DropActivity,
  type MintGroup,
  type SupportedChain,
  sampleSupply,
  DEMO_COLLECTION,
} from '@/lib/demo'
import { manageTabHref } from '@/lib/steps'
import { Row } from './bits'
import { MintPageLinkBar, OverviewHeader } from './overview-cards'
import { LiveNow, RecentMints } from './overview-parts'
import { SAMPLE } from './manage-sim'

export type OverviewScreenProps = {
  collection: Tables<'collections'>
  deployment: Deployment
  chain: SupportedChain
  /** Phases as the chain reports them; `active` comes from `mintGroupActive`. */
  groups: MintGroup[]
  activity: DropActivity
  totalMinted: number
  /** The collection's mint page link (`/night-owls` without the slash), or null while it has none. */
  slug: string | null
  /**
   * Whether the real set is rendered. False while the art is deferred (MASTER_PLAN, Flow:
   * pre-reveal): there is nothing to reveal to, so Reveal is off.
   */
  realArtRendered?: boolean
}

/**
 * Manage drop, overview: a compact header (art, minted of supply, contract, what it points at,
 * holders), the mint page link, then live phases, proceeds and recent mints. Tradability lives in
 * Settings, Advanced.
 */
export function OverviewScreen({
  collection,
  deployment,
  chain,
  groups,
  activity,
  totalMinted,
  slug,
  realArtRendered = true,
}: OverviewScreenProps) {
  const readAt = SAMPLE.readAt
  const href = (tab: Parameters<typeof manageTabHref>[1]) => manageTabHref(collection.id, tab)
  const { proceeds } = activity
  const symbol = chain.nativeSymbol

  return (
    <div className="grid gap-5">
      <OverviewHeader
        collectionId={collection.id}
        name={collection.name}
        deployment={deployment}
        chain={chain}
        totalMinted={totalMinted}
        maxSupply={sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)}
        holders={activity.holders}
        singleAsset={collection.project_type === 'single_asset'}
        realArtRendered={realArtRendered}
      />
      <MintPageLinkBar collection={{ ...collection, slug }} initialPublished={SAMPLE.mintPage.published} />

      <div className="mt-3 grid gap-5 lg:grid-cols-3">
        {/* Live phases and proceeds on the right from 1024px, first on narrow screens. */}
        <div className="grid content-start gap-5 lg:order-last">
          <Panel
            title="Live now"
            className={cn(groups.some((group) => group.active) && 'border-primary-line')}
            bodyClassName="p-5"
          >
            <LiveNow groups={groups} chain={chain} readAt={readAt} phasesHref={href('phases')} />
          </Panel>

          <Panel title="Proceeds" bodyClassName="grid gap-4 p-5">
            <div>
              <p className="text-muted-foreground text-xs font-medium">Withdrawable now</p>
              <p className="numeric mt-1 text-[2rem] leading-tight">
                {formatNative(proceeds.withdrawableWei, symbol)}
              </p>
            </div>
            <dl className="divide-y border-t">
              <Row label="Paid by minters">{formatNative(proceeds.grossWei, symbol)}</Row>
              <Row label="Already withdrawn">{formatNative(proceeds.withdrawnWei, symbol)}</Row>
            </dl>
            <Button variant="secondary" asChild className="w-full">
              <Link href={href('settings')}>Withdraw proceeds</Link>
            </Button>
          </Panel>
        </div>

        <Panel title="Recent mints" className="lg:col-span-2" bodyClassName="p-0 pb-2">
          <RecentMints mints={activity.recentMints} groups={groups} chain={chain} readAt={readAt} />
        </Panel>
      </div>
    </div>
  )
}
