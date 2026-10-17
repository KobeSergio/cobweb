'use client'

import { ArrowRightIcon, CalendarClockIcon, ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import { Progress } from '@cobweb/ui/components/progress'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import { explorerTxUrl, formatNative, shortAddress, type MintGroup, type SupportedChain } from '@/lib/demo'
import { behindOf, type ActivityView } from '@/lib/manage/activity-view'
import { count, duration, localDateTime, percent, relativeTo, shortUtc, useTimeZone } from './format'

/**
 * The phases the chain reports as live, and the next one scheduled. Live comes from each
 * group's `active` field only; the schedule is shown as a time, never used to decide liveness.
 * While the contract cannot be read (`reachable` false), neither the live phases nor the next scheduled
 * one is shown: the copy's schedule cannot say whether a phase has opened.
 */
export function LiveNow({
  groups,
  chain,
  readAt,
  phasesHref,
  reachable = true,
}: {
  groups: MintGroup[]
  chain: SupportedChain
  readAt: number
  phasesHref: string
  reachable?: boolean
}) {
  const timeZone = useTimeZone()
  const live = groups.filter((group) => group.active)
  const next = groups
    .filter((group) => !group.active && group.scheduledStart > 0)
    .sort((a, b) => a.scheduledStart - b.scheduledStart)[0]

  return (
    <div className="grid gap-5">
      {!reachable ? (
        <div className="grid gap-2">
          <StatusBadge status="draft">Not read</StatusBadge>
          <p className="text-muted-foreground text-sm">
            The contract could not be read, so live phases are not shown.
          </p>
        </div>
      ) : live.length === 0 ? (
        <div className="grid gap-2">
          <StatusBadge status="closed">Nothing live</StatusBadge>
          <p className="text-muted-foreground text-sm">No phase is open, so nobody can mint right now.</p>
        </div>
      ) : (
        live.map((group) => (
          <div key={group.id} className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-heading truncate">{group.name}</p>
              <StatusBadge status="live" />
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-muted-foreground text-xs font-medium">Price</dt>
                <dd className="numeric text-lg">{formatNative(group.priceWei, chain.nativeSymbol)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">Minted in phase</dt>
                <dd className="numeric text-primary text-lg">
                  {count(group.minted)}
                  <span className="text-muted-foreground text-sm"> / {count(group.maxSupply)}</span>
                </dd>
              </div>
            </dl>
            <Progress
              value={percent(group.minted, group.maxSupply)}
              aria-label={`${group.name} minted of allocation`}
            />
          </div>
        ))
      )}

      <div className="border-t pt-4">
        {!reachable ? null : next ? (
          <div className="flex gap-3">
            <CalendarClockIcon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 text-sm">
              <p>
                <span className="font-medium">{next.name}</span>{' '}
                <span className="text-muted-foreground">opens {relativeTo(next.scheduledStart, readAt)}</span>
              </p>
              <p className="numeric text-muted-foreground mt-0.5 text-[0.8125rem]">
                {shortUtc(next.scheduledStart)}
                {timeZone !== 'UTC' && `, ${localDateTime(next.scheduledStart, timeZone)} your time`}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No phase is scheduled.</p>
        )}
        <Link
          href={phasesHref}
          className="text-foreground focus-visible:ring-ring mt-3 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
        >
          Manage phases
          <ArrowRightIcon aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </div>
  )
}

/** A sentence in place of the table. */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-6 py-10 text-center text-sm">{children}</p>
}

/**
 * The latest mints the indexer recorded, newest first (docs/specs/2026-10-16-indexer-overview.md, section 7.2):
 * "Counting" until it has read every block since the deploy, and under the table a line when its count trails
 * the chain read by more than 5 minutes.
 */
export function RecentMints({
  activity,
  groups,
  chain,
  readAt,
  chainReachable,
}: {
  /** Null when the view could not be read. */
  activity: ActivityView | null
  groups: MintGroup[]
  chain: SupportedChain
  /** The chain read's time (the copy's while it is not reachable). */
  readAt: number
  chainReachable: boolean
}) {
  if (!activity) return <Note>The mint history could not be read. Reload the page to try again.</Note>
  if (!activity.counted)
    return (
      <Note>
        Counting the mints from the chain. They show here once Cobweb has read every block since the deploy.
      </Note>
    )
  const mints = activity.recentMints
  // Each mint's time counts from the later of the read's time and the count's: the copy's time can trail a
  // recorded mint, which would read "in under a minute", and the count is no earlier than any mint it holds.
  const now = Math.max(readAt, activity.countedAt ?? readAt)
  const behind = behindOf(activity, readAt, chainReachable) && activity.countedAt !== null && (
    <p className="text-muted-foreground border-t px-6 pt-3 text-[0.8125rem]">
      Counted to the chain as it was {duration(readAt - activity.countedAt)} ago. Newer mints show once Cobweb
      catches up.
    </p>
  )
  if (mints.length === 0)
    return (
      <>
        <Note>No mints yet. Each one shows here a few blocks after it lands.</Note>
        {behind}
      </>
    )
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-6">Minter</TableHead>
            <TableHead>Phase</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Token ids</TableHead>
            <TableHead className="pr-6 text-right">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mints.map((mint) => (
            // Two mints in one transaction share its hash; their first token ids differ.
            <TableRow key={`${mint.txHash}:${mint.firstTokenId}`}>
              <TableCell className="numeric pl-6" title={mint.minter}>
                {shortAddress(mint.minter)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {groups.find((group) => group.id === mint.groupId)?.name ?? `Group ${mint.groupId}`}
              </TableCell>
              <TableCell className="numeric text-right">{mint.amount}</TableCell>
              <TableCell className="numeric text-muted-foreground text-right">
                {mint.amount === 1
                  ? `#${mint.firstTokenId}`
                  : `#${mint.firstTokenId} to #${mint.firstTokenId + mint.amount - 1}`}
              </TableCell>
              <TableCell className="pr-6 text-right">
                <a
                  href={explorerTxUrl(chain, mint.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2"
                >
                  {relativeTo(mint.at, now)}
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                  <span className="sr-only">, view transaction</span>
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {behind}
    </>
  )
}
