'use client'

import { CheckIcon, ClockIcon, TriangleAlertIcon } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@cobweb/ui/components/alert-dialog'
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
 * The mint page link. Before deploy the creator reserves it here (it lapses after
 * `RESERVATION_DAYS` days unless the contract is deployed); a deployed collection sets one when it
 * has none, or changes it after a warning that links already shared stop working.
 */
export function MintPageAddressField({
  collection,
  readOnly = false,
  changing = false,
  onSaved,
  onCancel,
}: {
  collection: AddressCollection
  readOnly?: boolean
  /** Deployed with a link: open straight into changing it. */
  changing?: boolean
  /** After a successful reserve or set, with the stored values. */
  onSaved?: (value: { slug: string; slug_reserved_at: string | null }) => void
  /** Leaving a change without saving. Without it, the field falls back to showing the link. */
  onCancel?: () => void
}) {
  const id = useId()
  const deployed = collection.status === 'deployed'
  const [stored, setStored] = useState({
    slug: collection.slug,
    slug_reserved_at: collection.slug_reserved_at,
  })
  const state = slugState({ ...stored, status: collection.status })
  const [editing, setEditing] = useState(state.kind === 'none' || state.kind === 'lapsed' || changing)
  const [draft, setDraft] = useState(stored.slug ?? slugify(collection.name))
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // A deployed collection that already has a link: changing it breaks links collectors hold.
  const isChange = deployed && state.kind === 'permanent'
  const action = isChange ? 'Change link' : deployed ? 'Set link' : 'Reserve link'

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

  function request() {
    if (pending || !draft) return
    if (isChange) {
      if (draft === state.slug) {
        setError('That is the current link. Enter a new one or cancel.')
        return
      }
      setConfirmOpen(true)
    } else submit()
  }

  function cancel() {
    setDraft(stored.slug ?? '')
    setError(null)
    if (onCancel) onCancel()
    else setEditing(false)
  }

  if (!editing && state.kind !== 'none' && state.kind !== 'lapsed') {
    return (
      <Field>
        <FieldTitle>Mint page link</FieldTitle>
        <div className="bg-well shadow-inset flex min-w-0 items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3">
          <span className="numeric min-w-0 flex-1 truncate text-sm">cobweb.app/{state.slug}</span>
          {!readOnly && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Change link
            </Button>
          )}
        </div>
        {state.kind === 'reserved' && (
          <FieldDescription className="flex items-center gap-1.5">
            <ClockIcon aria-hidden="true" className="size-3.5 shrink-0" />
            Reserved until <span className="numeric">{formatReservedUntil(state.until)}</span>. Deploy before
            then to keep it.
          </FieldDescription>
        )}
      </Field>
    )
  }

  const inputId = `${id}-slug`
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={inputId}>Mint page link</FieldLabel>
      {isChange && (
        <Alert variant="destructive" className="mb-1">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>Shared links will break</AlertTitle>
          <AlertDescription>
            cobweb.app/{state.slug} stops working as soon as you change it. Anyone holding the old link, in
            posts, messages or bookmarks, reaches nothing.
          </AlertDescription>
        </Alert>
      )}
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
                request()
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
            {(state.kind === 'reserved' || isChange) && (
              <Button type="button" variant="ghost" onClick={cancel} disabled={pending}>
                Cancel
              </Button>
            )}
            <Button
              type="button"
              variant={isChange ? 'destructive' : 'secondary'}
              onClick={request}
              disabled={pending || !draft}
            >
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
          Reservation lapsed. Anyone can take this link now. Reserve it again or choose another.
        </FieldDescription>
      ) : (
        <FieldDescription id={`${id}-help`}>
          {deployed
            ? 'Where collectors mint. Lowercase letters, numbers and hyphens.'
            : `Where collectors will mint. Held for ${RESERVATION_DAYS} days, then kept once you deploy. Lowercase letters, numbers and hyphens.`}
        </FieldDescription>
      )}

      {isChange && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change the mint page link?</AlertDialogTitle>
              <AlertDialogDescription>
                The page moves to <span className="numeric text-foreground">cobweb.app/{draft}</span>. Every
                link to <span className="numeric text-foreground">cobweb.app/{state.slug}</span> you have
                shared stops working.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep the current link</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={submit}>
                Change link
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Field>
  )
}
