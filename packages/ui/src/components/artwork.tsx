'use client'

import * as React from 'react'
import { cn } from '@cobweb/ui/lib/utils'

/** A small, stable hash so the same seed always draws the same web. */
function hash(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function random(seed: string) {
  let state = hash(seed) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 10_000) / 10_000
  }
}

/**
 * A cobweb strung across the top-right corner of an empty frame. Spokes fan out from the corner;
 * threads sag between them. The seed varies the spokes, rings and sag, so each collection without
 * art still gets its own picture.
 */
function CornerWeb({ seed, className }: { seed: string; className?: string }) {
  const paths = React.useMemo(() => {
    const rand = random(seed)
    const corner = { x: 100, y: 0 }
    const spokeCount = 6 + Math.floor(rand() * 3)
    const reach = 78 + rand() * 30
    const spokes: number[] = []
    for (let i = 0; i < spokeCount; i++) {
      const t = (i + 0.15 + rand() * 0.7) / spokeCount
      spokes.push((Math.PI / 2) * (1 + t))
    }
    spokes.sort((a, b) => a - b)
    const ringCount = 5 + Math.floor(rand() * 3)
    const lines: string[] = []
    const at = (angle: number, r: number) => ({
      x: corner.x + Math.cos(angle) * r,
      y: corner.y - Math.sin(angle) * r * -1,
    })
    for (const angle of spokes) {
      const end = at(angle, reach * (0.86 + rand() * 0.2))
      lines.push(`M${corner.x} ${corner.y}L${end.x.toFixed(2)} ${end.y.toFixed(2)}`)
    }
    for (let ring = 1; ring <= ringCount; ring++) {
      const r = (reach / (ringCount + 0.6)) * ring * (0.92 + rand() * 0.12)
      let d = ''
      for (let i = 0; i < spokes.length - 1; i++) {
        const a = at(spokes[i]!, r)
        const b = at(spokes[i + 1]!, r)
        const mid = (spokes[i]! + spokes[i + 1]!) / 2
        // Threads sag toward the corner.
        const sag = at(mid, r * (0.8 + rand() * 0.08))
        d += `${i === 0 ? `M${a.x.toFixed(2)} ${a.y.toFixed(2)}` : ''}Q${sag.x.toFixed(2)} ${sag.y.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
      }
      lines.push(d)
    }
    return lines
  }, [seed])

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMaxYMin slice"
      className={cn('pointer-events-none absolute inset-0 size-full', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="0.35"
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}

/**
 * Where a collection's artwork goes. With `src`, the image fills the frame. Without one (or if
 * it fails to load), the frame stays empty, lit from above, with a cobweb in the corner drawn
 * from `seed`. Pass a stable seed, such as the collection id.
 *
 * The frame takes the radius and aspect you give it through `className` (default: square).
 */
function Artwork({
  src,
  alt,
  seed,
  label,
  className,
  imageClassName,
  children,
}: {
  src?: string | null
  alt: string
  seed: string
  /** Shown on the empty frame, bottom left. For example "No art yet". */
  label?: React.ReactNode
  className?: string
  imageClassName?: string
  /** Overlays: badges, a gradient scrim, a hover action. */
  children?: React.ReactNode
}) {
  const [failed, setFailed] = React.useState(false)
  const showImage = !!src && !failed

  return (
    <div
      data-slot="artwork"
      data-empty={!showImage || undefined}
      className={cn('relative isolate aspect-square overflow-hidden bg-well', className)}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn('size-full object-cover', imageClassName)}
        />
      ) : (
        <>
          <span aria-hidden="true" className="spotlight absolute inset-0" />
          <CornerWeb seed={seed} className="text-foreground/14" />
          <span role="img" aria-label={alt} className="sr-only" />
          {label && (
            <span className="absolute bottom-3 left-3 z-10 inline-flex h-6 items-center rounded-full border border-border-strong bg-background/70 px-2.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
              {label}
            </span>
          )}
        </>
      )}
      {children}
    </div>
  )
}

export { Artwork, CornerWeb }
