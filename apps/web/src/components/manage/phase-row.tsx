'use client'

import { MoreHorizontalIcon } from 'lucide-react'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@cobweb/ui/components/dropdown-menu'
import { Progress } from '@cobweb/ui/components/progress'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
import { formatNative, type MintGroup, type SupportedChain } from '@/lib/demo'
import { count, percent, relativeTo, shortUtc } from './format'

export type PhaseAction = 'open' | 'close' | 'schedule' | 'clear' | 'price' | 'supply' | 'cap'

/** Column template shared by the header and every row, once the list is 56rem wide. */
export const PHASE_COLUMNS =
  '@4xl:grid-cols-[minmax(8rem,1.2fr)_7rem_minmax(10rem,1fr)_5rem_minmax(9rem,0.9fr)_9rem]'

/**
 * One phase. Its state is the chain's `active` field and nothing else: a scheduled start is
 * shown as a time, and the badge says Scheduled until the chain reports the phase live.
 */
export function PhaseRow({
  group,
  chain,
  blockTimestamp,
  publicCap,
  onAction,
}: {
  group: MintGroup
  chain: SupportedChain
  blockTimestamp: number
  publicCap: number
  onAction: (action: PhaseAction) => void
}) {
  const full = group.minted >= group.maxSupply
  const status = group.active ? 'live' : group.scheduledStart > 0 ? 'scheduled' : 'closed'
  return (
    <li
      className={cn(
        'relative grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-5 @xl:grid-cols-4 @4xl:items-center @4xl:gap-y-0 @4xl:px-6',
        PHASE_COLUMNS,
        group.active && 'bg-primary-soft/40',
      )}
    >
      {group.active && <span aria-hidden="true" className="bg-primary absolute inset-y-0 left-0 w-0.5" />}

      <div className="col-span-2 flex min-w-0 items-center gap-3 @xl:col-span-4 @4xl:col-span-1">
        <div className="min-w-0">
          <p className="text-heading truncate">{group.name}</p>
          <p className="text-muted-foreground flex items-center gap-2 text-[0.8125rem]">
            {group.kind === 'public' ? 'Public' : 'Whitelist'}
            <span aria-hidden="true" className="bg-faint size-0.5 rounded-full" />
            <span className="numeric">Group {group.id}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 @4xl:hidden">
          <StatusBadge status={status} />
        </div>
      </div>

      <Cell label="Price">
        <span className="numeric">{formatNative(group.priceWei, chain.nativeSymbol)}</span>
      </Cell>

      <Cell label="Minted of allocation">
        <div className="grid gap-1.5">
          <p className="numeric text-sm">
            <span className={cn(group.active && 'text-primary')}>{count(group.minted)}</span>
            <span className="text-muted-foreground"> / {count(group.maxSupply)}</span>
            {full && (
              <Badge variant="success" className="ml-2 h-5 align-middle">
                Full
              </Badge>
            )}
          </p>
          <Progress
            size="sm"
            value={percent(group.minted, group.maxSupply)}
            aria-label={`${group.name}: ${count(group.minted)} of ${count(group.maxSupply)} minted`}
          />
        </div>
      </Cell>

      <Cell label="Per wallet">
        {group.kind === 'public' ? (
          <span className="numeric">{publicCap}</span>
        ) : (
          <span className="text-muted-foreground text-[0.8125rem]">Quota</span>
        )}
      </Cell>

      <Cell label="Status" className="col-span-2 @xl:col-span-1">
        <div className="grid gap-1">
          <StatusBadge status={status} className="hidden @4xl:inline-flex" />
          {group.scheduledStart > 0 ? (
            <p className="text-muted-foreground text-[0.8125rem]">
              <span className="numeric text-foreground">{shortUtc(group.scheduledStart)}</span>
              <br />
              {group.scheduledStart > blockTimestamp ? 'Opens' : 'Start was'}{' '}
              {relativeTo(group.scheduledStart, blockTimestamp)}
            </p>
          ) : (
            <p className="text-muted-foreground text-[0.8125rem]">
              {group.active ? 'Opened by hand' : 'No start set'}
            </p>
          )}
        </div>
      </Cell>

      <div className="col-span-2 flex items-center justify-end gap-2 @xl:col-span-4 @4xl:col-span-1">
        {group.active ? (
          <Button variant="outline" size="sm" onClick={() => onAction('close')}>
            Close
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => onAction('open')}>
            Open now
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${group.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={group.active} onSelect={() => onAction('schedule')}>
              {group.scheduledStart > 0 ? 'Change scheduled start' : 'Schedule start'}
            </DropdownMenuItem>
            {group.scheduledStart > 0 && !group.active && (
              <DropdownMenuItem onSelect={() => onAction('clear')}>Clear schedule</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction('price')}>Edit price</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction('supply')}>Edit max supply</DropdownMenuItem>
            {group.kind === 'public' && (
              <DropdownMenuItem onSelect={() => onAction('cap')}>Edit per-wallet limit</DropdownMenuItem>
            )}
            {group.active && (
              <p className="text-muted-foreground px-2 py-1.5 text-xs">Close the phase to schedule it.</p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

function Cell({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0 text-sm', className)}>
      <p className="text-muted-foreground mb-1 text-xs font-medium @4xl:sr-only">{label}</p>
      {children}
    </div>
  )
}
