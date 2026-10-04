'use client'

import { CircleAlertIcon, ClockIcon, InfoIcon, LockIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@cobweb/ui/components/alert-dialog'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import { Switch } from '@cobweb/ui/components/switch'
import { cn } from '@cobweb/ui/lib/utils'
import type { FlowLink } from '@/lib/steps'
import { RevealChoice, type RevealLaterState } from './reveal-later'
import { lockArt, type LockOptions } from './upload-sim'
import { tokenPreview, type ArtSummary } from './upload-shared'

const STRIP = 8
/** Duplicate groups listed before the rest are summed up. */
const DUPLICATES_SHOWN = 5

const fmt = (value: number) => value.toLocaleString('en-US')

/**
 * Review and lock. Opens with the reveal choice (Reveal at mint or Reveal later, with the
 * placeholder), then what will be locked and the lock options, then the lock itself. Supply and
 * rules are not listed as checks: a set that is short of the supply or breaks a rule cannot be
 * locked, and the footer says why, as Generate does. With deferred art (MASTER_PLAN, Flow:
 * pre-reveal) only the placeholder is locked in this run; the real set is locked later, from Art.
 */
export function ReviewStep({
  art,
  readOnly,
  previous,
  deferred,
  reveal,
  onReveal,
  lockOptions,
  onLockOptions,
  onLocked,
}: {
  art: ArtSummary
  readOnly: boolean
  /** The Generate screen, where the set is changed. */
  previous?: FlowLink
  /** The art is deferred: lock the placeholder alone. */
  deferred: boolean
  reveal: RevealLaterState
  onReveal: (next: RevealLaterState) => void
  lockOptions: LockOptions
  onLockOptions: (next: LockOptions) => void
  onLocked: (lockedAt: number) => void
}) {
  const id = useId()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [locking, setLocking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  async function lock() {
    controller.current = new AbortController()
    setError(null)
    setLocking(true)
    try {
      const result = await lockArt({
        lockOptions,
        duplicates: deferred ? [] : art.duplicates,
        signal: controller.current.signal,
      })
      setLocking(false)
      if (result.ok) onLocked(result.lockedAt)
      else setError(result.message)
    } catch {
      // Unmounted while locking.
    }
  }

  const duplicateTokens = art.duplicates.reduce((sum, group) => sum + group.length, 0)
  const showDuplicates = !deferred && !lockOptions.allowDuplicates && art.duplicates.length > 0
  const blocked = deferred
    ? null
    : art.tokens !== art.supply
      ? `The set has ${fmt(art.tokens)} tokens and the supply is ${fmt(art.supply)}. Match them in Generate first.`
      : art.breaking > 0
        ? `${fmt(art.breaking)} ${art.breaking === 1 ? 'token breaks' : 'tokens break'} the rules. Regenerate them in Generate first.`
        : showDuplicates
          ? `${fmt(duplicateTokens)} tokens are identical. Change them in Generate, or allow identical tokens.`
          : null
  const needsPlaceholder = reveal.on && !reveal.file
  const lockLabel = deferred ? 'Lock placeholder' : 'Lock art'

  return (
    <div className="divide-y">
      <RevealChoice state={reveal} onChange={onReveal} readOnly={readOnly || locking} />

      {deferred ? (
        <div className="p-6">
          <Alert>
            <ClockIcon aria-hidden="true" />
            <AlertTitle>Lock the real art later from Art</AlertTitle>
            <AlertDescription>
              <p>
                You are finishing the art later, so this run locks and renders only the placeholder. When the
                set is complete, continue from Generate to lock it. It is rendered to its own CID, and you
                reveal to it from Manage drop, Settings.
              </p>
              {previous && <BackLink link={previous} />}
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <>
          <section aria-labelledby={`${id}-locked`} className="space-y-5 p-6">
            <h4 id={`${id}-locked`} className="text-sm font-medium">
              What will be locked
            </h4>
            <ul aria-label="Sample tokens" className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {Array.from({ length: STRIP }, (_, index) => (
                <li key={index} className={cn(index >= 4 && 'hidden sm:block')}>
                  <Artwork
                    src={tokenPreview(index + 1)}
                    alt={`Token ${index + 1}`}
                    seed={`token-${index + 1}`}
                    className="border-border-strong rounded-lg border"
                  >
                    {index === STRIP - 1 && art.tokens > STRIP && (
                      <span className="bg-background/75 absolute inset-0 flex items-center justify-center text-[0.8125rem] font-medium backdrop-blur-[2px]">
                        <span className="numeric">+{fmt(art.tokens - STRIP)}</span>
                      </span>
                    )}
                  </Artwork>
                </li>
              ))}
            </ul>
            <StatGroup>
              <Stat label="Tokens" value={fmt(art.tokens)} />
              <Stat label="Collections" value={art.collections} />
              <Stat label="Layers" value={art.layers} />
              <Stat label="Traits" value={art.traits} />
              <Stat label="Rules" value={art.rules} />
            </StatGroup>
          </section>

          <section aria-labelledby={`${id}-options`} className="space-y-4 p-6">
            <h4 id={`${id}-options`} className="text-sm font-medium">
              Lock options
            </h4>
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-1">
                <label htmlFor={`${id}-duplicates`} className="text-sm font-medium">
                  Allow identical tokens
                </label>
                <p className="text-muted-foreground max-w-xl text-[0.8125rem] leading-snug">
                  {lockOptions.allowDuplicates
                    ? 'Tokens with the same traits are locked as they are.'
                    : 'Every token must have its own combination of traits. Turn this on if your project wants duplicates.'}
                </p>
              </div>
              <Switch
                id={`${id}-duplicates`}
                checked={lockOptions.allowDuplicates}
                disabled={readOnly || locking}
                onCheckedChange={(allowDuplicates) => onLockOptions({ ...lockOptions, allowDuplicates })}
              />
            </div>

            {showDuplicates && (
              <div className="bg-surface-2/50 space-y-2 rounded-lg border px-4 py-3 text-[0.8125rem] leading-snug">
                <p className="font-medium">Identical tokens</p>
                <ul className="text-muted-foreground space-y-1">
                  {art.duplicates.slice(0, DUPLICATES_SHOWN).map((group) => (
                    <li key={group.join('-')} className="numeric">
                      Tokens {group.map((tokenId) => `#${tokenId}`).join(', ')}
                    </li>
                  ))}
                  {art.duplicates.length > DUPLICATES_SHOWN && (
                    <li>and {fmt(art.duplicates.length - DUPLICATES_SHOWN)} more groups</li>
                  )}
                </ul>
                {previous && <BackLink link={previous} />}
              </div>
            )}

            <div className="flex items-start gap-3">
              <InfoIcon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Traits with a maximum count stay at or under it</p>
                <p className="text-muted-foreground text-[0.8125rem] leading-snug">
                  {art.constants.length
                    ? art.constants.map((entry, index) => (
                        <span key={entry.name}>
                          {index > 0 && ', '}
                          {entry.name} up to <span className="numeric">{entry.count}</span>
                        </span>
                      ))
                    : 'No trait in this set has a maximum count.'}
                </p>
              </div>
            </div>
          </section>
        </>
      )}

      {error && (
        <div className="p-6">
          <Alert variant="destructive">
            <XIcon aria-hidden="true" />
            <AlertTitle>The art was not locked</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              {previous && <BackLink link={previous} />}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 p-6">
        <p
          className={cn(
            'flex max-w-md items-start gap-2 text-[0.8125rem] leading-snug',
            blocked ? 'text-foreground/90' : 'text-muted-foreground',
          )}
        >
          {blocked ? (
            <CircleAlertIcon aria-hidden="true" className="text-warning mt-0.5 size-3.5 shrink-0" />
          ) : (
            <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          )}
          {blocked ??
            (needsPlaceholder
              ? 'Add a placeholder to lock with Reveal later, or choose Reveal at mint.'
              : deferred
                ? 'Locking the placeholder is final for this run. The art stays open until you lock the real set.'
                : 'Locking is final. After this you cannot edit the layers, traits, rules or tokens.')}
        </p>
        {!readOnly && (
          <Button onClick={() => setConfirmOpen(true)} disabled={locking || needsPlaceholder || !!blocked}>
            {locking ? <Spinner /> : <LockIcon />}
            {locking ? 'Locking' : error ? 'Lock again' : lockLabel}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deferred ? 'Lock the placeholder?' : 'Lock the art?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {deferred
                ? 'Cobweb stores the placeholder and its description, and the contract starts on it. The art stays open; you lock the real set later from Art.'
                : `Cobweb checks and stores these ${fmt(art.tokens)} tokens exactly as they are now. You cannot edit the layers, traits, rules or tokens afterwards, and the generation fee is quoted from this supply.`}
              {!deferred && lockOptions.allowDuplicates && ' Identical tokens are allowed.'}
              {!deferred && reveal.on && ' The contract will start on the placeholder.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={lock}>
              <LockIcon />
              {lockLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function BackLink({ link }: { link: FlowLink }) {
  return (
    <Link href={link.href} className="text-foreground underline underline-offset-4">
      Go to {link.name}
    </Link>
  )
}
