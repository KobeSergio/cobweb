import { Artwork } from '@cobweb/ui/components/artwork'
import { cn } from '@cobweb/ui/lib/utils'
import type { TokenArt } from '@/lib/mint/token-art'

/**
 * A token drawn from its layer images, stacked bottom first. Every layer is square and the same size, so they
 * line up exactly. With one layer it is just the composite image; an MP4 plays muted in a loop.
 */
export function TokenImage({
  layers,
  alt,
  className,
  eager,
  video,
}: {
  layers: string[]
  alt: string
  className?: string
  eager?: boolean
  video?: boolean
}) {
  return (
    <div role="img" aria-label={alt} className={cn('relative isolate aspect-square bg-well', className)}>
      {video && layers[0] ? (
        <video
          src={layers[0]}
          aria-hidden="true"
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        layers.map((src, index) => (
          <img
            key={`${src}-${index}`}
            src={src}
            alt=""
            aria-hidden="true"
            draggable={false}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            className="absolute inset-0 size-full object-cover select-none"
          />
        ))
      )}
    </div>
  )
}

/**
 * A token's art from its metadata: the image (or the video) once read, the empty well while it is read, and the
 * artwork pattern with the token's number when it cannot be read.
 */
export function TokenArtFrame({
  art,
  id,
  alt,
  className,
  eager,
}: {
  art: TokenArt | null | undefined
  id: number
  alt: string
  className?: string
  eager?: boolean
}) {
  if (art === null)
    return <Artwork src={null} alt={alt} seed={`token-${id}`} label={`#${id}`} className={className} />
  return (
    <TokenImage layers={art?.layers ?? []} video={art?.video} alt={alt} className={className} eager={eager} />
  )
}
