'use client'

import { CheckIcon, ClockIcon, LockIcon, TriangleAlertIcon } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel, FieldTitle } from '@cobweb/ui/components/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@cobweb/ui/components/input-group'
import { Spinner } from '@cobweb/ui/components/spinner'
import { reserveSlug } from '@/app/actions/mint-page-address'
import { formatReservedUntil, RESERVATION_DAYS, slugify, slugState } from '@/lib/collections'
import type { Tables } from '@/lib/database.types'

export type AddressCollection = Pick<
  Tables<'collections'>,
  'id' | 'name' | 'slug' | 'slug_reserved_at' | 'status'
>

/**
 * The mint page address: reserve it before deploy (it lapses after `RESERVATION_DAYS` days unless
 * the contract is deployed), or set it once on a deployed collection that has none. Shows the
 * reservation and lets the creator change it while it is not yet permanent.
 */
export function MintPageAddressField({
  collection,
  readOnly = false,
  onSaved,
}: {
  collection: AddressCollection
  readOnly?: boolean
  /** After a successful reserve or set, with the stored values. */
  onSaved?: (value: { slug: string; slug_reserved_at: string | null }) => void
}) {
  const id = useId()
  const deployed = collection.status === 'deployed'
  const [stored, setStored] = useState({
    slug: collection.slug,
    slug_reserved_at: collection.slug_reserved_at,
  })
  const state = slugState({ ...stored, status: collection.status })
  const [editing, setEditing] = useState(state.kind === 'none' || state.kind === 'lapsed')
  const [draft, setDraft] = useState(stored.slug ?? slugify(collection.name))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const action = deployed ? 'Set address' : 'Reserve'

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await reserveSlug(collection.id, draft)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const next = { slug: result.slug, slug_reserved_at: result.reservedAt }
      setStored(next)
      setDraft(result.slug)
      setEditing(false)
      onSaved?.(next)
    })
  }

  if (!editing && state.kind !== 'none' && state.kind !== 'lapsed') {
    return (
      <Field>
        <FieldTitle>Mint page address</FieldTitle>
        <div className="bg-well shadow-inset flex min-w-0 items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3">
          <span className="numeric min-w-0 flex-1 truncate text-sm">cobweb.app/{state.slug}</span>
          {state.kind === 'reserved' && !readOnly && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Change
            </Button>
          )}
        </div>
        {state.kind === 'reserved' ? (
          <FieldDescription className="flex items-center gap-1.5">
            <ClockIcon aria-hidden="true" className="size-3.5 shrink-0" />
            Reserved until <span className="numeric">{formatReservedUntil(state.until)}</span>. Deploy before
            then to keep it.
          </FieldDescription>
        ) : (
          <FieldDescription className="flex items-center gap-1.5">
            <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
            Permanent. It cannot change.
          </FieldDescription>
        )}
      </Field>
    )
  }

  const inputId = `${id}-slug`
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={inputId}>Mint page address</FieldLabel>
      <div className="flex flex-col gap-2 sm:flex-row">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <InputGroupText className="numeric">cobweb.app/</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (!pending && draft) submit()
              }
            }}
            maxLength={48}
            autoComplete="off"
            spellCheck={false}
            readOnly={readOnly || pending}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : `${id}-help`}
            className="numeric pl-0.5"
          />
        </InputGroup>
        {!readOnly && (
          <div className="flex gap-2">
            {state.kind === 'reserved' && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(false)
                  setDraft(state.slug)
                  setError(null)
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={submit} disabled={pending || !draft}>
              {pending ? <Spinner /> : <CheckIcon />}
              {action}
            </Button>
          </div>
        )}
      </div>
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : state.kind === 'lapsed' ? (
        <FieldDescription id={`${id}-help`} className="flex items-center gap-1.5">
          <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
          Reservation lapsed. Anyone can take this address now. Reserve it again or choose another.
        </FieldDescription>
      ) : (
        <FieldDescription id={`${id}-help`}>
          {deployed
            ? 'Where collectors mint. Permanent once set. Lowercase letters, numbers and hyphens.'
            : `Where collectors will mint. Held for ${RESERVATION_DAYS} days, then permanent once you deploy. Lowercase letters, numbers and hyphens.`}
        </FieldDescription>
      )}
    </Field>
  )
}
