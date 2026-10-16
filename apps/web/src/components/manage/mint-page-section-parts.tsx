'use client'

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Textarea } from '@cobweb/ui/components/textarea'
import { TokenArtFrame } from '@/components/mint/token-image'
import { MEDIA_SLOTS, type MediaSlot } from '@/lib/mint/media'
import type { TokenArt } from '@/lib/mint/token-art'
import {
  LIMITS,
  memberLinkError,
  tokenArtSource,
  type DraftFile,
  type DraftSlide,
  type DraftUploadSlide,
} from './mint-page-draft'
import { pickFile, TokenPicker } from './mint-page-fields'

type WithId = { id: string }

/**
 * An ordered list of cards with move, remove and add, as legacy's "Arrange" lists, up to `max` cards: at the cap
 * the add button gives way to a line naming it, which takes the focus when an add reached the cap.
 */
export function ItemList<T extends WithId>({
  items,
  onChange,
  addLabel,
  create,
  render,
  max,
  noun,
}: {
  items: T[]
  onChange: (items: T[]) => void
  addLabel: string
  create: () => T
  render: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode
  /** The most cards the save takes. */
  max: number
  /** What the cards are, plural, for the line at the cap: "Up to 12 members." */
  noun: string
}) {
  const full = items.length >= max
  const limit = useRef<HTMLParagraphElement>(null)
  const added = useRef(false)
  // The add button goes at the cap, so the focus it had moves to the line in its place.
  useEffect(() => {
    if (added.current && full) limit.current?.focus()
    added.current = false
  }, [full, items.length])
  const move = (from: number, to: number) => {
    const next = [...items]
    next.splice(to, 0, next.splice(from, 1)[0]!)
    onChange(next)
  }
  return (
    <>
      <ol className="grid gap-3">
        {items.map((item, index) => (
          <li key={item.id} className="bg-surface-2/40 grid gap-3 rounded-lg border p-4">
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Move down"
                disabled={index === items.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove"
                onClick={() => onChange(items.filter((other) => other.id !== item.id))}
              >
                <Trash2Icon />
              </Button>
            </div>
            {render(item, (patch) =>
              onChange(items.map((other) => (other.id === item.id ? { ...other, ...patch } : other))),
            )}
          </li>
        ))}
      </ol>
      {full ? (
        <p
          ref={limit}
          tabIndex={-1}
          className="text-muted-foreground focus-visible:ring-ring rounded-sm text-[0.8125rem] outline-none focus-visible:ring-2"
        >
          Up to {max} {noun}.
        </p>
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="w-fit"
          onClick={() => {
            added.current = true
            onChange([...items, create()])
          }}
        >
          <PlusIcon aria-hidden="true" />
          {addLabel}
        </Button>
      )}
    </>
  )
}

/** A text field with legacy's length limit and a counter. `url` asks for a team member's link, as the save checks it. */
export function Text({
  label,
  value,
  max,
  onChange,
  multiline,
  required,
  url,
  placeholder,
}: {
  label: string
  value: string
  max: number
  onChange: (value: string) => void
  multiline?: boolean
  required?: boolean
  url?: boolean
  placeholder?: string
}) {
  const id = useId()
  const error =
    required && !value.trim() ? `Add the ${label.toLowerCase()}.` : url ? memberLinkError(value) : null
  const props = {
    id,
    value,
    maxLength: max,
    placeholder: placeholder ?? (url ? 'https://' : undefined),
    'aria-invalid': !!error,
    'aria-describedby': error ? `${id}-error` : undefined,
  }
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea {...props} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input {...props} onChange={(event) => onChange(event.target.value)} />
      )}
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : (
        <FieldDescription className="numeric">
          {value.length} / {max}
        </FieldDescription>
      )}
    </Field>
  )
}

/** One file picked in the browser for a slot, checked against the slot's types and caps; it stays there until Save. */
export function FilePick({
  label,
  slot,
  hint,
  onFile,
  onRemove,
  icon,
}: {
  label: string
  slot: MediaSlot
  hint: string
  onFile: (picked: DraftFile, file: File) => void
  onRemove?: () => void
  icon: React.ReactNode
}) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm">
          {icon}
          {label}
        </span>
        <Button variant="secondary" size="sm" asChild>
          <label
            htmlFor={id}
            className="cursor-pointer has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-45"
          >
            <UploadIcon aria-hidden="true" />
            Choose a file
            <input
              id={id}
              type="file"
              accept={MEDIA_SLOTS[slot].types.join(',')}
              className="sr-only"
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                void pickFile(file, slot).then(({ picked, problem }) => {
                  setError(problem)
                  if (picked) onFile(picked, file)
                })
              }}
            />
          </label>
        </Button>
        {onRemove && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      {hint && <p className="text-muted-foreground text-[0.8125rem]">{hint}</p>}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  )
}

/**
 * Up to five slides: uploaded images or MP4s, or the collection's own tokens, picked from the rendered set or by
 * their number. Token slides show on the page once the collection is revealed.
 */
export function Carousel({
  items,
  onChange,
  onUpload,
  art,
  ids,
  realBaseUri,
  supply,
  projectType,
}: {
  items: DraftSlide[]
  onChange: (items: DraftSlide[]) => void
  /** Adds an uploaded slide once its file is read, to the slides as they are then (withUploadSlide). */
  onUpload: (slide: DraftUploadSlide) => void
  art: Map<number, TokenArt | null | undefined>
  ids: number[]
  realBaseUri: string | null
  supply: number
  projectType: 'generative' | 'one_of_one' | 'single_asset'
}) {
  const full = items.length >= LIMITS.slides
  const uploads = items.filter((item) => item.kind === 'upload').length
  const tokenIds = items.flatMap((item) => (item.kind === 'token' ? [item.tokenId] : []))
  const tokenArt = tokenArtSource(realBaseUri, projectType)
  /** Keeps the uploads where they are, drops the tokens unpicked and adds the tokens picked, at the end. */
  const pickTokens = (picked: number[]) => {
    const kept = items.filter((item) => item.kind === 'upload' || picked.includes(item.tokenId))
    const added = picked
      .filter((id) => !tokenIds.includes(id))
      .map((tokenId): DraftSlide => ({ id: `slide-${Date.now()}-${tokenId}`, kind: 'token', tokenId }))
    onChange([...kept, ...added])
  }
  return (
    <div className="grid gap-4">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {items.map((item) => (
          <li key={item.id} className="relative">
            {item.kind === 'token' ? (
              // Without a base no metadata is read: the pattern, not a well that never fills.
              tokenArt === 'metadata' ? (
                <TokenArtFrame
                  art={art.get(item.tokenId)}
                  id={item.tokenId}
                  alt=""
                  className="overflow-hidden rounded-lg border"
                />
              ) : (
                <Artwork src={null} alt="" seed={item.id} className="rounded-lg border" />
              )
            ) : (
              <Artwork
                src={item.mediaType === 'image' ? item.media.url : null}
                alt=""
                seed={item.id}
                label={item.mediaType === 'video' ? 'MP4' : undefined}
                className="rounded-lg border"
              />
            )}
            <span className="numeric bg-background/70 absolute bottom-1 left-1 rounded-sm px-1 text-[0.625rem]">
              {item.kind === 'token' ? `#${item.tokenId}` : item.fileName.slice(0, 12)}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              className="absolute top-1 right-1"
              aria-label="Remove slide"
              onClick={() => onChange(items.filter((other) => other.id !== item.id))}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-[0.8125rem]">
        <span className="numeric">{items.length}</span> of {LIMITS.slides} slides. PNG, JPG, WebP or GIF up to
        5 MB, or an MP4 up to 20 MB. Token slides show once the collection is revealed.
      </p>
      {!full && (
        <FilePick
          label=""
          slot="slide"
          hint=""
          onFile={(media, file) =>
            onUpload({
              id: `slide-${Date.now()}`,
              kind: 'upload',
              fileName: file.name.slice(0, 100) || 'slide',
              mediaType: file.type === 'video/mp4' ? 'video' : 'image',
              media,
            })
          }
          icon={null}
        />
      )}
      <div className="grid gap-2">
        <p className="text-sm font-medium">Add a token</p>
        <TokenPicker
          art={art}
          ids={ids}
          value={tokenIds}
          onChange={pickTokens}
          max={LIMITS.slides - uploads}
          realBaseUri={realBaseUri}
          supply={supply}
          projectType={projectType}
        />
      </div>
    </div>
  )
}
