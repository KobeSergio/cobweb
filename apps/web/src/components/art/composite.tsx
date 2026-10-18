'use client'

import { Artwork } from '@cobweb/ui/components/artwork'
import { cn } from '@cobweb/ui/lib/utils'
import { useState } from 'react'

/**
 * A token drawn from its layer images, stacked bottom first in one square frame. With no images
 * it falls back to the empty `Artwork` frame. Layer images are transparent and the same size, so
 * each fills the frame.
 *
 * A layer image that cannot load falls back to the same frame, its pattern, as `Artwork` does with
 * its own image, never a broken-image glyph over the well: once the source sweep deleted a
 * collection's originals, every original-size view answers 404
 * (docs/specs/2026-10-17-production-hardening.md, section 7.3). The failure is kept for the URLs
 * that failed, so another token's layers draw again.
 *
 * Seam: after rendering (Phase 4) a token has one composite image; pass it as the only url.
 */
export function Composite({
  urls,
  alt,
  seed,
  label,
  className,
  eager,
  children,
}: {
  urls: string[]
  alt: string
  seed: string
  /** Shown on the empty frame. */
  label?: string
  className?: string
  /** Load at once (the large preview); grid cards load lazily. */
  eager?: boolean
  children?: React.ReactNode
}) {
  const layers = urls.join('\n')
  const [failedLayers, setFailedLayers] = useState<string | null>(null)
  if (urls.length === 0 || failedLayers === layers)
    return (
      <Artwork alt={alt} seed={seed} label={label} className={className}>
        {children}
      </Artwork>
    )
  const fail = () => setFailedLayers(layers)
  // An image that failed before the page hydrated fired its error before React listened for it: a
  // finished load with no width is a failed one (layers are PNG, and the sample's SVGs carry a size).
  const failedEarly = (image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) fail()
  }
  return (
    <div
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      data-slot="artwork"
      className={cn('relative isolate aspect-square overflow-hidden bg-well', className)}
    >
      {urls.map((url, i) => (
        <img
          key={`${i}-${url}`}
          src={url}
          alt=""
          aria-hidden="true"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          ref={failedEarly}
          onError={fail}
          draggable={false}
          className="absolute inset-0 size-full object-contain select-none"
        />
      ))}
      {children}
    </div>
  )
}
