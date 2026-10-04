'use client'

import { CircleAlertIcon, CircleCheckIcon, PauseIcon, PlayIcon, RotateCwIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { Progress } from '@cobweb/ui/components/progress'
import { cn } from '@cobweb/ui/lib/utils'
import { formatBytes } from '../lib/image-checks'
import { queueTotals, type QueueItem, type UploadQueue } from './upload-queue'

/** Rows drawn at once. A folder can hold thousands of files; the rest are counted, not drawn. */
const ROW_LIMIT = 150

const n = (value: number) => value.toLocaleString('en-US')
const percent = (sent: number, total: number) => (total === 0 ? 100 : Math.round((sent / total) * 100))

const STATE_LABEL: Record<QueueItem['state'], string> = {
  queued: 'Waiting',
  uploading: 'Uploading',
  paused: 'Paused',
  done: 'Uploaded',
  failed: 'Failed',
}

/** Unfinished files first (failed, then the rest in order), so what needs attention is on top. */
function ordered(items: QueueItem[]): QueueItem[] {
  const rank = (item: QueueItem) => (item.state === 'failed' ? 0 : item.state === 'done' ? 2 : 1)
  return [...items].sort((a, b) => rank(a) - rank(b))
}

function RowAction({ item, queue }: { item: QueueItem; queue: UploadQueue }) {
  const name = item.label
  if (item.state === 'uploading' || item.state === 'queued')
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Pause ${name}`}
        onClick={() => queue.pause(item.id)}
      >
        <PauseIcon />
      </Button>
    )
  if (item.state === 'paused')
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Resume ${name}`}
        onClick={() => queue.resume(item.id)}
      >
        <PlayIcon />
      </Button>
    )
  if (item.state === 'failed')
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Retry ${name}`}
        onClick={() => queue.retry(item.id)}
      >
        <RotateCwIcon />
      </Button>
    )
  return <CircleCheckIcon aria-label="Uploaded" className="text-success size-4" />
}

/**
 * The upload queue: overall progress, pause, resume and retry for everything, and one row per
 * file with its own progress and control.
 */
export function UploadQueuePanel({
  queue,
  items,
  title = 'Uploading',
  className,
}: {
  queue: UploadQueue
  items: QueueItem[]
  title?: string
  className?: string
}) {
  const totals = queueTotals(items)
  if (totals.files === 0) return null
  const rows = ordered(items).slice(0, ROW_LIMIT)
  const pausable = totals.active > 0 || items.some((item) => item.state === 'queued')

  return (
    <Panel
      className={className}
      title={totals.complete ? 'Upload complete' : title}
      description={
        <>
          <span className="numeric">{n(totals.done)}</span> of{' '}
          <span className="numeric">{n(totals.files)}</span> {totals.files === 1 ? 'file' : 'files'} uploaded
          {totals.failed > 0 && (
            <>
              , <span className="numeric">{n(totals.failed)}</span> failed
            </>
          )}
          {totals.paused > 0 && (
            <>
              , <span className="numeric">{n(totals.paused)}</span> paused
            </>
          )}
        </>
      }
      action={
        !totals.complete && (
          <>
            {totals.failed > 0 && (
              <Button variant="secondary" size="sm" onClick={() => queue.retryFailed()}>
                <RotateCwIcon />
                Retry failed
              </Button>
            )}
            {pausable ? (
              <Button variant="secondary" size="sm" onClick={() => queue.pauseAll()}>
                <PauseIcon />
                Pause all
              </Button>
            ) : (
              totals.paused > 0 && (
                <Button variant="secondary" size="sm" onClick={() => queue.resumeAll()}>
                  <PlayIcon />
                  Resume all
                </Button>
              )
            )}
          </>
        )
      }
      bodyClassName="space-y-4"
    >
      <div className="space-y-1.5">
        <Progress
          value={percent(totals.sentBytes, totals.totalBytes)}
          aria-label="Overall upload progress"
          aria-valuetext={`${percent(totals.sentBytes, totals.totalBytes)}%`}
        />
        <p className="text-muted-foreground text-xs">
          <span className="numeric">{formatBytes(totals.sentBytes)}</span> of{' '}
          <span className="numeric">{formatBytes(totals.totalBytes)}</span>
        </p>
      </div>
      <ul className="-mx-2 max-h-80 divide-y overflow-y-auto" aria-label="Files in the upload queue">
        {rows.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-2 py-2.5">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate" title={item.label}>
                  {item.label}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    item.state === 'failed' ? 'text-destructive-foreground' : 'text-muted-foreground',
                  )}
                >
                  {item.state === 'uploading' ? (
                    <span className="numeric">{percent(item.sentBytes, item.totalBytes)}%</span>
                  ) : (
                    STATE_LABEL[item.state]
                  )}
                </span>
              </div>
              {item.state !== 'done' && (
                <Progress
                  size="sm"
                  value={percent(item.sentBytes, item.totalBytes)}
                  aria-label={`${item.label} upload progress`}
                />
              )}
              {item.error && (
                <p className="text-destructive-foreground flex items-center gap-1.5 text-xs">
                  <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
                  {item.error}
                </p>
              )}
            </div>
            <RowAction item={item} queue={queue} />
          </li>
        ))}
      </ul>
      {items.length > rows.length && (
        <p className="text-muted-foreground text-xs">
          And <span className="numeric">{n(items.length - rows.length)}</span> more files.
        </p>
      )}
    </Panel>
  )
}
