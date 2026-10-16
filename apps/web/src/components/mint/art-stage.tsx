'use client'

import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { EASE_OUT } from '@cobweb/ui/lib/motion'
import { cn } from '@cobweb/ui/lib/utils'
import type { TokenArt } from '@/lib/mint/token-art'
import { useMint } from './mint-context'
import { TokenArtFrame } from './token-image'
import { useTokenArt } from './use-token-art'

/** One card of the stage: a token by its id, or an uploaded slide. */
type Card = { key: string; label: string; tokenId: number | null; art: TokenArt | null | undefined }

/** Where each card sits: the front one, two leaning behind it, the rest tucked away. */
const SLOTS = [
  { x: '0%', y: '0%', rotate: 0, scale: 1, opacity: 1, shade: 0 },
  { x: '15%', y: '-5%', rotate: 5, scale: 0.86, opacity: 1, shade: 0.45 },
  { x: '-14%', y: '-3%', rotate: -6, scale: 0.8, opacity: 1, shade: 0.6 },
]
const HIDDEN = { x: '0%', y: '-2%', rotate: 0, scale: 0.74, opacity: 0, shade: 0.7 }
const CYCLE_MS = 5600

/** The average colour of an image, sampled small. Used only for the faint light behind the art. */
async function ambientOf(src: string): Promise<string | null> {
  const img = new Image()
  img.src = src
  try {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 12
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, 12, 12)
    const pixels = ctx.getImageData(0, 0, 12, 12).data
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < pixels.length; i += 4) {
      r += pixels[i]!
      g += pixels[i + 1]!
      b += pixels[i + 2]!
    }
    const n = pixels.length / 4
    return `${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)}`
  } catch {
    return null
  }
}

/**
 * What the stage shows (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7): the carousel's slides when it
 * is on (uploads always, token slides once revealed), else the featured tokens once revealed, else one card with
 * token 1's art at the state's base URI (the placeholder's image before the reveal, the one image of a single
 * asset), else the avatar until the state answers.
 */
function useCards(): Card[] {
  const { page, live, source } = useMint()
  const revealed = live?.revealed ?? false
  const carousel = page.sections.carousel
  const slides = useMemo(
    () => (carousel ?? []).filter((slide) => slide.kind === 'upload' || revealed),
    [carousel, revealed],
  )
  const tokenIds = useMemo(() => {
    if (!live) return []
    if (slides.length) return slides.flatMap((slide) => (slide.kind === 'token' ? [slide.tokenId] : []))
    if (revealed && page.featuredTokenIds.length) return page.featuredTokenIds
    return [1]
  }, [live, slides, revealed, page.featuredTokenIds])
  const art = useTokenArt(source, live?.baseUri ?? null, tokenIds)
  const tokenCard = (id: number): Card => ({
    key: `token-${id}`,
    label: `#${id}`,
    tokenId: id,
    art: art.get(id),
  })
  if (!live)
    return [
      {
        key: 'avatar',
        label: page.name,
        tokenId: null,
        art: page.avatarUrl ? { layers: [page.avatarUrl], video: false } : null,
      },
    ]
  if (slides.length)
    return slides.map((slide) =>
      slide.kind === 'token'
        ? tokenCard(slide.tokenId)
        : {
            key: slide.id,
            label: slide.fileName,
            tokenId: null,
            art: { layers: [slide.url], video: slide.mediaType === 'video' },
          },
    )
  return tokenIds.map(tokenCard)
}

/**
 * The hero artwork: the front card held up with two more leaning behind it. The stack turns over slowly so a
 * visitor sees a few tokens without doing anything; it pauses on hover or focus, has its own pause control, and
 * stays still with reduced motion. A faint light in the front image's own colour sits behind the stack.
 */
export function ArtStage() {
  const { page } = useMint()
  const featured = useCards()
  const collectionName = page.name
  const reduce = useReducedMotion()
  const [front, setFront] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [ambient, setAmbient] = useState<Record<string, string>>({})
  const count = featured.length
  const current = featured[front]
  const autoplay = !reduce && !paused && !hovering && count > 1

  useEffect(() => {
    if (!autoplay) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setFront((value) => (value + 1) % count)
    }, CYCLE_MS)
    return () => window.clearInterval(id)
  }, [autoplay, count])

  const frontImage = current?.art && !current.art.video ? (current.art.layers.at(-1) ?? null) : null
  useEffect(() => {
    if (!frontImage || ambient[frontImage]) return
    let cancelled = false
    void ambientOf(frontImage).then((rgb) => {
      if (!cancelled && rgb) setAmbient((map) => ({ ...map, [frontImage]: rgb }))
    })
    return () => {
      cancelled = true
    }
  }, [frontImage, ambient])

  if (!current) return null
  const glow = frontImage ? ambient[frontImage] : undefined
  const move = (step: number) => setFront((value) => (value + step + count) % count)

  return (
    <section
      aria-roledescription="carousel"
      aria-label={`${collectionName} art`}
      className="relative"
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      {/* The light behind the art, in the front token's own colour. */}
      <AnimatePresence initial={false}>
        {glow && (
          <motion.div
            key={glow}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-[18%] -z-10"
            style={{
              background: `radial-gradient(50% 46% at 50% 48%, rgb(${glow} / 0.34), rgb(${glow} / 0.08) 55%, transparent 75%)`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 1.2, ease: EASE_OUT }}
          />
        )}
      </AnimatePresence>

      <div className="relative mx-auto aspect-square w-[84%] max-w-[34rem] sm:w-[76%] lg:w-[82%]">
        {featured.map((token, index) => {
          const position = (index - front + count) % count
          const slot = SLOTS[position] ?? HIDDEN
          return (
            <motion.div
              key={token.key}
              aria-hidden={position !== 0}
              className="absolute inset-0 origin-bottom overflow-hidden rounded-xl border border-border-strong bg-well shadow-overlay"
              style={{ zIndex: SLOTS.length - Math.min(position, SLOTS.length) }}
              initial={false}
              animate={{
                x: slot.x,
                y: slot.y,
                rotate: slot.rotate,
                scale: slot.scale,
                opacity: slot.opacity,
              }}
              transition={{ duration: reduce ? 0 : 0.9, ease: EASE_OUT }}
            >
              <TokenArtFrame
                art={token.art}
                id={token.tokenId ?? 0}
                alt={`${collectionName} ${token.label}`}
                eager={index < 3}
                className="size-full"
              />
              <motion.span
                aria-hidden="true"
                className="absolute inset-0 bg-background"
                initial={false}
                animate={{ opacity: slot.shade }}
                transition={{ duration: reduce ? 0 : 0.9, ease: EASE_OUT }}
              />
            </motion.div>
          )
        })}
      </div>

      <div className="mx-auto mt-6 flex w-[84%] max-w-[34rem] items-center justify-between gap-4 sm:w-[76%] lg:w-[82%]">
        <p className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
          <span className="font-medium text-foreground">{collectionName}</span>{' '}
          <span className="numeric">{current.label}</span>
        </p>
        <div className={cn('flex shrink-0 items-center gap-1', count < 2 && 'invisible')}>
          <Button variant="ghost" size="icon-sm" aria-label="Previous token" onClick={() => move(-1)}>
            <ChevronLeftIcon />
          </Button>
          {!reduce && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={paused ? 'Play the slideshow' : 'Pause the slideshow'}
              aria-pressed={paused}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Next token" onClick={() => move(1)}>
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <div
        className={cn('mx-auto mt-4 hidden w-[82%] max-w-[34rem] gap-2', count > 1 && 'lg:flex')}
        role="group"
        aria-label="Choose a token"
      >
        {featured.map((token, index) => (
          <button
            key={token.key}
            type="button"
            aria-label={`Show ${collectionName} ${token.label}`}
            aria-current={index === front}
            onClick={() => setFront(index)}
            className={cn(
              'relative aspect-square w-12 cursor-pointer overflow-hidden rounded-md border outline-none transition-[opacity,border-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px',
              index === front ? 'border-foreground/60' : 'border-border opacity-55 hover:opacity-90',
            )}
          >
            <TokenArtFrame art={token.art} id={token.tokenId ?? 0} alt="" className="size-full" />
          </button>
        ))}
      </div>
    </section>
  )
}
