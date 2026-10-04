'use client'

import { ArrowRightLeftIcon, WalletIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import { ChainName } from '@/components/chains/chain-icon'
import { formatDistance } from './format'
import { useMint } from './mint-context'
import { allowanceFor, maxQuantity } from './model'
import { useHydrated, useLocalTime } from './use-chain-clock'

/**
 * The one primary button. Its label always says what will happen, or why nothing can. It is
 * yellow only when it will do something; a reason (sold out, not listed, starts in ...) sits on a
 * quiet graphite button instead of a faded yellow one.
 */
export function MintButton({ className, size = 'lg' }: { className?: string; size?: 'lg' | 'default' }) {
  const { action, act, flow, switching } = useMint()
  const busy = flow.step !== 'idle' && flow.step !== 'success' && flow.step !== 'error'
  const blocked = action.kind === 'blocked'
  return (
    <Button
      size={size}
      onClick={act}
      disabled={blocked || busy || switching}
      aria-disabled={blocked || undefined}
      className={cn(
        'w-full',
        size === 'lg' && 'h-14 text-base',
        blocked &&
          'disabled:border disabled:border-border-strong disabled:bg-surface-2 disabled:font-medium disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none',
        className,
      )}
    >
      {switching ? <Spinner /> : action.kind === 'connect' ? <WalletIcon /> : null}
      {action.kind === 'switch' && !switching && <ArrowRightLeftIcon />}
      {switching ? 'Switching network' : <ActionLabel label={action.label} />}
    </Button>
  )
}

/** Sets the amount or the countdown inside a label in the numeric face. */
function ActionLabel({ label }: { label: string }) {
  const match = /^(Mint \d+ for |Starts in )(.+)$/.exec(label)
  if (!match) return <span>{label}</span>
  return (
    <span>
      {match[1]}
      <span className="numeric">{match[2]}</span>
    </span>
  )
}

/** The line under the button: what the visitor's status means and what happens next. */
export function MintHint({ className }: { className?: string }) {
  const { action, phase, phases, data, vault, wallet } = useMint()
  const nextPublic = phases.find((entry) => entry.group.kind === 'public')
  const publicTime = useLocalTime(nextPublic?.group.scheduledStart ?? 0)
  const phaseTime = useLocalTime(phase?.group.scheduledStart ?? 0)
  const hydrated = useHydrated()

  const lineClass = cn('text-center text-[0.8125rem] leading-snug text-muted-foreground', className)
  if (action.kind === 'switch') {
    return (
      <p aria-live="polite" className={lineClass}>
        This collection is on{' '}
        <ChainName chain={data.collection.chain} className="text-foreground" iconClassName="size-3.5" />. Your
        wallet will ask you to switch.
      </p>
    )
  }

  let text: string | null = null
  if (action.kind === 'connect') {
    text = 'Connect to see what you can mint in each phase.'
  } else if (action.kind === 'mint' && phase) {
    const left = maxQuantity(phase, vault)
    text = vault
      ? `The vault can mint ${left} more in this phase. Tokens arrive in this wallet.`
      : `You can mint ${left} more in this phase.`
  } else if (phase && action.label.startsWith('Starts')) {
    text = `${phase.group.name} opens ${phaseTime}${hydrated ? ', your time' : ''}.`
  } else if (phase?.status === 'starting') {
    text = 'The start time has passed. Minting opens as soon as the chain confirms the phase is live.'
  } else if (action.label === 'Minting is paused') {
    text = 'No phase is open right now. This page updates by itself when the creator opens the next one.'
  } else if (action.label === 'Not on the whitelist for this phase' && phase) {
    if (nextPublic?.status === 'live') text = 'Public is open to everyone. Choose it above to mint.'
    else if (nextPublic && (nextPublic.status === 'scheduled' || nextPublic.status === 'starting')) {
      text = `Public opens ${publicTime}${nextPublic.startsIn && nextPublic.startsIn > 0 ? ` (in ${formatDistance(nextPublic.startsIn)})` : ''}. Anyone can mint then.`
    } else text = `${phase.group.name} is for wallets on its list.`
  } else if (action.label.endsWith('limit reached') && phase) {
    const own = allowanceFor(phase, vault)
    const other = phases.find(
      (entry) =>
        entry !== phase && entry.status === 'live' && entry.wallet?.eligible && entry.wallet.remaining > 0,
    )
    text = `${vault ? 'The vault has' : 'You have'} minted ${own?.used ?? 0} of ${own?.quota ?? 0} in ${phase.group.name}.`
    if (other) text += ` ${other.group.name} still has ${other.wallet!.remaining} for you.`
    else if (nextPublic && nextPublic !== phase && nextPublic.status === 'scheduled' && wallet) {
      text += ` Public opens ${publicTime}.`
    }
  } else if (action.label === 'Phase sold out') {
    text = 'Every token in this phase is minted.'
  }

  if (!text) return null
  return (
    <p aria-live="polite" className={lineClass}>
      {text}
    </p>
  )
}
