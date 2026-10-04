'use client'

import Link from 'next/link'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainName } from '@/components/chains/chain-icon'
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
import { AddressLine, Row } from './bits'
import { count, relativeTo } from './format'
import { MintPageLinkRow, RevealCard } from './overview-cards'
import { LiveNow, RecentMints, SupplyMeter } from './overview-parts'
import { SAMPLE } from './simulate'
import { TradabilityCard } from './tradability'

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

/** Manage drop, overview: supply minted, the mint page, live phases, tradability, proceeds, reveal, recent mints. */
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
    <div className="grid gap-5 lg:grid-cols-3">
      {/* The drop at a glance: art, the supply meter, the contract and the public page. */}
      <section aria-label="Supply" className="flex flex-col gap-6 sm:flex-row lg:col-span-2 lg:pr-4">
        <Artwork
          src={SAMPLE.mintPage.avatarUrl}
          alt={`${collection.name} artwork`}
          seed={collection.id}
          className="shadow-raised size-28 shrink-0 rounded-xl border"
        />
        <div className="grid min-w-0 flex-1 content-start gap-6">
          <SupplyMeter
            groups={groups}
            totalMinted={totalMinted}
            maxSupply={sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t pt-4 text-sm">
            <ChainName chain={chain} className="text-muted-foreground" />
            <AddressLine address={deployment.contractAddress} chain={chain} />
            <span className="text-muted-foreground">
              Deployed {relativeTo(deployment.deployedAt, readAt)}
            </span>
            <span className="text-muted-foreground">
              <span className="numeric text-foreground">{count(activity.holders)}</span> holders
            </span>
          </div>
          <MintPageLinkRow
            slug={slug}
            initialPublished={SAMPLE.mintPage.published}
            setLinkHref={href('mint-page')}
          />
        </div>
      </section>

      <Panel
        title="Live now"
        className={cn(groups.some((group) => group.active) && 'border-primary-line')}
        bodyClassName="p-5"
      >
        <LiveNow groups={groups} chain={chain} readAt={readAt} phasesHref={href('phases')} />
      </Panel>

      <TradabilityCard deployment={deployment} chain={chain} className="lg:col-span-2" />

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

      <Panel title="Recent mints" className="lg:col-span-2" bodyClassName="p-0 pb-2">
        <RecentMints mints={activity.recentMints} groups={groups} chain={chain} readAt={readAt} />
      </Panel>

      <RevealCard
        deployment={deployment}
        chain={chain}
        singleAsset={collection.project_type === 'single_asset'}
        realArtRendered={realArtRendered}
      />
    </div>
  )
}
