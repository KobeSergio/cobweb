'use client'

import { EyeOffIcon, MoreHorizontalIcon, PencilIcon } from 'lucide-react'
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
import { NAME_FIRST } from '@/lib/art/result'
import { formatNative, type MintGroup, type SupportedChain } from '@/lib/demo'
import { count, percent, relativeTo, shortUtc } from './format'

export type PhaseAction =
  | 'open'
  | 'close'
  | 'schedule'
  | 'clear'
  | 'price'
  | 'supply'
  | 'cap'
  | 'details'
  | 'up'
  | 'down'
  | 'hide'
  | 'show'

/** Column template shared by the header and every row, once the list is 56rem wide. */
export const PHASE_COLUMNS =
  '@4xl:grid-cols-[minmax(8rem,1.2fr)_7rem_minmax(10rem,1fr)_5rem_minmax(9rem,0.9fr)_9rem]'

/** Why the on-chain controls are off while the contract cannot be read. */
export const UNREADABLE_REASON = 'The contract could not be read, so changes on chain wait until it can be.'

/**
 * One phase (docs/specs/2026-10-15-phases.md, section 7.4). Its state is the chain's `active` field and
 * nothing else: a scheduled start is shown as a time, and the badge says Scheduled until the chain reports
 * the phase live. A group the chain lists without a row reads "Group N", "Not named", until it is named.
 * While the contract cannot be read, status and minted counts are not shown and the on-chain controls are
 * off; naming, hiding and moving still work.
 */
export function PhaseRow({
  group,
  chain,
  now,
  publicCap,
  reachable,
  first,
  last,
  onAction,
}: {
  group: MintGroup
  chain: SupportedChain
  /** The chain's estimated time, for "Opens in" labels only. */
  now: number
  publicCap: number
  /** False while the view is the copy. */
  reachable: boolean
  /** Its place among the named phases, for Move up and Move down. */
  first: boolean
  last: boolean
  onAction: (action: PhaseAction) => void
}) {
  const named = group.named !== false
  const full = reachable && group.minted >= group.maxSupply
  const status = group.active ? 'live' : group.scheduledStart > 0 ? 'scheduled' : 'closed'
  const offChain = reachable ? undefined : UNREADABLE_REASON
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
          <p className="text-heading flex items-center gap-2">
            <span className="truncate">{group.name}</span>
            {!named && (
              <Badge variant="outline" className="h-5 shrink-0">
                Not named
              </Badge>
            )}
            {group.visible === false && (
              <Badge variant="secondary" className="h-5 shrink-0">
                <EyeOffIcon aria-hidden="true" />
                Hidden
              </Badge>
            )}
          </p>
          <p className="text-muted-foreground flex items-center gap-2 text-[0.8125rem]">
            {group.kind === 'public' ? 'Public' : 'Whitelist'}
            <span aria-hidden="true" className="bg-faint size-0.5 rounded-full" />
            <span className="numeric">Group {group.id}</span>
          </p>
          {group.description && (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-[0.8125rem]" title={group.description}>
              {group.description}
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 @4xl:hidden">
          {reachable ? <StatusBadge status={status} /> : <StatusBadge status="draft">Not read</StatusBadge>}
        </div>
      </div>

      <Cell label="Price">
        <span className="numeric">{formatNative(group.priceWei, chain.nativeSymbol)}</span>
      </Cell>

      <Cell label="Minted of allocation">
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2">
            <p className="numeric text-sm">
              {reachable ? (
                <span className={cn(group.active && 'text-primary')}>{count(group.minted)}</span>
              ) : (
                <span className="text-muted-foreground font-sans">Not read</span>
              )}
              <span className="text-muted-foreground"> / {count(group.maxSupply)}</span>
            </p>
            {full && (
              <Badge variant="success" className="h-5">
                Full
              </Badge>
            )}
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground -my-1 ml-auto"
              onClick={() => onAction('supply')}
              disabled={!reachable}
              title={offChain}
              aria-label={`Edit supply for ${group.name}`}
            >
              <PencilIcon aria-hidden="true" />
              Edit
            </Button>
          </div>
          {reachable && (
            <Progress
              size="sm"
              value={percent(group.minted, group.maxSupply)}
              aria-label={`${group.name}: ${count(group.minted)} of ${count(group.maxSupply)} minted`}
            />
          )}
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
          {reachable ? (
            <StatusBadge status={status} className="hidden @4xl:inline-flex" />
          ) : (
            <StatusBadge status="draft" className="hidden @4xl:inline-flex">
              Not read
            </StatusBadge>
          )}
          {group.scheduledStart > 0 ? (
            <p className="text-muted-foreground text-[0.8125rem]">
              <span className="numeric text-foreground">{shortUtc(group.scheduledStart)}</span>
              <br />
              {group.scheduledStart > now ? 'Opens' : 'Start was'} {relativeTo(group.scheduledStart, now)}
            </p>
          ) : (
            <p className="text-muted-foreground text-[0.8125rem]">
              {reachable && group.active ? 'Opened by hand' : 'No start set'}
            </p>
          )}
        </div>
      </Cell>

      <div className="col-span-2 flex items-center justify-end gap-2 @xl:col-span-4 @4xl:col-span-1">
        {group.active ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAction('close')}
            disabled={!reachable}
            title={offChain}
          >
            Close
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAction('open')}
            disabled={!reachable}
            title={offChain}
          >
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
            <DropdownMenuItem onSelect={() => onAction('details')}>
              {named ? 'Edit details' : 'Name this phase'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!named || first} onSelect={() => onAction('up')}>
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!named || last} onSelect={() => onAction('down')}>
              Move down
            </DropdownMenuItem>
            {group.kind !== 'public' && (
              <DropdownMenuItem
                disabled={!named}
                onSelect={() => onAction(group.visible === false ? 'show' : 'hide')}
              >
                {group.visible === false ? 'Show on the mint page' : 'Hide from the mint page'}
              </DropdownMenuItem>
            )}
            {!named && <p className="text-muted-foreground px-2 py-1.5 text-xs">{NAME_FIRST}</p>}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!reachable || group.active} onSelect={() => onAction('schedule')}>
              {group.scheduledStart > 0 ? 'Change scheduled start' : 'Schedule start'}
            </DropdownMenuItem>
            {group.scheduledStart > 0 && !group.active && (
              <DropdownMenuItem disabled={!reachable} onSelect={() => onAction('clear')}>
                Clear schedule
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!reachable} onSelect={() => onAction('price')}>
              Edit price
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!reachable} onSelect={() => onAction('supply')}>
              Edit max supply
            </DropdownMenuItem>
            {group.kind === 'public' && (
              <DropdownMenuItem disabled={!reachable} onSelect={() => onAction('cap')}>
                Edit per-wallet limit
              </DropdownMenuItem>
            )}
            {!reachable && <p className="text-muted-foreground px-2 py-1.5 text-xs">{UNREADABLE_REASON}</p>}
            {reachable && group.active && (
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
