'use client'

import { ArrowRightIcon, CalendarClockIcon, ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import { Progress } from '@cobweb/ui/components/progress'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import {
  explorerTxUrl,
  formatNative,
  shortAddress,
  type DropActivity,
  type MintGroup,
  type SupportedChain,
} from '@/lib/demo'
import { count, localDateTime, percent, relativeTo, shortUtc, useTimeZone } from './format'

/**
 * The phases the chain reports as live, and the next one scheduled. Live comes from each
 * group's `active` field only; the schedule is shown as a time, never used to decide liveness.
 */
export function LiveNow({
  groups,
  chain,
  readAt,
  phasesHref,
}: {
  groups: MintGroup[]
  chain: SupportedChain
  readAt: number
  phasesHref: string
}) {
  const timeZone = useTimeZone()
  const live = groups.filter((group) => group.active)
  const next = groups
    .filter((group) => !group.active && group.scheduledStart > 0)
    .sort((a, b) => a.scheduledStart - b.scheduledStart)[0]

  return (
    <div className="grid gap-5">
      {live.length === 0 ? (
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
        {next ? (
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

/** The latest mints, newest first. */
export function RecentMints({
  mints,
  groups,
  chain,
  readAt,
}: {
  mints: DropActivity['recentMints']
  groups: MintGroup[]
  chain: SupportedChain
  readAt: number
}) {
  if (mints.length === 0) {
    return (
      <p className="text-muted-foreground px-6 py-10 text-center text-sm">
        No mints yet. They appear here as they land.
      </p>
    )
  }
  return (
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
          <TableRow key={mint.txHash}>
            <TableCell className="numeric pl-6" title={mint.minter}>
              {shortAddress(mint.minter)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {groups.find((group) => group.id === mint.groupId)?.name ?? `Phase ${mint.groupId}`}
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
                {relativeTo(mint.at, readAt)}
                <ExternalLinkIcon aria-hidden="true" className="size-3" />
                <span className="sr-only">, view transaction</span>
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
