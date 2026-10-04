'use client'

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cobweb/ui/components/select'
import { Textarea } from '@cobweb/ui/components/textarea'
import type { GeneratedToken, MintPageSections as Sections } from '@/lib/demo'

/** Legacy's limits for each section (MintPageDetailsContent and its Team, Roadmap, FAQs, MusicPlayer, CarouselUploader). */
export const LIMITS = {
  name: 20,
  role: 20,
  handle: 40,
  text: 500,
  date: 20,
  title: 20,
  question: 40,
  slides: 5,
  mb: 20,
}
export const MB = 1_048_576

type WithId = { id: string }

/** An ordered list of cards with move, remove and add, as legacy's "Arrange" lists. */
export function ItemList<T extends WithId>({
  items,
  onChange,
  addLabel,
  create,
  render,
}: {
  items: T[]
  onChange: (items: T[]) => void
  addLabel: string
  create: () => T
  render: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode
}) {
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
      <Button
        type="button"
        variant="secondary"
        className="w-fit"
        onClick={() => onChange([...items, create()])}
      >
        <PlusIcon aria-hidden="true" />
        {addLabel}
      </Button>
    </>
  )
}

/** A text field with legacy's length limit and a counter. `url` asks for an https link. */
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
    required && !value.trim()
      ? `Add the ${label.toLowerCase()}.`
      : url && value.trim() && !/^https:\/\/\S+\.\S+/.test(value.trim())
        ? 'Use a link that starts with https://.'
        : null
  const props = {
    id,
    value,
    maxLength: max,
    placeholder: placeholder ?? (url ? 'https://' : undefined),
    'aria-invalid': !!error,
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
        <FieldError>{error}</FieldError>
      ) : (
        <FieldDescription className="numeric">
          {value.length} / {max}
        </FieldDescription>
      )}
    </Field>
  )
}

/** One file chosen in the browser, checked for type and the 20 MB limit. */
export function FilePick({
  label,
  accept,
  hint,
  check,
  onFile,
  onRemove,
  icon,
}: {
  label: string
  accept: string
  hint: string
  check: (file: File) => string | null
  onFile: (file: File, url: string) => void
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
            className="cursor-pointer has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring"
          >
            <UploadIcon aria-hidden="true" />
            Choose a file
            <input
              id={id}
              type="file"
              accept={accept}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                const problem =
                  check(file) ?? (file.size > LIMITS.mb * MB ? `The file is over ${LIMITS.mb} MB.` : null)
                setError(problem)
                if (!problem) onFile(file, URL.createObjectURL(file))
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
      <p className="text-muted-foreground text-[0.8125rem]">{hint}</p>
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

/** Up to five slides: uploaded images or MP4s, or the collection's own tokens. */
export function Carousel({
  items,
  candidates,
  onChange,
}: {
  items: Sections['carousel']['items']
  candidates: GeneratedToken[]
  onChange: (items: Sections['carousel']['items']) => void
}) {
  const full = items.length >= LIMITS.slides
  const pickable = candidates.filter(
    (token) => !items.some((item) => item.kind === 'token' && item.tokenId === token.id),
  )
  return (
    <div className="grid gap-4">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {items.map((item) => {
          const token =
            item.kind === 'token' ? candidates.find((entry) => entry.id === item.tokenId) : undefined
          return (
            <li key={item.id} className="relative">
              <Artwork
                src={
                  item.kind === 'upload'
                    ? item.mediaType === 'image'
                      ? item.url
                      : null
                    : (token?.previewUrl ?? null)
                }
                alt=""
                seed={item.id}
                label={item.kind === 'upload' && item.mediaType === 'video' ? 'MP4' : undefined}
                className="rounded-lg border"
              />
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
          )
        })}
      </ul>
      <p className="text-muted-foreground text-[0.8125rem]">
        <span className="numeric">{items.length}</span> of {LIMITS.slides} slides. PNG, JPG, GIF or MP4, up to
        20 MB each.
      </p>
      {!full && (
        <div className="flex flex-wrap items-center gap-3">
          <FilePick
            label=""
            accept="image/png,image/jpeg,image/gif,video/mp4"
            hint=""
            check={(file) =>
              /^(image\/(png|jpeg|gif)|video\/mp4)$/.test(file.type) ? null : 'Use a PNG, JPG, GIF or MP4.'
            }
            onFile={(file, url) =>
              onChange([
                ...items,
                {
                  id: `slide-${Date.now()}`,
                  kind: 'upload',
                  url,
                  fileName: file.name,
                  mediaType: file.type === 'video/mp4' ? 'video' : 'image',
                },
              ])
            }
            icon={null}
          />
          {pickable.length > 0 && (
            <Select
              value=""
              onValueChange={(tokenId) =>
                onChange([...items, { id: `slide-${Date.now()}`, kind: 'token', tokenId: Number(tokenId) }])
              }
            >
              <SelectTrigger className="w-48" aria-label="Add a token">
                <SelectValue placeholder="Add a token" />
              </SelectTrigger>
              <SelectContent>
                {pickable.slice(0, 50).map((token) => (
                  <SelectItem key={token.id} value={String(token.id)}>
                    {token.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  )
}
