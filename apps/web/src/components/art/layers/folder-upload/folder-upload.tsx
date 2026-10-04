'use client'

import { ArrowRightIcon, CircleAlertIcon, CircleCheckIcon, FolderOpenIcon, UploadIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { Progress } from '@cobweb/ui/components/progress'
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import { UploadQueuePanel } from '../../uploads/upload-queue-panel'
import { countTraits } from './folder-tree'
import { FolderDropZone } from './folder-drop-zone'
import { TreePreview } from './tree-preview'
import { useFolderUpload } from './use-folder-upload'

const n = (value: number) => value.toLocaleString('en-US')

/** The layer rules from the project brief, as the creator reads them. */
const RULES = [
  'PNG with a transparent background',
  'Square, at most 2048 x 2048',
  'The same size across the whole project',
  'Up to 10 MB each',
]

/**
 * Layers, before there are any (generative): upload the project as one folder, as the legacy app
 * did. Drop or choose it, see what was found (collections, layers, trait counts) with each image
 * checked, upload the good ones through the resumable queue (pause, resume, retry), and finish on a
 * summary that opens the Layers screen.
 *
 * Writes the result into the shared art project for `collectionId`; once it has layers, the Layers
 * screen shows them instead of this. With several collections in the project, a single uploaded
 * collection fills `activeCollectionId`.
 */
export function FolderUpload({
  collectionId,
  activeCollectionId,
  onAddLayer,
}: {
  collectionId: string
  activeCollectionId?: string
  /** Start with an empty layer instead, adding traits one layer at a time. */
  onAddLayer?: () => void
}) {
  const upload = useFolderUpload(collectionId, activeCollectionId)
  const { detected, phase } = upload

  if (phase === 'pick')
    return (
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          <FolderDropZone onFiles={upload.pick} />
          {onAddLayer && (
            <p className="text-muted-foreground text-[0.8125rem]">
              No folder yet?{' '}
              <Button
                variant="link"
                className="text-foreground text-[0.8125rem] underline"
                onClick={onAddLayer}
              >
                Add layers one at a time
              </Button>
              .
            </p>
          )}
        </div>
        <Panel title="What to upload" bodyClassName="space-y-4">
          <p className="text-muted-foreground text-[0.8125rem]">
            One folder per layer, one image per trait. A project can hold several collections, for example
            male and female, each with its own layers.
          </p>
          <pre className="numeric bg-well text-muted-foreground shadow-inset overflow-x-auto rounded-lg px-3.5 py-3 text-xs leading-relaxed">
            {
              'my-project/\n  male/\n    1_background/\n      blue.png\n    2_body/\n      gold.png\n  female/\n    ...'
            }
          </pre>
          <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-[0.8125rem]">
            {RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </Panel>
      </div>
    )

  if (phase === 'reading' && detected) {
    const total = countTraits(detected)
    return (
      <Panel title="Checking your images" bodyClassName="space-y-3">
        <Progress value={total === 0 ? 0 : (upload.checked / total) * 100} aria-label="Images checked" />
        <p className="text-muted-foreground text-sm" aria-live="polite">
          <span className="numeric">{n(upload.checked)}</span> of <span className="numeric">{n(total)}</span>{' '}
          images checked
        </p>
      </Panel>
    )
  }

  if (!detected) return null
  const chooseAgain = (
    <Button variant="secondary" onClick={upload.reset}>
      <FolderOpenIcon />
      Choose another folder
    </Button>
  )

  if (detected.structureErrors.length > 0)
    return (
      <div className="space-y-5">
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>This folder is not laid out as layers</AlertTitle>
          <AlertDescription>
            {detected.structureErrors.map((error) => (
              <p key={error}>{error}</p>
            ))}
            <p>
              Put each image in a layer folder inside a collection folder:{' '}
              <span className="numeric">collection/layer/trait.png</span>.
            </p>
          </AlertDescription>
        </Alert>
        {chooseAgain}
      </div>
    )

  if (phase === 'review')
    return (
      <div className="space-y-5">
        <TreePreview project={detected} checks={upload.checks} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            {upload.canvas && (
              <>
                Project size{' '}
                <span className="numeric text-foreground">
                  {upload.canvas.width} x {upload.canvas.height}
                </span>
                .{' '}
              </>
            )}
            {upload.valid === 0 ? 'No image in this folder can be used.' : null}
          </p>
          <div className="flex flex-wrap gap-3">
            {chooseAgain}
            <Button onClick={upload.start} disabled={upload.valid === 0}>
              <UploadIcon />
              Upload {n(upload.valid)} {upload.valid === 1 ? 'image' : 'images'}
            </Button>
          </div>
        </div>
      </div>
    )

  // Uploading, or done.
  const layers = detected.collections.reduce((sum, c) => sum + c.layers.length, 0)
  const uploaded = upload.items.filter((item) => item.state === 'done').length
  return (
    <div className="space-y-5">
      {phase === 'done' && (
        <Panel bodyClassName="space-y-5">
          <p className="text-success-foreground flex items-center gap-2 text-sm">
            <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0" />
            Every image is uploaded. Set the order and rarity of your layers next.
          </p>
          <StatGroup>
            <Stat label="Collections" value={n(detected.collections.length)} />
            <Stat label="Layers" value={n(layers)} />
            <Stat label="Traits" value={n(uploaded)} />
            {upload.canvas && (
              <Stat label="Image size" value={`${upload.canvas.width} x ${upload.canvas.height}`} />
            )}
          </StatGroup>
          {upload.rejected > 0 && (
            <p className="text-muted-foreground text-[0.8125rem]">
              {n(upload.rejected)} {upload.rejected === 1 ? 'image was' : 'images were'} left out. You can add
              traits to any layer later.
            </p>
          )}
          <Button onClick={upload.finish}>
            Set up layers
            <ArrowRightIcon />
          </Button>
        </Panel>
      )}
      <UploadQueuePanel queue={upload.queue} items={upload.items} title="Uploading your layers" />
    </div>
  )
}
