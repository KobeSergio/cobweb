'use client'

import { ArrowDownIcon, ExternalLinkIcon, RotateCwIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Progress } from '@cobweb/ui/components/progress'
import { Skeleton } from '@cobweb/ui/components/skeleton'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { explorerAddressUrl, formatNative, shortAddress } from '@/lib/demo/helpers'
import { ChainName } from '@/components/chains/chain-icon'
import { Countdown } from './countdown'
import { MintButton, MintHint } from './mint-action'
import { useMint } from './mint-context'
import { RemindMe } from './remind-me'
import { Eligibility, PhasePicker, PriceBreakdown, QuantityStepper, VaultPicker } from './panel-controls'
import { useHydrated, useLocalTime } from './use-chain-clock'

/** What the panel says in place of the button once the server refused the collection for this page load. */
const REFUSALS = {
  'not-a-collection': 'This contract could not be confirmed on its chain yet. Reload the page in a minute.',
  unavailable: 'Live status is not available for this collection right now.',
} as const

/** The mint menu: who and what, how much is left, the phase, what this wallet can do, one button. */
export function MintPanel() {
  const {
    page,
    live: state,
    track,
    waitingLong,
    phases,
    phase,
    minted,
    soldOut,
    walletAddress,
    walletFinal,
    quantity,
    maxQuantity,
  } = useMint()
  const chain = page.chain
  if (track.final) return <Refused reason={track.final} />
  if (!state) return <Reading slow={waitingLong} />
  const live = phases.filter((entry) => entry.status === 'live')
  const max = state.supply.max
  const percent = max > 0 ? Math.floor((minted / max) * 100) : 0
  const picking = live.length > 1 && phase?.status === 'live'

  const overall = soldOut
    ? ({ status: 'soldout', label: 'Sold out' } as const)
    : live.length > 0
      ? ({ status: 'live', label: 'Minting now' } as const)
      : phase?.status === 'starting'
        ? ({ status: 'pending', label: 'Starting' } as const)
        : phase?.status === 'scheduled'
          ? ({ status: 'scheduled', label: 'Upcoming' } as const)
          : ({ status: 'closed', label: 'Paused' } as const)

  return (
    <section
      id="mint"
      aria-labelledby="collection-name"
      className="relative rounded-xl border border-border-strong bg-card p-5 shadow-lifted sm:p-6 xl:p-7"
    >
      <div className="flex items-center justify-between gap-3">
        <StatusBadge status={overall.status}>{overall.label}</StatusBadge>
        <ChainName
          chain={chain}
          className="text-[0.8125rem] text-muted-foreground"
          iconClassName="size-3.5"
        />
      </div>

      <h1
        id="collection-name"
        className="mt-4 text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[2.75rem]"
      >
        {page.name}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        by{' '}
        {chain.explorerUrl ? (
          <a
            href={explorerAddressUrl(chain, state.creator)}
            target="_blank"
            rel="noreferrer"
            className="numeric text-foreground underline-offset-4 hover:underline"
          >
            {shortAddress(state.creator)}
          </a>
        ) : (
          <span className="numeric text-foreground">{shortAddress(state.creator)}</span>
        )}
      </p>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p>
            <span className="numeric text-lg font-medium">{minted.toLocaleString('en-US')}</span>
            <span className="text-muted-foreground"> of </span>
            <span className="numeric text-muted-foreground">{max.toLocaleString('en-US')}</span>
            <span className="text-muted-foreground"> minted</span>
          </p>
          <p className="numeric text-[0.8125rem] text-muted-foreground">{percent}%</p>
        </div>
        <Progress
          value={max > 0 ? (minted / max) * 100 : 0}
          size="sm"
          className="mt-2.5"
          aria-label={`${minted} of ${max} minted`}
        />
      </div>

      <div className="mt-5 space-y-4 border-t pt-5">
        {soldOut ? (
          <SoldOut />
        ) : !phase ? (
          <Paused />
        ) : (
          <>
            {picking && <PhasePicker live={live} />}
            {(phase.status === 'scheduled' || phase.status === 'starting') && <Upcoming />}
            <PhasePrice />
            {/* The picker's cards already say where this wallet stands in each open phase. */}
            {walletAddress && !picking && <Eligibility phase={phase} />}
            {walletAddress && <VaultPicker phase={phase} />}
            {phase.status === 'live' && walletAddress && maxQuantity > 0 && <QuantityStepper />}
            {((phase.status === 'live' && (!walletAddress || maxQuantity > 0)) ||
              (!walletAddress && phase.status !== 'live')) && (
              <PriceBreakdown phase={phase} quantity={walletAddress && maxQuantity > 0 ? quantity : 1} />
            )}
          </>
        )}
      </div>

      <div className="mt-5 space-y-3" data-mint-action>
        {walletFinal && !soldOut ? (
          // The wallet's read was refused for this page load, so what it can mint is not known: no button.
          <p role="status" className="text-center text-sm leading-relaxed text-muted-foreground">
            {REFUSALS.unavailable}
          </p>
        ) : (
          <>
            {!soldOut && <MintButton />}
            <MintHint />
          </>
        )}
      </div>
    </section>
  )
}

/** Before the first answer: the panel's shape, and the button reading "Reading the chain". */
function Reading({ slow }: { slow: boolean }) {
  const { page } = useMint()
  return (
    <section
      id="mint"
      aria-labelledby="collection-name"
      aria-busy="true"
      className="relative rounded-xl border border-border-strong bg-card p-5 shadow-lifted sm:p-6 xl:p-7"
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-6 w-28 rounded-full" />
        <ChainName
          chain={page.chain}
          className="text-[0.8125rem] text-muted-foreground"
          iconClassName="size-3.5"
        />
      </div>
      <h1
        id="collection-name"
        className="mt-4 text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[2.75rem]"
      >
        {page.name}
      </h1>
      <Skeleton className="mt-3 h-4 w-32" />
      <Skeleton className="mt-6 h-4 w-full" />
      <Skeleton className="mt-3 h-1 w-full rounded-full" />
      <div className="mt-5 space-y-4 border-t pt-5">
        <div className="flex justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="mt-5 space-y-3" data-mint-action>
        <MintButton />
        <p aria-live="polite" className="text-center text-[0.8125rem] leading-snug text-muted-foreground">
          {slow ? 'Live status is taking longer than usual. This page keeps trying.' : 'Reading the chain.'}
        </p>
      </div>
    </section>
  )
}

/** The server refused the collection for this page load: what it means, and no mint button. */
function Refused({ reason }: { reason: keyof typeof REFUSALS }) {
  const { page } = useMint()
  return (
    <section
      id="mint"
      aria-labelledby="collection-name"
      className="relative rounded-xl border border-border-strong bg-card p-5 shadow-lifted sm:p-6 xl:p-7"
    >
      <div className="flex items-center justify-end gap-3">
        <ChainName
          chain={page.chain}
          className="text-[0.8125rem] text-muted-foreground"
          iconClassName="size-3.5"
        />
      </div>
      <h1
        id="collection-name"
        className="mt-4 text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[2.75rem]"
      >
        {page.name}
      </h1>
      <p role="status" className="mt-5 border-t pt-5 text-sm leading-relaxed text-muted-foreground">
        {REFUSALS[reason]}
      </p>
      {reason === 'not-a-collection' && (
        <Button variant="secondary" className="mt-5 w-full" onClick={() => window.location.reload()}>
          <RotateCwIcon />
          Reload
        </Button>
      )}
    </section>
  )
}

function PhasePrice() {
  const { phase, page } = useMint()
  if (!phase) return null
  const free = phase.group.priceWei === '0'
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="text-sm font-semibold">
          {phase.group.name}
          <span className="ml-2 font-normal text-muted-foreground">
            {phase.group.kind === 'public' ? 'Public sale' : 'Whitelist'}
          </span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="numeric">{phase.remainingSupply.toLocaleString('en-US')}</span> of{' '}
          <span className="numeric">{phase.group.maxSupply.toLocaleString('en-US')}</span> left in this phase
        </p>
      </div>
      <p className="text-right">
        <span className="numeric block text-[1.75rem] leading-none font-medium">
          {free ? 'Free' : formatNative(phase.group.priceWei, page.chain.nativeSymbol)}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">per token</span>
      </p>
    </div>
  )
}

function Upcoming() {
  const { phase } = useMint()
  const when = useLocalTime(phase?.group.scheduledStart ?? 0)
  const hydrated = useHydrated()
  if (!phase) return null
  if (phase.status === 'starting') {
    return (
      <div role="status" className="rounded-lg border border-border-strong bg-surface-2 p-4">
        <p className="flex items-center gap-2.5 text-sm font-medium">
          <span aria-hidden="true" className="relative flex size-2">
            <span className="animate-live-pulse absolute inset-0 rounded-full bg-warning" />
            <span className="relative size-2 rounded-full bg-warning" />
          </span>
          Starting, waiting for the chain
        </p>
        <p className="mt-1.5 text-[0.8125rem] leading-snug text-muted-foreground">
          {phase.group.name} was scheduled for {when}. It opens the moment the chain reports it live, usually
          within a few seconds.
        </p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{phase.group.name}</span> opens in
      </p>
      <Countdown seconds={phase.startsIn ?? 0} className="mt-3" />
      <p className="mt-3 text-[0.8125rem] text-muted-foreground">
        <span className="numeric">{when}</span>
        {hydrated && ', your time'}
      </p>
      <RemindMe phase={phase} className="mt-3" />
      <p className="sr-only" role="status">
        {phase.group.name} opens {when}.
      </p>
    </div>
  )
}

function SoldOut() {
  const { page, live } = useMint()
  const chain = page.chain
  return (
    <div>
      <p className="text-title">
        Every one of the {(live?.supply.max ?? 0).toLocaleString('en-US')} is minted.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {page.name} sold out. Thank you to everyone who minted. Tokens now change hands between holders.
      </p>
      <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
        {chain.explorerUrl && (
          <Button asChild variant="secondary">
            <a href={`${chain.explorerUrl}/token/${page.contract}`} target="_blank" rel="noreferrer">
              Holders on the explorer
              <ExternalLinkIcon />
            </a>
          </Button>
        )}
        <Button asChild variant="outline">
          <a href="#gallery">
            See the collection
            <ArrowDownIcon />
          </a>
        </Button>
      </div>
    </div>
  )
}

function Paused() {
  const { phases } = useMint()
  const finished = phases.filter((entry) => entry.status === 'closed' || entry.status === 'soldout')
  return (
    <div>
      <p className="text-heading">Minting is paused between phases</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {finished.length > 0
          ? `${listNames(finished.map((entry) => entry.group.name))} ${finished.length === 1 ? 'has' : 'have'} closed. `
          : ''}
        Nothing is scheduled yet. When the creator opens the next phase, it shows here without a refresh.
      </p>
    </div>
  )
}

/** `A`, `A and B`, `A, B and C`. */
function listNames(names: string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
