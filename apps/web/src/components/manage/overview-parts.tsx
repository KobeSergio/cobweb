'use client'

import { ArrowRightIcon, CalendarClockIcon, CheckIcon, CircleIcon, ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import { Progress } from '@cobweb/ui/components/progress'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import { cn } from '@cobweb/ui/lib/utils'
import {
  explorerTxUrl,
  formatNative,
  shortAddress,
  type DropActivity,
  type MintGroup,
  type SupportedChain,
} from '@/lib/demo'
import { count, localDateTime, percent, relativeTo, shortUtc, useTimeZone } from './format'

/** Minted of supply, split by where the tokens went. The one big number on the screen. */
export function SupplyMeter({
  groups,
  totalMinted,
  maxSupply,
}: {
  groups: MintGroup[]
  totalMinted: number
  maxSupply: number
}) {
  const fromPhases = groups.reduce((sum, group) => sum + group.minted, 0)
  const airdropped = Math.max(0, totalMinted - fromPhases)
  const remaining = Math.max(0, maxSupply - totalMinted)
  const parts = [
    ...groups
      .filter((group) => group.minted > 0)
      .map((group) => ({ key: `g${group.id}`, label: group.name, value: group.minted })),
    ...(airdropped > 0 ? [{ key: 'airdrop', label: 'Airdrops', value: airdropped }] : []),
  ]
  // Shades of the one accent, darkest last, so each source reads apart without a second hue.
  const shades = ['bg-primary', 'bg-primary/70', 'bg-primary/45', 'bg-primary/30']
  const share = percent(totalMinted, maxSupply)

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="flex items-baseline gap-2">
          <span className="numeric text-[3.5rem] leading-none font-medium tracking-tight">
            {count(totalMinted)}
          </span>
          <span className="numeric text-muted-foreground text-xl">/ {count(maxSupply)}</span>
          <span className="sr-only">tokens minted</span>
        </p>
        <p className="text-muted-foreground text-sm">
          <span className="numeric text-foreground">{share.toFixed(1)}%</span> minted,{' '}
          <span className="numeric text-foreground">{count(remaining)}</span> left
        </p>
      </div>
      <div
        role="meter"
        aria-label="Minted of supply"
        aria-valuemin={0}
        aria-valuemax={maxSupply}
        aria-valuenow={totalMinted}
        aria-valuetext={`${count(totalMinted)} of ${count(maxSupply)} minted`}
        className="bg-well shadow-inset flex h-3.5 gap-px overflow-hidden rounded-full"
      >
        {parts.map((part, index) => (
          <span
            key={part.key}
            className={cn('h-full first:rounded-l-full', shades[index % shades.length])}
            style={{ width: `${percent(part.value, maxSupply)}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[0.8125rem]">
        {parts.map((part, index) => (
          <li key={part.key} className="flex items-center gap-2">
            <span aria-hidden="true" className={cn('size-2 rounded-full', shades[index % shades.length])} />
            <span className="text-muted-foreground">{part.label}</span>
            <span className="numeric">{count(part.value)}</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="bg-well size-2 rounded-full border border-border-strong" />
          <span className="text-muted-foreground">Not minted</span>
          <span className="numeric">{count(remaining)}</span>
        </li>
      </ul>
    </div>
  )
}

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

export type ChecklistItem = {
  key: string
  done: boolean
  title: string
  detail: string
  href: string
  action: string
}

/** What still needs doing before the drop runs on its own. */
export function SetupChecklist({ items }: { items: ChecklistItem[] }) {
  const open = items.filter((item) => !item.done).length
  return (
    <div className="grid gap-1">
      <p className="text-muted-foreground mb-2 text-sm">
        {open === 0 ? 'Everything is set up.' : `${open} of ${items.length} still to do.`}
      </p>
      <ul className="grid gap-1">
        {items.map((item) => (
          <li key={item.key} className="flex gap-3 rounded-lg py-2">
            <span
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                item.done ? 'bg-success-soft text-success-foreground' : 'text-faint',
              )}
            >
              {item.done ? (
                <CheckIcon aria-hidden="true" className="size-3" strokeWidth={3} />
              ) : (
                <CircleIcon aria-hidden="true" className="size-4" />
              )}
              <span className="sr-only">{item.done ? 'Done:' : 'To do:'}</span>
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className={cn('font-medium', item.done && 'text-muted-foreground')}>{item.title}</p>
              <p className="text-muted-foreground text-[0.8125rem]">{item.detail}</p>
              {!item.done && (
                <Link
                  href={item.href}
                  className="focus-visible:ring-ring mt-1 inline-flex items-center gap-1 rounded-sm text-[0.8125rem] font-medium underline underline-offset-4 outline-none focus-visible:ring-2"
                >
                  {item.action}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
