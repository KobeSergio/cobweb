'use client'

import { ArrowUpRightIcon } from 'lucide-react'
import Link from 'next/link'
import { Artwork } from '@cobweb/ui/components/artwork'
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
} from '@/lib/demo'
import { manageTabHref } from '@/lib/steps'
import { AddressLine, Row } from './bits'
import { count, relativeTo } from './format'
import { MintChart } from './mint-chart'
import { LiveNow, RecentMints, SetupChecklist, SupplyMeter, type ChecklistItem } from './overview-parts'
import { SAMPLE } from './simulate'
import { fromGroupWhitelist, pendingChunks } from './whitelist-model'

export type OverviewScreenProps = {
  collection: Tables<'collections'>
  deployment: Deployment
  chain: SupportedChain
  /** Phases as the chain reports them; `active` comes from `mintGroupActive`. */
  groups: MintGroup[]
  activity: DropActivity
  totalMinted: number
  /** The public mint page, e.g. `/night-owls`. */
  /** The public page, or null while the collection has no mint page address. */
  mintPageHref: string | null
}

/** Manage drop, overview: supply minted, live phases, mints over time, recent mints, proceeds. */
export function OverviewScreen({
  collection,
  deployment,
  chain,
  groups,
  activity,
  totalMinted,
  mintPageHref,
}: OverviewScreenProps) {
  const readAt = SAMPLE.readAt
  const href = (tab: Parameters<typeof manageTabHref>[1]) => manageTabHref(collection.id, tab)
  const checklist = buildChecklist(groups, href)
  const { proceeds } = activity
  const symbol = chain.nativeSymbol

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* The drop at a glance: art, the supply meter, the contract and the way to the public page. */}
      <section aria-label="Supply" className="flex flex-col gap-6 sm:flex-row lg:col-span-2 lg:pr-4">
        <Artwork
          src={SAMPLE.mintPage.avatarUrl}
          alt={`${collection.name} artwork`}
          seed={collection.id}
          className="size-28 shrink-0 rounded-xl border shadow-raised"
        />
        <div className="grid min-w-0 flex-1 content-start gap-6">
          <SupplyMeter groups={groups} totalMinted={totalMinted} maxSupply={collection.max_supply} />
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t pt-4">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground">{chain.name}</span>
              <AddressLine address={deployment.contractAddress} chain={chain} />
              <span className="text-muted-foreground">
                Deployed {relativeTo(deployment.deployedAt, readAt)}
              </span>
              <span className="text-muted-foreground">
                <span className="numeric text-foreground">{count(activity.holders)}</span> holders
              </span>
            </div>
            {mintPageHref ? (
              <Button asChild>
                <Link href={mintPageHref} target="_blank">
                  View mint page
                  <ArrowUpRightIcon aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href={href('mint-page')}>Set mint page address</Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      <Panel
        title="Live now"
        className={cn(groups.some((group) => group.active) && 'border-primary-line')}
        bodyClassName="p-5"
      >
        <LiveNow groups={groups} chain={chain} readAt={readAt} phasesHref={href('phases')} />
      </Panel>

      <Panel
        title="Mints over time"
        description="Per hour, from the chain's mint events."
        className="lg:col-span-2"
      >
        <MintChart buckets={activity.mintsOverTime} live={groups.some((group) => group.active)} />
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
          <Row label="Platform fees, held apart">{formatNative(proceeds.platformFeesWei, symbol)}</Row>
        </dl>
        <Button variant="secondary" asChild className="w-full">
          <Link href={href('settings')}>Withdraw proceeds</Link>
        </Button>
      </Panel>

      <Panel title="Recent mints" className="lg:col-span-2" bodyClassName="p-0 pb-2">
        <RecentMints mints={activity.recentMints} groups={groups} chain={chain} readAt={readAt} />
      </Panel>

      <Panel title="Setup" bodyClassName="p-5">
        <SetupChecklist items={checklist} />
      </Panel>
    </div>
  )
}

/** The checks behind the Setup list. Each is something a creator forgets on launch day. */
function buildChecklist(
  groups: MintGroup[],
  href: (tab: Parameters<typeof manageTabHref>[1]) => string,
): ChecklistItem[] {
  const opened = groups.some((group) => group.active || group.scheduledStart > 0)
  const unwritten = SAMPLE.whitelists.flatMap((list) => pendingChunks(fromGroupWhitelist(list)))
  const unwrittenAddresses = unwritten.reduce((sum, chunk) => sum + chunk.entries.length, 0)
  const page = SAMPLE.mintPage
  const missing = [
    !page.description.trim() && 'description',
    !page.bannerUrl && 'banner',
    !page.avatarUrl && 'avatar',
    !page.socials.website && !page.socials.x && !page.socials.discord && 'links',
    page.featuredTokenIds.length === 0 && 'featured tokens',
  ].filter((item): item is string => !!item)

  return [
    {
      key: 'phases',
      done: opened,
      title: 'A phase is open or scheduled',
      detail: opened ? 'Collectors can mint, or will at the scheduled time.' : 'Every phase is closed.',
      href: href('phases'),
      action: 'Open a phase',
    },
    {
      key: 'whitelist',
      done: unwritten.length === 0,
      title: 'Whitelist written on chain',
      detail:
        unwritten.length === 0
          ? 'Every address has its quota on chain.'
          : `${count(unwritten.length)} ${unwritten.length === 1 ? 'chunk' : 'chunks'} of ${count(unwrittenAddresses)} addresses waiting.`,
      href: href('whitelist'),
      action: 'Write the next chunk',
    },
    {
      key: 'mint-page',
      done: missing.length === 0,
      title: 'Mint page details',
      detail:
        missing.length === 0
          ? 'Description, images, links and featured tokens are set.'
          : `Missing: ${missing.join(', ')}.`,
      href: href('mint-page'),
      action: 'Finish the mint page',
    },
  ]
}
