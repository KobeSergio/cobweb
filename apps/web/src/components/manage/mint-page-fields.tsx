'use client'

import { CheckIcon, ImageUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { FieldError } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import { MEDIA_SLOTS, type MediaSlot } from '@/lib/mint/media'
import type { TokenArt } from '@/lib/mint/token-art'
import { TokenArtFrame } from '@/components/mint/token-image'
import { count } from './format'
import { pickedFileProblem, type DraftFile } from './mint-page-draft'

export const MAX_FEATURED = 6
/** How many of the rendered set the pickers show as thumbnails; any other id is added by its number. */
export const PICKER_TOKENS = 48

/** The width and height of an image file, or nulls when it cannot be read as one. */
function sizeOf(url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ width: null, height: null })
    image.src = url
  })
}

/**
 * A file picked for a slot, checked against the slot's types and caps (docs/specs/2026-10-16-mint-page-live-data.md,
 * section 4.4) with its size read for images, and refused when the browser cannot draw an image; the file stays in
 * the browser until the page is saved.
 */
export async function pickFile(
  file: File,
  slot: MediaSlot,
): Promise<{ picked: DraftFile; problem: null } | { picked: null; problem: string }> {
  const url = URL.createObjectURL(file)
  const size = file.type.startsWith('image/') ? await sizeOf(url) : { width: null, height: null }
  const problem = pickedFileProblem(slot, { mime: file.type, bytes: file.size, ...size })
  if (problem) {
    URL.revokeObjectURL(url)
    return { picked: null, problem }
  }
  return { picked: { kind: 'picked', file, url, ...size }, problem: null }
}

/**
 * An image slot: shows the current image, takes a new one by click, checks its type, size and shape, and keeps it
 * in the browser until the page is saved.
 */
export function ImageSlot({
  label,
  hint,
  value,
  onChange,
  seed,
  slot,
  shape,
}: {
  label: string
  hint: string
  value: DraftFile | null
  onChange: (value: DraftFile | null) => void
  seed: string
  slot: MediaSlot
  shape: 'banner' | 'square'
}) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function take(file: File | undefined) {
    if (!file) return
    setError(null)
    setWarning(null)
    setLoading(true)
    const { picked, problem } = await pickFile(file, slot)
    setLoading(false)
    if (!picked) return setError(problem)
    if (picked.kind === 'picked' && picked.width && picked.height) {
      const ratio = picked.width / picked.height
      if (shape === 'square' && Math.abs(ratio - 1) > 0.05)
        setWarning('This image is not square, so its edges will be cropped.')
      if (shape === 'banner' && (ratio < 2.5 || ratio > 4))
        setWarning('Banners look best at 3 to 1, such as 1500 by 500. This one will be cropped.')
    }
    onChange(picked)
  }

  return (
    <div className="grid gap-2">
      <p id={`${id}-label`} className="text-sm font-medium">
        {label}
      </p>
      <div className={cn('flex gap-4', shape === 'banner' ? 'flex-col' : 'items-center')}>
        <Artwork
          src={value?.url ?? null}
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
                className="cursor-pointer has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-45"
              >
                <ImageUpIcon aria-hidden="true" />
                {value ? 'Replace' : 'Upload'}
                <input
                  id={`${id}-file`}
                  type="file"
                  accept={MEDIA_SLOTS[slot].types.join(',')}
                  className="sr-only"
                  aria-labelledby={`${id}-label`}
                  aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
                  aria-invalid={!!error}
                  onChange={(event) => {
                    void take(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
              </label>
            </Button>
            {value && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                <XIcon aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
          <p id={`${id}-hint`} className="text-muted-foreground text-[0.8125rem]">
            {hint}
          </p>
          {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
          {warning && <p className="text-warning-foreground text-[0.8125rem]">{warning}</p>}
        </div>
      </div>
    </div>
  )
}

/** "Add by number": any token id up to the supply. */
function AddByNumber({
  supply,
  taken,
  onAdd,
  disabled,
}: {
  supply: number
  taken: number[]
  onAdd: (id: number) => void
  disabled: boolean
}) {
  const id = useId()
  const [text, setText] = useState('')
  const value = Number(text)
  const problem = !text.trim()
    ? null
    : !Number.isInteger(value) || value < 1 || value > supply
      ? `Enter a token from 1 to ${count(supply)}.`
      : taken.includes(value)
        ? 'That token is already chosen.'
        : null
  const add = () => {
    if (!text.trim() || problem) return
    onAdd(value)
    setText('')
  }
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="numeric"
          aria-label="Token number"
          aria-invalid={!!problem}
          aria-describedby={problem ? `${id}-error` : undefined}
          placeholder="Token number"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          className="w-36"
          disabled={disabled}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={add}
          disabled={disabled || !text.trim() || !!problem}
        >
          <PlusIcon aria-hidden="true" />
          Add by number
        </Button>
      </div>
      {problem && <FieldError id={`${id}-error`}>{problem}</FieldError>}
    </div>
  )
}

/**
 * Tokens of the rendered set to pick from: ids 1 to 48 (at most the supply) with thumbnails from their metadata at
 * the real job's base URI, plus any id up to the supply by its number. Without a done real job there are no
 * previews; a single asset picks none, since every token shares its image.
 */
export function TokenPicker({
  art,
  ids,
  value,
  onChange,
  max,
  realBaseUri,
  supply,
  projectType,
}: {
  art: Map<number, TokenArt | null | undefined>
  ids: number[]
  value: number[]
  onChange: (ids: number[]) => void
  max: number
  realBaseUri: string | null
  supply: number
  projectType: 'generative' | 'one_of_one' | 'single_asset'
}) {
  if (projectType === 'single_asset') {
    return (
      <p className="text-muted-foreground text-sm">
        Every token shares one image, which the page shows in place of featured tokens.
      </p>
    )
  }
  const full = value.length >= max
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-[0.8125rem]" aria-live="polite">
        <span className="numeric text-foreground">{value.length}</span> of {max} chosen.
        {full ? ' Remove one to choose another.' : ' Shown in the order you pick them.'}
      </p>
      {value.some((id) => !ids.includes(id)) && (
        <ul className="flex flex-wrap gap-2">
          {value
            .filter((id) => !ids.includes(id))
            .map((id) => (
              <li key={id}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChange(value.filter((other) => other !== id))}
                >
                  <span className="numeric">#{count(id)}</span>
                  <XIcon aria-hidden="true" />
                  <span className="sr-only">Remove</span>
                </Button>
              </li>
            ))}
        </ul>
      )}
      {realBaseUri === null ? (
        <p className="text-muted-foreground text-sm">
          No token previews yet. They appear once the art is rendered.
        </p>
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8">
          {ids.map((tokenId) => {
            const position = value.indexOf(tokenId)
            const chosen = position >= 0
            return (
              <li key={tokenId}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  aria-label={`Token ${tokenId}${chosen ? `, chosen ${position + 1}` : ''}`}
                  disabled={!chosen && full}
                  onClick={() =>
                    onChange(chosen ? value.filter((id) => id !== tokenId) : [...value, tokenId])
                  }
                  className={cn(
                    'group focus-visible:ring-ring focus-visible:ring-offset-background relative block w-full overflow-hidden rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                    'transition-[transform,border-color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-40',
                    chosen ? 'border-primary' : 'hover:border-border-strong',
                  )}
                >
                  <TokenArtFrame art={art.get(tokenId)} id={tokenId} alt="" />
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
                    #{count(tokenId)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {supply > 0 && (
        <AddByNumber supply={supply} taken={value} disabled={full} onAdd={(id) => onChange([...value, id])} />
      )}
    </div>
  )
}
