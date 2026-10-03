import { Artwork } from '@cobweb/ui/components/artwork'
import { cn } from '@cobweb/ui/lib/utils'

/**
 * A token drawn from its layer images, stacked bottom first in one square frame. With no images
 * it falls back to the empty `Artwork` frame. Layer images are transparent and the same size, so
 * each fills the frame.
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
  if (urls.length === 0)
    return (
      <Artwork alt={alt} seed={seed} label={label} className={className}>
        {children}
      </Artwork>
    )
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
          draggable={false}
          className="absolute inset-0 size-full object-contain select-none"
        />
      ))}
      {children}
    </div>
  )
}
