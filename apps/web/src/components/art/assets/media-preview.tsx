'use client'

import { Artwork } from '@cobweb/ui/components/artwork'
import { cn } from '@cobweb/ui/lib/utils'
import type { MediaType } from '@/lib/demo/types'

/**
 * A single-asset file or placeholder in its frame: an image or GIF through `Artwork`, a video as a
 * muted inline player with controls and no poster, so its first frame shows.
 */
export function MediaPreview({
  src,
  mediaType,
  alt,
  seed,
  className,
  imageClassName,
  children,
}: {
  src: string | null
  mediaType: MediaType
  alt: string
  seed: string
  className?: string
  imageClassName?: string
  children?: React.ReactNode
}) {
  if (mediaType === 'video' && src) {
    return (
      <div className={cn('bg-well relative isolate aspect-square overflow-hidden', className)}>
        <video
          src={src}
          muted
          playsInline
          loop
          controls
          preload="metadata"
          aria-label={alt}
          className={cn('size-full object-contain', imageClassName)}
        />
        {children}
      </div>
    )
  }
  return (
    <Artwork src={src} alt={alt} seed={seed} className={className} imageClassName={imageClassName}>
      {children}
    </Artwork>
  )
}
