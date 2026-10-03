import { cn } from '@cobweb/ui/lib/utils'

/**
 * A token drawn from its layer images, stacked bottom first. Every layer is square and the same
 * size, so they line up exactly. With one layer it is just the composite image.
 */
export function TokenImage({
  layers,
  alt,
  className,
  eager,
}: {
  layers: string[]
  alt: string
  className?: string
  eager?: boolean
}) {
  return (
    <div role="img" aria-label={alt} className={cn('relative isolate aspect-square bg-well', className)}>
      {layers.map((src, index) => (
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
      ))}
    </div>
  )
}
