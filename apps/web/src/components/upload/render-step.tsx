'use client'

import { CheckIcon, InfoIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Progress } from '@cobweb/ui/components/progress'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import { followRender, SECONDS_PER_BATCH, type RenderProgress, type UploadOutcome } from './upload-sim'
import { formatDuration } from './upload-shared'

/**
 * Rendering: coarse progress only, batches done of total, then the metadata upload. There is no
 * per-image status and no thumbnails of the latest tokens. With "Reveal later" the placeholder is
 * its own small phase, pinned first; with deferred art it is the only one.
 */
export function RenderStep({
  tokenCount,
  start,
  readOnly,
  outcome,
  placeholder = false,
  placeholderOnly = false,
  onDone,
}: {
  tokenCount: number
  start: RenderProgress
  readOnly: boolean
  outcome?: UploadOutcome
  /** "Reveal later" is on: show the placeholder's own phase. */
  placeholder?: boolean
  /** Deferred art: this run renders the placeholder alone. */
  placeholderOnly?: boolean
  onDone: () => void
}) {
  const [progress, setProgress] = useState(start)
  const [retrying, setRetrying] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  const run = useCallback((from: RenderProgress, sampleOutcome?: UploadOutcome) => {
    controller.current?.abort()
    controller.current = new AbortController()
    followRender(
      from,
      (next) => {
        setProgress(next)
        setRetrying(false)
        if (next.phase === 'done') onDoneRef.current()
      },
      { outcome: sampleOutcome, signal: controller.current.signal },
    ).catch(() => {
      // Unmounted while following.
    })
  }, [])

  // Follow once, from where the job was when the screen opened.
  const [initial] = useState(() => ({ start, outcome }))
  useEffect(() => {
    run(initial.start, initial.outcome)
    return () => controller.current?.abort()
  }, [run, initial])

  function retry() {
    setRetrying(true)
    run({ ...progress, failedBatch: undefined })
  }

  const imagesDone = progress.done >= progress.total
  const failed = progress.failedBatch !== undefined
  const remaining = (progress.total - progress.done) * SECONDS_PER_BATCH + (imagesDone ? 0 : 60)
  // The placeholder is one file, pinned before the first batch of the real set finishes.
  const placeholderState = progress.phase === 'done' || progress.done > 0 ? 'done' : 'running'
  const placeholderRow = (
    <PhaseRow
      label="Placeholder"
      state={placeholderOnly ? (progress.phase === 'done' ? 'done' : 'running') : placeholderState}
      detail={
        (placeholderOnly ? progress.phase === 'done' : placeholderState === 'done')
          ? 'Done. Pinned to its own CID'
          : 'Pinning the one placeholder file'
      }
    />
  )

  if (placeholderOnly) {
    return (
      <div className="divide-y">
        <div className="space-y-4 p-6">
          <ol className="grid gap-3 sm:grid-cols-2">{placeholderRow}</ol>
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
            <span className="numeric text-[2rem] leading-none font-medium tracking-tight">
              {progress.done}
            </span>
            <span className="numeric text-muted-foreground text-sm">of {progress.total} batches done</span>
          </p>
          <p className="text-muted-foreground text-[0.8125rem]" aria-live="polite">
            {failed ? (
              <>Paused at batch {progress.failedBatch}</>
            ) : imagesDone ? (
              'Images finished'
            ) : (
              <>
                <span className="numeric">{tokenCount.toLocaleString('en-US')}</span> tokens in batches of{' '}
                <span className="numeric">{progress.size}</span>
              </>
            )}
          </p>
        </div>
        <Progress
          size="lg"
          value={(progress.done / progress.total) * 100}
          aria-label="Batches rendered"
          aria-valuetext={`${progress.done} of ${progress.total} batches`}
        />

        <ol className={cn('grid gap-3', placeholder ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {placeholder && placeholderRow}
          <PhaseRow
            label="Render images"
            state={failed ? 'failed' : imagesDone ? 'done' : 'running'}
            detail={
              <>
                <span className="numeric">{progress.done}</span> of{' '}
                <span className="numeric">{progress.total}</span> batches
              </>
            }
          />
          <PhaseRow
            label="Upload metadata to IPFS"
            state={progress.phase === 'done' ? 'done' : progress.phase === 'metadata' ? 'running' : 'waiting'}
            detail={progress.phase === 'metadata' ? 'Writing and pinning the metadata' : 'After the images'}
          />
        </ol>

        {failed && (
          <Alert variant="destructive">
            <XIcon aria-hidden="true" />
            <AlertTitle>Batch {progress.failedBatch} did not render</AlertTitle>
            <AlertDescription>
              <p>
                The batch failed on the render server. The finished batches are kept; retrying renders only
                this one.
              </p>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="text-muted-foreground max-w-lg space-y-1 text-[0.8125rem] leading-snug">
          {!failed && progress.phase !== 'done' && (
            <p className="text-foreground/90">
              Time left: {formatDuration(remaining)}, estimated from about {SECONDS_PER_BATCH} seconds per
              batch.
            </p>
          )}
          <p className="flex items-start gap-2">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            You can leave this page. Rendering runs on Cobweb&apos;s servers and this page shows the latest
            progress when you come back.
          </p>
        </div>
        {failed && !readOnly && (
          <Button onClick={retry} disabled={retrying}>
            {retrying ? <Spinner /> : <RotateCwIcon />}
            Retry batch
          </Button>
        )}
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
