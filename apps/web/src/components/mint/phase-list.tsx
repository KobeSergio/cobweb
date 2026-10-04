'use client'

import { CircleCheckIcon, CircleMinusIcon } from 'lucide-react'
import { StatusBadge, type Status } from '@cobweb/ui/components/status-badge'
import { cn } from '@cobweb/ui/lib/utils'
import { formatNative } from '@/lib/demo/helpers'
import { formatCountdown } from './format'
import { useMint } from './mint-context'
import { sortPhases, type Phase, type PhaseStatus } from './model'
import { useHydrated, useLocalTime } from './use-chain-clock'

const BADGE: Record<PhaseStatus, { status: Status; label: string }> = {
  live: { status: 'live', label: 'Live' },
  scheduled: { status: 'scheduled', label: 'Scheduled' },
  starting: { status: 'pending', label: 'Starting' },
  soldout: { status: 'soldout', label: 'Sold out' },
  closed: { status: 'closed', label: 'Closed' },
  unscheduled: { status: 'draft', label: 'Not scheduled' },
}

const GROUPS = [
  { title: 'Open now', match: ['live'] },
  { title: 'Coming up', match: ['starting', 'scheduled', 'unscheduled'] },
  { title: 'Finished', match: ['closed', 'soldout'] },
] as const

/** Every phase, grouped by now, next and done, with what it means for the connected wallet. */
export function PhaseList() {
  const { phases, phase: selected } = useMint()
  const sorted = sortPhases(phases)
  const liveCount = phases.filter((entry) => entry.status === 'live').length

  return (
    <section aria-labelledby="phases-title" className="mt-10">
      <h2 id="phases-title" className="text-heading">
        Phases
      </h2>
      <div className="mt-4 space-y-6">
        {GROUPS.map((group) => {
          const items = sorted.filter((entry) => (group.match as readonly string[]).includes(entry.status))
          if (items.length === 0) return null
          return (
            <div key={group.title}>
              <h3 className="mb-2.5 text-[0.8125rem] font-medium text-muted-foreground">{group.title}</h3>
              {group.title === 'Open now' && liveCount > 1 && (
                <p className="mb-3 text-[0.8125rem] leading-snug text-muted-foreground">
                  These phases overlap: both are open at the same time, each with its own price and limit.
                </p>
              )}
              <ol className="relative space-y-2.5">
                {items.map((entry) => (
                  <PhaseRow
                    key={entry.group.id}
                    phase={entry}
                    selected={entry.group.id === selected?.group.id}
                  />
                ))}
              </ol>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PhaseRow({ phase, selected }: { phase: Phase; selected: boolean }) {
  const { data, wallet } = useMint()
  const { group, status } = phase
  const when = useLocalTime(group.scheduledStart)
  const hydrated = useHydrated()
  const minted = group.maxSupply - phase.remainingSupply
  const fill = Math.min(100, (minted / group.maxSupply) * 100)
  const badge = BADGE[status]
  const symbol = data.collection.chain.nativeSymbol

  return (
    <li
      className={cn(
        'rounded-xl border bg-card/60 px-4 py-3.5 transition-colors',
        status === 'live' ? 'border-primary-line' : 'border-border',
        selected && status === 'live' && 'bg-card',
        (status === 'closed' || status === 'soldout') && 'bg-transparent',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold">
          {group.name}
          <span className="ml-2 font-normal text-muted-foreground">
            {group.kind === 'public' ? 'Public sale' : 'Whitelist'}
          </span>
        </p>
        <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
      </div>

      <dl className="mt-2.5 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-[0.8125rem]">
        <dt className="sr-only">Price</dt>
        <dd className="numeric text-foreground">
          {group.priceWei === '0' ? 'Free' : formatNative(group.priceWei, symbol)}
        </dd>
        <dt className="sr-only">Minted of allocation</dt>
        <dd className="flex items-center justify-end gap-2.5 text-muted-foreground">
          <span aria-hidden="true" className="relative h-1 w-16 overflow-hidden rounded-full bg-well">
            <span
              className={cn(
                'absolute inset-y-0 left-0 rounded-full',
                status === 'live' ? 'bg-primary' : 'bg-faint',
              )}
              style={{ width: `${fill}%` }}
            />
          </span>
          <span className="numeric">
            {minted.toLocaleString('en-US')} / {group.maxSupply.toLocaleString('en-US')}
          </span>
        </dd>
      </dl>

      {(status === 'scheduled' || status === 'starting') && (
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">
          {status === 'starting' ? (
            'Start time reached, waiting for the chain'
          ) : (
            <>
              Opens <span className="text-foreground">{when}</span>
              {hydrated && ' your time'}, in{' '}
              <span className="numeric text-foreground">{formatCountdown(phase.startsIn ?? 0)}</span>
            </>
          )}
        </p>
      )}
      {status === 'unscheduled' && (
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">The creator has not set a start yet.</p>
      )}

      {wallet && group.kind === 'whitelist' && phase.wallet && (
        <p
          className={cn(
            'mt-2 flex items-center gap-1.5 text-[0.8125rem]',
            phase.wallet.eligible ? 'text-success-foreground' : 'text-muted-foreground',
          )}
        >
          {phase.wallet.eligible ? (
            <CircleCheckIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <CircleMinusIcon aria-hidden="true" className="size-3.5" />
          )}
          {phase.wallet.eligible ? (
            <span>
              You are on this list.{' '}
              <span className="numeric">
                {phase.wallet.used} of {phase.wallet.quota}
              </span>{' '}
              minted
            </span>
          ) : (
            'This wallet is not on this list'
          )}
        </p>
      )}
      {wallet &&
        group.kind === 'public' &&
        phase.wallet &&
        (status === 'live' || status === 'scheduled' || status === 'starting') && (
          <p className="mt-2 text-[0.8125rem] text-muted-foreground">
            Anyone can mint.{' '}
            <span className="numeric">
              {phase.wallet.used} of {phase.wallet.quota}
            </span>{' '}
            minted by you
          </p>
        )}
    </li>
  )
}
