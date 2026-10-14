'use client'

import { CheckIcon, InfoIcon, LockOpenIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Progress } from '@cobweb/ui/components/progress'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import type { FailureFace, RenderView } from './render-follow'
import { formatDuration } from './upload-shared'

const CONNECTION_LOST = 'Cobweb cannot reach the server; still trying.'

/** What the failure alert says under the worker's sentence, by face, and the one button that fits. */
function faceCopy(face: FailureFace, retriesLeft: number): { advice: string; button: string } | null {
  switch (face) {
    case 'art':
      return {
        advice:
          'Unlock the art, fix it on the Art screens and lock again. The credit from this render makes the next lock free.',
        button: 'Unlock and fix the art',
      }
    case 'retry':
      return {
        advice: `The finished batches are kept; a retry renders only the rest. ${retriesLeft} ${
          retriesLeft === 1 ? 'retry' : 'retries'
        } left.`,
        button: 'Try again',
      }
    case 'credit':
      return {
        advice:
          'No retries are left. Unlock and lock again: the credit from this render makes the next lock free.',
        button: 'Unlock and lock again',
      }
    case 'support':
      return null
  }
}

function failureTitle(failure: NonNullable<RenderView['failure']>): string {
  if (failure.face === 'art') return 'The art needs a fix'
  if (failure.face === 'support') return 'The payment could not be verified'
  return failure.failedBatch !== null ? `Batch ${failure.failedBatch} did not render` : 'The render stopped'
}

/**
 * Rendering (docs/specs/2026-10-14-render-screen-wiring.md, section 9.2): coarse progress only, batches
 * done of total, then the metadata upload, drawn from the view the flow derives from the polled job.
 * A batch the worker retries on its own is an informational note; a failed job shows the worker's
 * sentence and one of four faces: fix the art, try again, unlock on the credit, or tell support. With
 * "Reveal later" the placeholder is its own small phase, pinned first; with deferred art it is the only one.
 */
export function RenderStep({
  view,
  readOnly,
  placeholder = false,
  placeholderOnly = false,
  busy,
  actionError,
  connectionLost,
  onRetry,
  onUnlock,
}: {
  view: RenderView
  readOnly: boolean
  /** "Reveal later" is on: show the placeholder's own phase. */
  placeholder?: boolean
  /** Deferred art: this run renders the placeholder alone. */
  placeholderOnly?: boolean
  /** A retry or an unlock is in flight. */
  busy: boolean
  /** The sentence the last retry or unlock was refused with, or null. */
  actionError: string | null
  /** The last poll failed; the next one is still scheduled. */
  connectionLost: boolean
  onRetry: () => void
  onUnlock: () => void
}) {
  const { failure } = view
  const imagesDone = view.phase === 'metadata' || view.phase === 'done'
  const copy = failure ? faceCopy(failure.face, failure.retriesLeft) : null
  const onAction = failure?.face === 'retry' ? onRetry : onUnlock
  // The placeholder is one file, pinned before the first batch of the real set finishes.
  const placeholderState = view.phase === 'done' || view.done > 0 ? 'done' : 'running'
  const placeholderRow = (
    <PhaseRow
      label="Placeholder"
      state={
        placeholderOnly ? (view.phase === 'done' ? 'done' : failure ? 'failed' : 'running') : placeholderState
      }
      detail={
        (placeholderOnly ? view.phase === 'done' : placeholderState === 'done')
          ? 'Done. Pinned to its own CID'
          : 'Pinning the one placeholder file'
      }
    />
  )

  const failureAlert = failure && (
    <Alert variant="destructive">
      <XIcon aria-hidden="true" />
      <AlertTitle>{failureTitle(failure)}</AlertTitle>
      <AlertDescription>
        <p>{failure.sentence}</p>
        {copy && !readOnly && (
          <>
            <p>{copy.advice}</p>
            <Button onClick={onAction} disabled={busy} className="mt-1">
              {busy ? <Spinner /> : failure.face === 'retry' ? <RotateCwIcon /> : <LockOpenIcon />}
              {copy.button}
            </Button>
            {actionError && <p className="text-destructive-foreground">{actionError}</p>}
          </>
        )}
      </AlertDescription>
    </Alert>
  )

  if (placeholderOnly) {
    return (
      <div className="divide-y">
        <div className="space-y-4 p-6">
          <ol className="grid gap-3 sm:grid-cols-2">{placeholderRow}</ol>
          {failureAlert}
          {connectionLost && <p className="text-muted-foreground text-[0.8125rem]">{CONNECTION_LOST}</p>}
          <p className="text-muted-foreground text-[0.8125rem] leading-snug">
            Only the placeholder is rendered in this run. The real set is rendered when you lock it from Art.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="divide-y">
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <p className="flex items-baseline gap-2">
            <span className="numeric text-[2rem] leading-none font-medium tracking-tight">{view.done}</span>
            <span className="numeric text-muted-foreground text-sm">of {view.total} batches done</span>
          </p>
          <p className="text-muted-foreground text-[0.8125rem]" aria-live="polite">
            {failure ? (
              failure.failedBatch !== null ? (
                <>Stopped at batch {failure.failedBatch}</>
              ) : (
                'Stopped'
              )
            ) : view.phase === 'queued' ? (
              'Waiting for a render worker'
            ) : imagesDone ? (
              'Images finished'
            ) : (
              <>
                In batches of <span className="numeric">{view.size}</span> tokens
              </>
            )}
          </p>
        </div>
        {connectionLost && <p className="text-muted-foreground text-[0.8125rem]">{CONNECTION_LOST}</p>}
        <Progress
          size="lg"
          value={imagesDone ? 100 : (view.done / view.total) * 100}
          aria-label="Batches rendered"
          aria-valuetext={`${view.done} of ${view.total} batches`}
        />

        <ol className={cn('grid gap-3', placeholder ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {placeholder && placeholderRow}
          <PhaseRow
            label="Render images"
            state={failure && view.phase === 'images' ? 'failed' : imagesDone ? 'done' : 'running'}
            detail={
              view.phase === 'queued' ? (
                'Waiting for a render worker'
              ) : (
                <>
                  <span className="numeric">{view.done}</span> of{' '}
                  <span className="numeric">{view.total}</span> batches
                </>
              )
            }
          />
          <PhaseRow
            label="Upload metadata to IPFS"
            state={
              view.phase === 'done'
                ? 'done'
                : view.phase === 'metadata'
                  ? failure
                    ? 'failed'
                    : 'running'
                  : 'waiting'
            }
            detail={
              view.phase === 'done'
                ? 'Done'
                : view.phase === 'metadata'
                  ? 'Writing and pinning the metadata'
                  : 'After the images'
            }
          />
        </ol>

        {view.retryingBatch !== null && !failure && (
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertTitle>Batch {view.retryingBatch} did not render</AlertTitle>
            <AlertDescription>
              <p>The worker retries it on its own; the finished batches are kept.</p>
            </AlertDescription>
          </Alert>
        )}

        {failureAlert}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="text-muted-foreground max-w-lg space-y-1 text-[0.8125rem] leading-snug">
          {view.timeLeftSeconds !== null && (
            <p className="text-foreground/90">
              Time left: {formatDuration(view.timeLeftSeconds)}, a rough estimate.
            </p>
          )}
          <p className="flex items-start gap-2">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            You can leave this page. Rendering runs on Cobweb&apos;s servers and this page shows the latest
            progress when you come back.
          </p>
        </div>
      </div>
    </div>
  )
}

function PhaseRow({
  label,
  state,
  detail,
}: {
  label: string
  state: 'waiting' | 'running' | 'done' | 'failed'
  detail: React.ReactNode
}) {
  return (
    <li className="bg-surface-2/50 flex items-start gap-3 rounded-lg border px-4 py-3">
      <span
        aria-hidden="true"
        className={cn(
          'mt-px flex size-5 shrink-0 items-center justify-center rounded-full',
          state === 'done' && 'bg-success-soft text-success-foreground',
          state === 'failed' && 'bg-destructive-soft text-destructive-foreground',
          state === 'running' && 'text-primary',
          state === 'waiting' && 'ring-border-strong ring-1 ring-inset',
        )}
      >
        {state === 'done' && <CheckIcon className="size-3" strokeWidth={3} />}
        {state === 'failed' && <XIcon className="size-3" strokeWidth={3} />}
        {state === 'running' && <Spinner className="size-4" />}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-sm font-medium', state === 'waiting' && 'text-muted-foreground')}>
          {label}
          <span className="sr-only">, {state}</span>
        </span>
        <span className="text-muted-foreground block text-[0.8125rem]">{detail}</span>
      </span>
    </li>
  )
}
