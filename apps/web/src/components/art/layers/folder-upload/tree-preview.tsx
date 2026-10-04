'use client'

import { CircleAlertIcon, FolderIcon, LayersIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Badge } from '@cobweb/ui/components/badge'
import { Panel } from '@cobweb/ui/components/panel'
import type { DetectedProject } from './folder-tree'
import type { TraitCheck } from './use-folder-upload'

const n = (value: number) => value.toLocaleString('en-US')
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`

/** Rejected files listed at once; the rest are counted. */
const REJECTED_LIMIT = 100

/** What was found in the folder: collections, their layers (bottom first) and trait counts. */
export function TreePreview({
  project,
  checks,
}: {
  project: DetectedProject
  checks: ReadonlyMap<string, TraitCheck>
}) {
  const bad = (key: string) => (checks.get(key)?.errors.length ?? 0) > 0
  const rejected = project.collections.flatMap((c) =>
    c.layers.flatMap((layer) => layer.traits.filter((trait) => bad(trait.key))),
  )

  return (
    <div className="space-y-5">
      <Panel
        title={project.projectName ?? 'Your folder'}
        description={`${plural(project.collections.length, 'collection')}. Layers stack in folder order, the first at the bottom; you can reorder them next.`}
        bodyClassName="p-0"
      >
        <ul className="divide-y">
          {project.collections.map((collection) => (
            <li key={collection.folder} className="space-y-3 px-6 py-5">
              <p className="flex items-center gap-2 text-sm font-medium">
                <FolderIcon aria-hidden="true" className="text-muted-foreground size-4" />
                {collection.name}
                <span className="text-muted-foreground font-normal">
                  {plural(collection.layers.length, 'layer')}
                </span>
              </p>
              <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {collection.layers.map((layer, index) => {
                  const failed = layer.traits.filter((trait) => bad(trait.key)).length
                  return (
                    <li
                      key={layer.folder}
                      className="bg-surface-2 flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="numeric text-muted-foreground w-5 shrink-0 text-xs">
                          {index + 1}
                        </span>
                        <LayersIcon aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
                        <span className="truncate" title={layer.folder}>
                          {layer.name}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="text-muted-foreground text-xs">
                          <span className="numeric">{n(layer.traits.length - failed)}</span>{' '}
                          {layer.traits.length - failed === 1 ? 'trait' : 'traits'}
                        </span>
                        {failed > 0 && <Badge variant="destructive">{n(failed)} not usable</Badge>}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </li>
          ))}
        </ul>
      </Panel>

      {rejected.length > 0 && (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{plural(rejected.length, 'image')} cannot be used and will be left out</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 max-h-56 space-y-1.5 overflow-y-auto">
              {rejected.slice(0, REJECTED_LIMIT).map((trait) => (
                <li key={trait.key}>
                  <span className="text-foreground font-medium">{trait.path.replace(/^\/+/, '')}</span>{' '}
                  {checks.get(trait.key)?.errors.join(' ')}
                </li>
              ))}
            </ul>
            {rejected.length > REJECTED_LIMIT && (
              <p className="mt-2">And {plural(rejected.length - REJECTED_LIMIT, 'more image')}.</p>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
