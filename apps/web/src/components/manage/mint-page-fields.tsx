'use client'

import { CheckIcon, ImageUpIcon, XIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { FieldError } from '@cobweb/ui/components/field'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import type { GeneratedToken } from '@/lib/demo'
import { count } from './format'

export const MAX_FEATURED = 6

/**
 * An image slot: shows the current image, takes a new one by click or drop, and checks its
 * type, size and shape. The file stays in the browser until the page is saved.
 * SEAM: on save, the file is uploaded to storage and the URL stored with the settings.
 */
export function ImageSlot({
  label,
  hint,
  value,
  onChange,
  seed,
  shape,
  maxBytes,
}: {
  label: string
  hint: string
  value: string
  onChange: (url: string) => void
  seed: string
  shape: 'banner' | 'square'
  maxBytes: number
}) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function take(file: File | undefined) {
    if (!file) return
    setError(null)
    setWarning(null)
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(file.type)) {
      setError('Use a PNG, JPG, WebP, GIF or SVG image.')
      return
    }
    if (file.size > maxBytes) {
      setError(
        `The image is ${(file.size / 1_048_576).toFixed(1)} MB. The limit is ${maxBytes / 1_048_576} MB.`,
      )
      return
    }
    setLoading(true)
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      setLoading(false)
      const ratio = image.naturalWidth / image.naturalHeight
      if (shape === 'square' && Math.abs(ratio - 1) > 0.05)
        setWarning('This image is not square, so its edges will be cropped.')
      if (shape === 'banner' && (ratio < 2.5 || ratio > 4))
        setWarning('Banners look best at 3 to 1, such as 1500 by 500. This one will be cropped.')
      onChange(url)
    }
    image.onerror = () => {
      setLoading(false)
      URL.revokeObjectURL(url)
      setError('The image could not be read. Try another file.')
    }
    image.src = url
  }

  return (
    <div className="grid gap-2">
      <p id={`${id}-label`} className="text-sm font-medium">
        {label}
      </p>
      <div className={cn('flex gap-4', shape === 'banner' ? 'flex-col' : 'items-center')}>
        <Artwork
          src={value || null}
          alt={`${label} preview`}
          seed={seed}
          label={value ? undefined : 'None'}
          className={cn(
            'border',
            shape === 'banner' ? 'aspect-[3/1] w-full rounded-xl' : 'size-24 shrink-0 rounded-xl',
          )}
        >
          {loading && (
            <span className="bg-background/60 absolute inset-0 flex items-center justify-center">
              <Spinner />
            </span>
          )}
        </Artwork>
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <label
                htmlFor={`${id}-file`}
                className="cursor-pointer has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring"
              >
                <ImageUpIcon aria-hidden="true" />
                {value ? 'Replace' : 'Upload'}
                <input
                  id={`${id}-file`}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="sr-only"
                  aria-labelledby={`${id}-label`}
                  aria-describedby={`${id}-hint`}
                  onChange={(event) => {
                    take(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
              </label>
            </Button>
            {value && (
              <Button variant="ghost" size="sm" onClick={() => onChange('')}>
                <XIcon aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
          <p id={`${id}-hint`} className="text-muted-foreground text-[0.8125rem]">
            {hint}
          </p>
          {error && <FieldError>{error}</FieldError>}
          {warning && <p className="text-warning-foreground text-[0.8125rem]">{warning}</p>}
        </div>
      </div>
    </div>
  )
}

/** Choose up to six tokens for the page's gallery strip, in the order picked. */
export function FeaturedPicker({
  candidates,
  value,
  onChange,
}: {
  candidates: GeneratedToken[]
  value: number[]
  onChange: (ids: number[]) => void
}) {
  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No token previews yet. They appear once the art is rendered.
      </p>
    )
  }
  const full = value.length >= MAX_FEATURED
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-[0.8125rem]" aria-live="polite">
        <span className="numeric text-foreground">{value.length}</span> of {MAX_FEATURED} chosen.
        {full ? ' Remove one to choose another.' : ' Shown in the order you pick them.'}
      </p>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8">
        {candidates.map((token) => {
          const position = value.indexOf(token.id)
          const chosen = position >= 0
          return (
            <li key={token.id}>
              <button
                type="button"
                aria-pressed={chosen}
                aria-label={`${token.name}${chosen ? `, featured ${position + 1}` : ''}`}
                disabled={!chosen && full}
                onClick={() =>
                  onChange(chosen ? value.filter((id) => id !== token.id) : [...value, token.id])
                }
                className={cn(
                  'group focus-visible:ring-ring focus-visible:ring-offset-background relative block w-full overflow-hidden rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                  'transition-[transform,border-color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-40',
                  chosen ? 'border-primary' : 'hover:border-border-strong',
                )}
              >
                <Artwork src={token.previewUrl} alt="" seed={String(token.id)} />
                {chosen && (
                  <span className="bg-primary text-primary-foreground numeric absolute top-1 right-1 flex size-5 items-center justify-center rounded-full text-[0.6875rem] font-semibold">
                    {position + 1}
                  </span>
                )}
                {!chosen && (
                  <span className="bg-background/70 absolute top-1 right-1 hidden size-5 items-center justify-center rounded-full group-hover:flex">
                    <CheckIcon aria-hidden="true" className="size-3" />
                  </span>
                )}
                <span className="numeric bg-background/70 text-muted-foreground absolute bottom-1 left-1 rounded-sm px-1 text-[0.625rem]">
                  #{count(token.id)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
