'use client'

import { CheckIcon, CircleAlertIcon, ClockIcon, InfoIcon, LockIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import { useAccount } from 'wagmi'
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
import { SUPPLY_MISMATCH, THROWN } from '@/lib/art/result'
import { lockRefusal, reviewChecks, type ReviewData } from '@/lib/art/lock-review'
import type { RenderJob } from '@/lib/demo/types'
import type { FlowLink } from '@/lib/steps'
import { RevealChoice, type RevealLaterState } from './reveal-later'
import type { UploadActions } from './upload-shared'
import type { LockOptions } from './upload-sim'

const STRIP = 8
const CONNECT_TO_LOCK = 'Connect your wallet to choose the network the fee is paid on.'

const fmt = (value: number) => value.toLocaleString('en-US')

/** The sample strip's preview for a token id. Only 24 sample images exist, so ids past 24 reuse them. */
const tokenPreview = (id: number) => `/demo/tokens/${((id - 1) % 24) + 1}.svg`

/**
 * Review and lock. Opens with the reveal choice (Reveal at mint or Reveal later, with the
 * placeholder), then what will be locked with the four checks from `reviewArt` (supply, unique
 * tokens, rules, maximum counts) and the lock options, then the lock itself. "Allow identical
 * tokens" is offered only when duplicates are the only problem. With deferred art (MASTER_PLAN,
 * Flow: pre-reveal) only the placeholder is locked, at no cost; the real set is locked later.
 */
export function ReviewStep({
  review,
  previews,
  readOnly,
  previous,
  deferred,
  reveal,
  onReveal,
  lockOptions,
  onLockOptions,
  actions,
  collectionChainId,
  sample,
  assetsFlow,
  onLocked,
}: {
  review: ReviewData
  /** Show the strip of sample token images (sample mode; real tokens have no image before rendering). */
  previews: boolean
  readOnly: boolean
  /** The screen before this one, where the set is changed. */
  previous?: FlowLink
  /** The art is deferred: lock the placeholder alone. */
  deferred: boolean
  reveal: RevealLaterState
  onReveal: (next: RevealLaterState) => void
  lockOptions: LockOptions
  onLockOptions: (next: LockOptions) => void
  actions: UploadActions
  /** `collections.chain_id`, when the collection has one. */
  collectionChainId: number | null
  sample: boolean
  /** A 1/1 or single asset project: there is no Generate step, the supply is saved on Assets. */
  assetsFlow: boolean
  onLocked: (job: RenderJob) => void
}) {
  const id = useId()
  const { chainId } = useAccount()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [locking, setLocking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lockChain = collectionChainId ?? chainId

  /** The server's lock refusal, with its fix named for this project type. */
  const refused = (message: string) =>
    setError(
      assetsFlow && message === SUPPLY_MISMATCH
        ? SUPPLY_MISMATCH.replace('Generate again.', 'Save the supply again.')
        : message,
    )

  async function lock() {
    setError(null)
    setLocking(true)
    try {
      if (deferred) {
        const result = await actions.lockPlaceholder(reveal.file?.uploadId ?? null)
        if (result.ok) onLocked(result.data)
        else refused(result.error)
        return
      }
      // Reveal at mint: a placeholder file stored earlier is not part of this lock.
      if (!reveal.on && reveal.file?.uploadId) {
        const removed = await actions.removePlaceholder(reveal.file.uploadId)
        if (!removed.ok) return setError(removed.error)
        onReveal({ ...reveal, file: null })
      }
      const result = await actions.lock({
        allowDuplicates: lockOptions.allowDuplicates,
        chainId: lockChain ?? 0,
      })
      if (result.ok) onLocked(result.data)
      else refused(result.error)
    } catch {
      setError(THROWN)
    } finally {
      setLocking(false)
    }
  }

  const refusal = deferred ? null : lockRefusal(review, lockOptions.allowDuplicates)
  const blocked = refusal ?? (!sample && !deferred && lockChain === undefined ? CONNECT_TO_LOCK : null)
  const needsPlaceholder = reveal.on && !reveal.file
  const offerDuplicates = review.allowDuplicatesNeeded || lockOptions.allowDuplicates
  const checks = reviewChecks(review, lockOptions.allowDuplicates)
  const hasLayers = review.counts.layers > 0
  const lockLabel = deferred ? 'Lock placeholder' : 'Lock art'

  return (
    <div className="divide-y">
      <RevealChoice
        state={reveal}
        onChange={onReveal}
        readOnly={readOnly || locking}
        upload={actions.uploadPlaceholder}
        remove={sample ? null : actions.removePlaceholder}
      />

      {deferred ? (
        <div className="p-6">
          <Alert>
            <ClockIcon aria-hidden="true" />
            <AlertTitle>Lock the real art later from Art</AlertTitle>
            <AlertDescription>
              <p>
                You are finishing the art later, so this run locks and renders only the placeholder, at no
                cost. When the set is complete, continue from Generate to lock it. It is rendered to its own
                CID, and you reveal to it from Manage drop, Settings.
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
            {previews && (
              <ul aria-label="Sample tokens" className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {Array.from({ length: STRIP }, (_, index) => (
                  <li key={index} className={cn(index >= 4 && 'hidden sm:block')}>
                    <Artwork
                      src={tokenPreview(index + 1)}
                      alt={`Token ${index + 1}`}
                      seed={`token-${index + 1}`}
                      className="border-border-strong rounded-lg border"
                    >
                      {index === STRIP - 1 && review.tokenCount > STRIP && (
                        <span className="bg-background/75 absolute inset-0 flex items-center justify-center text-[0.8125rem] font-medium backdrop-blur-[2px]">
                          <span className="numeric">+{fmt(review.tokenCount - STRIP)}</span>
                        </span>
                      )}
                    </Artwork>
                  </li>
                ))}
              </ul>
            )}
            <StatGroup>
              <Stat label="Tokens" value={fmt(review.tokenCount)} />
              <Stat label="Collections" value={review.counts.collections} />
              {hasLayers && <Stat label="Layers" value={review.counts.layers} />}
              {hasLayers && <Stat label="Traits" value={review.counts.traits} />}
              {hasLayers && <Stat label="Rules" value={review.counts.rules} />}
            </StatGroup>
          </section>

          <section aria-labelledby={`${id}-checks`} className="space-y-3 p-6">
            <h4 id={`${id}-checks`} className="text-sm font-medium">
              Checks
            </h4>
            <ul className="space-y-2">
              {checks.map((entry) => (
                <li key={entry.key} className="flex items-start gap-3">
                  {entry.problems.length === 0 ? (
                    <CheckIcon
                      aria-hidden="true"
                      className="text-success-foreground mt-0.5 size-4 shrink-0"
                    />
                  ) : (
                    <CircleAlertIcon aria-hidden="true" className="text-warning mt-0.5 size-4 shrink-0" />
                  )}
                  <div className="space-y-1">
                    <p className="text-sm">
                      {entry.label}
                      <span className="sr-only">
                        {entry.problems.length === 0 ? ': passed' : ': needs a fix'}
                      </span>
                    </p>
                    {entry.problems.map((message) => (
                      <p key={message} className="text-muted-foreground text-[0.8125rem] leading-snug">
                        {message}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {refusal && previous && <BackLink link={previous} />}
          </section>

          <section aria-labelledby={`${id}-options`} className="space-y-4 p-6">
            <h4 id={`${id}-options`} className="text-sm font-medium">
              Lock options
            </h4>
            {offerDuplicates && (
              <div className="flex items-start justify-between gap-6">
                <div className="space-y-1">
                  <label htmlFor={`${id}-duplicates`} className="text-sm font-medium">
                    Allow identical tokens
                  </label>
                  <p className="text-muted-foreground max-w-xl text-[0.8125rem] leading-snug">
                    {lockOptions.allowDuplicates
                      ? 'Tokens with the same traits are locked as they are.'
                      : 'The only problem is tokens with the same traits. Turn this on if your project wants duplicates.'}
                  </p>
                </div>
                <Switch
                  id={`${id}-duplicates`}
                  checked={lockOptions.allowDuplicates}
                  disabled={readOnly || locking}
                  onCheckedChange={(allowDuplicates) => onLockOptions({ ...lockOptions, allowDuplicates })}
                />
              </div>
            )}

            <div className="flex items-start gap-3">
              <InfoIcon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Traits with a maximum count stay at or under it</p>
                <p className="text-muted-foreground text-[0.8125rem] leading-snug">
                  {review.constants.length
                    ? review.constants.map((entry, index) => (
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
            <AlertTitle>{deferred ? 'The placeholder was not locked' : 'The art was not locked'}</AlertTitle>
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
                : review.credit
                  ? 'Locking is final: the credit pays the fee at once.'
                  : 'Locking is final once the fee is paid. Until then you can unlock and edit again.')}
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
                ? 'Cobweb stores the placeholder, and the contract starts on it. There is no fee for the placeholder. The art stays open; you lock the real set later from Art.'
                : review.credit
                  ? `Cobweb checks and stores these ${fmt(review.tokenCount)} tokens exactly as they are now. The render that failed left a credit, so this lock is free and the render starts at once. You cannot edit the layers, traits, rules or tokens afterwards.`
                  : `Cobweb checks and stores these ${fmt(review.tokenCount)} tokens exactly as they are now, and quotes the fee from this supply. You cannot edit the layers, traits, rules or tokens afterwards, unless you unlock before paying.`}
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
