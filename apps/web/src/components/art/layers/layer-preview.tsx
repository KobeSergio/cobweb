'use client'

import { ShuffleIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Composite } from '../composite'

/** The live stack: one trait per layer, bottom first, with hidden layers left out. */
export function LayerPreview({
  urls,
  description,
  hiddenCount,
  onShowAll,
  onRandomise,
  seed,
}: {
  urls: string[]
  /** What the preview shows, for screen readers: "Preview: Dusk background, Barn body, ..." */
  description: string
  hiddenCount: number
  onShowAll: () => void
  onRandomise: () => void
  seed: string
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
    </section>
  )
}
