'use client'

import { ChevronDownIcon, ShuffleIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@cobweb/ui/components/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cobweb/ui/components/select'
import type { Layer } from '@/lib/demo'
import { Composite } from '../composite'

/**
 * The live stack: one trait per layer, bottom first, with hidden layers left out. "Choose traits"
 * opens one picker per layer, top layer first, as the legacy hierarchy preview had; clicking a
 * trait card on the right does the same for the selected layer.
 */
export function LayerPreview({
  urls,
  description,
  hiddenCount,
  onShowAll,
  onRandomise,
  seed,
  layers,
  shownDna,
  onPick,
}: {
  urls: string[]
  /** What the preview shows, for screen readers: "Preview: Dusk background, Barn body, ..." */
  description: string
  hiddenCount: number
  onShowAll: () => void
  onRandomise: () => void
  seed: string
  /** The shown collection's layers, bottom first, and the trait the preview shows for each. */
  layers: Layer[]
  shownDna: string[]
  onPick: (layerId: string, traitId: string) => void
}) {
  return (
    <section
      aria-labelledby="preview-heading"
      className="bg-card overflow-hidden rounded-xl border shadow-raised"
    >
      <Composite
        urls={urls}
        alt={description}
        seed={seed}
        label="Nothing to show"
        eager
        className="border-b"
      />
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <div className="min-w-0">
          <h3 id="preview-heading" className="text-sm font-medium">
            Preview
          </h3>
          <p className="text-muted-foreground truncate text-xs" aria-live="polite">
            {hiddenCount > 0 ? (
              <>
                <span className="numeric">{hiddenCount}</span> hidden.{' '}
                <button
                  type="button"
                  onClick={onShowAll}
                  className="text-foreground underline underline-offset-2 hover:no-underline"
                >
                  Show all
                </button>
              </>
            ) : (
              'Choose a trait to see it here.'
            )}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRandomise}>
          <ShuffleIcon />
          Randomise
        </Button>
      </div>
      {layers.length > 0 && (
        <Collapsible className="border-t">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group/pick text-muted-foreground hover:text-foreground flex w-full items-center justify-between px-5 py-2.5 text-xs font-medium"
            >
              Choose traits
              <ChevronDownIcon
                aria-hidden="true"
                className="size-3.5 transition-transform group-data-[state=open]/pick:rotate-180"
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 px-5 pb-4">
            {layers
              .map((layer, i) => ({ layer, traitId: shownDna[i] ?? '' }))
              .reverse()
              .map(({ layer, traitId }) => (
                <div
                  key={layer.id}
                  className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] items-center gap-2"
                >
                  <label htmlFor={`preview-pick-${layer.id}`} className="truncate text-xs">
                    {layer.name}
                  </label>
                  <Select value={traitId} onValueChange={(value) => onPick(layer.id, value)}>
                    <SelectTrigger id={`preview-pick-${layer.id}`} size="sm" className="w-full">
                      <SelectValue placeholder="No traits" />
                    </SelectTrigger>
                    <SelectContent>
                      {layer.traits.map((trait) => (
                        <SelectItem key={trait.id} value={trait.id}>
                          {trait.blank ? `${trait.name} (blank)` : trait.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  )
}
