'use client'

import { CircleAlertIcon, ImageUpIcon, XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cobweb/ui/components/dialog'
import { Input } from '@cobweb/ui/components/input'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import type { Layer } from '@/lib/demo'
import {
  checkImageFiles,
  formatBytes,
  LAYER_IMAGE_RULES,
  nameFromFile,
  releaseChecked,
  type CheckedFile,
} from '../lib/image-checks'

type Canvas = { width: number; height: number } | null

/** The upload rules, said where the creator uploads. */
export function UploadRules({ canvas, className }: { canvas: Canvas; className?: string }) {
  return (
    <p className={cn('text-muted-foreground text-xs leading-relaxed', className)}>
      PNG with a transparent background, square, up to <span className="numeric">2048 x 2048</span> px and{' '}
      <span className="numeric">10 MB</span> each. Every layer image in the project is the same size
      {canvas ? (
        <>
          : yours are <span className="numeric">{`${canvas.width} x ${canvas.height}`}</span>.
        </>
      ) : (
        '; the first upload sets it.'
      )}
    </p>
  )
}

/** A drop target that is also a button for the file picker. */
export function DropZone({
  onFiles,
  compact,
  label,
}: {
  onFiles: (files: File[]) => void
  compact?: boolean
  label: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          const files = [...event.dataTransfer.files]
          if (files.length) onFiles(files)
        }}
        className={cn(
          'bg-well/60 text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-center outline-none transition-colors hover:border-input focus-visible:ring-2',
          compact ? 'h-full min-h-48 p-4' : 'px-6 py-10',
          over && 'border-primary bg-primary-soft text-foreground',
        )}
      >
        <span className="bg-surface-3 flex size-10 items-center justify-center rounded-md shadow-raised">
          <ImageUpIcon aria-hidden="true" className="size-5" />
        </span>
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs">Drop PNG files or choose them</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </>
  )
}

/**
 * Adds traits to a layer: pick or drop files, see each one checked against the upload rules,
 * name them, then add the valid ones at 0%.
 */
export function AddTraitsDialog({
  layer,
  open,
  onOpenChange,
  initialFiles,
  canvas,
  onAdd,
}: {
  layer: Layer | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Files dropped on the grid before the dialog opened. */
  initialFiles: File[]
  canvas: Canvas
  onAdd: (items: { name: string; imageUrl: string }[], canvas: Canvas) => void
}) {
  const [checked, setChecked] = useState<CheckedFile[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [checking, setChecking] = useState(0)
  const kept = useRef(false)

  const add = async (files: File[]) => {
    setChecking(files.length)
    const valid = checked.find((entry) => entry.errors.length === 0)
    const size = canvas ?? (valid?.width ? { width: valid.width, height: valid.height! } : null)
    const results = await checkImageFiles(files, { ...LAYER_IMAGE_RULES, sameSizeAs: size })
    setChecked((current) => [...current, ...results])
    setNames((current) => ({
      ...current,
      ...Object.fromEntries(results.map((entry) => [entry.key, nameFromFile(entry.file.name)])),
    }))
    setChecking(0)
  }

  // Files dropped on the grid arrive with the dialog.
  useEffect(() => {
    if (open && initialFiles.length) void add(initialFiles)
    // Only when the dialog opens with a new drop.
  }, [open, initialFiles])

  const reset = () => {
    if (!kept.current) releaseChecked(checked)
    kept.current = false
    setChecked([])
    setNames({})
  }

  const valid = checked.filter((entry) => entry.errors.length === 0)
  const invalid = checked.length - valid.length
  const remove = (key: string) => {
    const entry = checked.find((candidate) => candidate.key === key)
    if (entry) releaseChecked([entry])
    setChecked((current) => current.filter((candidate) => candidate.key !== key))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add traits to {layer?.name}</DialogTitle>
          <DialogDescription>
            New traits start at 0%, so the weights you set stay as they are. Give them a share afterwards, or
            use Even out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <DropZone onFiles={(files) => void add(files)} label="Choose trait images" />
          <UploadRules canvas={canvas} />
        </div>

        <div aria-live="polite" className="sr-only">
          {checking
            ? `Checking ${checking} files.`
            : checked.length
              ? `${valid.length} ready to add, ${invalid} with problems.`
              : ''}
        </div>

        {checking > 0 && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner />
            Checking <span className="numeric">{checking}</span> {checking === 1 ? 'file' : 'files'}
          </p>
        )}

        {checked.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label="Picked files">
            {checked.map((entry) => {
              const ok = entry.errors.length === 0
              return (
                <li key={entry.key} className="flex items-start gap-3 p-3">
                  <div className="bg-well size-12 shrink-0 overflow-hidden rounded-md border">
                    {ok && <img src={entry.url} alt="" className="size-full object-contain" />}
                    {!ok && (
                      <span className="text-destructive-foreground flex size-full items-center justify-center">
                        <CircleAlertIcon aria-hidden="true" className="size-5" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    {ok ? (
                      <Input
                        value={names[entry.key] ?? ''}
                        onChange={(event) =>
                          setNames((current) => ({ ...current, [entry.key]: event.target.value }))
                        }
                        aria-label={`Trait name for ${entry.file.name}`}
                        className="h-8 text-sm"
                      />
                    ) : (
                      <p className="truncate text-sm font-medium">{entry.file.name}</p>
                    )}
                    <p className="text-muted-foreground truncate text-xs">
                      <span className="numeric">{formatBytes(entry.file.size)}</span>
                      {entry.width && (
                        <>
                          {' '}
                          · <span className="numeric">{`${entry.width} x ${entry.height}`}</span>
                        </>
                      )}
                      {ok && <> · {entry.file.name}</>}
                    </p>
                    {!ok && (
                      <ul className="text-destructive-foreground space-y-0.5 text-xs">
                        {entry.errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => remove(entry.key)}
                    aria-label={`Remove ${entry.file.name}`}
                  >
                    <XIcon />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <DialogFooter className="sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm">
            {invalid > 0 && (
              <>
                <span className="numeric">{invalid}</span> {invalid === 1 ? 'file is' : 'files are'} left out.
              </>
            )}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => {
                reset()
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={
                valid.length === 0 || checking > 0 || valid.some((entry) => !names[entry.key]?.trim())
              }
              onClick={() => {
                const first = valid[0]
                onAdd(
                  valid.map((entry) => ({ name: names[entry.key]!.trim(), imageUrl: entry.url })),
                  first?.width ? { width: first.width, height: first.height! } : null,
                )
                releaseChecked(checked.filter((entry) => entry.errors.length > 0))
                kept.current = true
                reset()
                onOpenChange(false)
              }}
            >
              {valid.length > 1 ? `Add ${valid.length} traits` : 'Add trait'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
