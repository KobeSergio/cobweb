'use client'

import { CheckIcon, CircleIcon, ClockIcon, LockIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
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
import { cn } from '@cobweb/ui/lib/utils'
import type { FlowLink } from '@/lib/steps'
import { RevealLater, type RevealLaterState } from './reveal-later'
import { lockArt, type CheckState, type LockCheck, type UploadOutcome } from './upload-sim'
import { tokenPreview, type ArtSummary } from './upload-shared'

const STRIP = 8

/**
 * Review and lock: what is being locked, the checks the server runs, "Reveal later" with its
 * placeholder, and the lock itself. With deferred art (decision D25) only the placeholder is
 * locked in this run; the real set is locked later, from Art.
 */
export function ReviewStep({
  tokenCount,
  art,
  readOnly,
  previous,
  outcome,
  deferred,
  reveal,
  onReveal,
  onLocked,
}: {
  tokenCount: number
  art: ArtSummary
  readOnly: boolean
  previous?: FlowLink
  outcome?: UploadOutcome
  /** The art is deferred: lock the placeholder alone. */
  deferred: boolean
  reveal: RevealLaterState
  onReveal: (next: RevealLaterState) => void
  onLocked: (lockedAt: number) => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [checks, setChecks] = useState<Record<LockCheck, CheckState> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const locking = checks !== null && error === null

  useEffect(() => () => controller.current?.abort(), [])

  async function lock() {
    controller.current = new AbortController()
    setError(null)
    setChecks({ supply: 'waiting', duplicates: 'waiting', rules: 'waiting', constants: 'waiting' })
    try {
      const result = await lockArt(
        (check, state) => setChecks((current) => (current ? { ...current, [check]: state } : current)),
        {
          outcome: attempt === 0 ? outcome : undefined,
          signal: controller.current.signal,
          checks: deferred ? [] : undefined,
        },
      )
      setAttempt((count) => count + 1)
      if (result.ok) onLocked(result.lockedAt)
      else setError(result.message)
    } catch {
      // Unmounted mid-check.
    }
  }

  const constantsTotal = art.constants.reduce((sum, entry) => sum + entry.count, 0)
  const rows: { check: LockCheck; label: string; detail: React.ReactNode }[] = [
    {
      check: 'supply',
      label: 'Supply matches',
      detail: (
        <>
          <span className="numeric">{tokenCount.toLocaleString('en-US')}</span> tokens, one per id
        </>
      ),
    },
    { check: 'duplicates', label: 'No duplicate tokens', detail: 'Every trait combination is unique' },
    {
      check: 'rules',
      label: 'Rules satisfied',
      detail: (
        <>
          All <span className="numeric">{art.rules}</span> pairing rules hold in every token
        </>
      ),
    },
    {
      check: 'constants',
      label: 'Maximum counts respected',
      detail: art.constants.length ? (
        <>
          {art.constants.map((entry) => entry.name).join(', ')} on at most{' '}
          <span className="numeric">{constantsTotal}</span> tokens
        </>
      ) : (
        'No trait has a maximum count in this set'
      ),
    },
  ]
  const needsPlaceholder = reveal.on && !reveal.file
  const lockLabel = deferred ? 'Lock placeholder' : 'Lock art'

  return (
    <div className="divide-y">
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
              {previous && (
                <Link href={previous.href} className="text-foreground underline underline-offset-4">
                  Go to {previous.name}
                </Link>
              )}
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <>
          <div className="space-y-6 p-6">
            <ul aria-label="Sample tokens" className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {Array.from({ length: STRIP }, (_, index) => (
                <li key={index} className={cn(index >= 4 && 'hidden sm:block')}>
                  <Artwork
                    src={tokenPreview(index + 1)}
                    alt={`Token ${index + 1}`}
                    seed={`token-${index + 1}`}
                    className="border-border-strong rounded-lg border"
                  >
                    {index === STRIP - 1 && tokenCount > STRIP && (
                      <span className="bg-background/75 absolute inset-0 flex items-center justify-center text-[0.8125rem] font-medium backdrop-blur-[2px]">
                        <span className="numeric">+{(tokenCount - STRIP).toLocaleString('en-US')}</span>
                      </span>
                    )}
                  </Artwork>
                </li>
              ))}
            </ul>
            <StatGroup>
              <Stat label="Supply" value={tokenCount.toLocaleString('en-US')} suffix="tokens" />
              <Stat label="Layers" value={art.layers} />
              <Stat label="Traits" value={art.traits} />
              <Stat label="Rules" value={art.rules} />
            </StatGroup>
          </div>

          <div className="space-y-3 p-6">
            <h4 className="text-sm font-medium">Checked by Cobweb when you lock</h4>
            <ul aria-live="polite" className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {rows.map((row) => (
                <CheckRow key={row.check} label={row.label} detail={row.detail} state={checks?.[row.check]} />
              ))}
            </ul>
            {error && (
              <Alert variant="destructive" className="mt-4">
                <XIcon aria-hidden="true" />
                <AlertTitle>The art did not pass the checks</AlertTitle>
                <AlertDescription>
                  <p>{error}</p>
                  {previous && (
                    <Link href={previous.href} className="text-foreground underline underline-offset-4">
                      Go to {previous.name}
                    </Link>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </>
      )}

      <RevealLater state={reveal} onChange={onReveal} readOnly={readOnly || locking} />

      <div className="flex flex-wrap items-center justify-between gap-4 p-6">
        <p className="text-muted-foreground flex max-w-md items-start gap-2 text-[0.8125rem] leading-snug">
          <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {needsPlaceholder
            ? 'Add a placeholder to lock with Reveal later, or turn it off.'
            : deferred
              ? 'Locking the placeholder is final for this run. The art stays open until you lock the real set.'
              : 'Locking is final. After this you cannot edit the layers, traits, rules or tokens.'}
        </p>
        {!readOnly && (
          <Button onClick={() => setConfirmOpen(true)} disabled={locking || needsPlaceholder}>
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
                : `Cobweb checks and stores these ${tokenCount.toLocaleString('en-US')} tokens exactly as they are now. You cannot edit the layers, traits, rules or tokens afterwards, and the generation fee is quoted from this supply.`}
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

function CheckRow({ label, detail, state }: { label: string; detail: React.ReactNode; state?: CheckState }) {
  const status =
    state === 'passed' ? 'passed' : state === 'failed' ? 'failed' : state === 'running' ? 'checking' : ''
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          'mt-px flex size-5 shrink-0 items-center justify-center rounded-full',
          state === 'passed' && 'bg-success-soft text-success-foreground',
          state === 'failed' && 'bg-destructive-soft text-destructive-foreground',
          (!state || state === 'waiting') && 'text-faint',
          state === 'running' && 'text-primary',
        )}
      >
        {state === 'passed' && <CheckIcon className="size-3" strokeWidth={3} />}
        {state === 'failed' && <XIcon className="size-3" strokeWidth={3} />}
        {state === 'running' && <Spinner className="size-4" />}
        {(!state || state === 'waiting') && <CircleIcon className="size-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">
          {label}
          {status && <span className="sr-only">, {status}</span>}
        </span>
        <span className="text-muted-foreground block text-[0.8125rem]">{detail}</span>
      </span>
    </li>
  )
}
