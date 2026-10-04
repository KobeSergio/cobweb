'use client'

import { ArrowRightIcon, ClockIcon, LockIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Spinner } from '@cobweb/ui/components/spinner'
import { Textarea } from '@cobweb/ui/components/textarea'
import { updateCollectionDetails, type UpdateDetailsState } from '@/app/actions/collection-details'
import { StageFooter } from '@/components/shell/stage-footer'
import type { Tables } from '@/lib/database.types'
import { formatReservedUntil, PROJECT_TYPES, slugState, SUPPLY_SOURCE, supplyLimit } from '@/lib/collections'
import { frozenDetailFields, type FlowLink } from '@/lib/steps'

const INITIAL_STATE: UpdateDetailsState = {}

type Props = {
  collection: Pick<
    Tables<'collections'>,
    | 'id'
    | 'name'
    | 'symbol'
    | 'slug'
    | 'slug_reserved_at'
    | 'description'
    | 'max_supply'
    | 'project_type'
    | 'status'
  >
  /** Where "Save and continue" leads once the details are saved (Art). */
  next?: FlowLink
  /** A deployed collection: Setup is history, so nothing is editable and there is nothing to save. */
  readOnly?: boolean
}

/** Back from Details leads out of the collection. */
const BACK_TO_COLLECTIONS: FlowLink = { href: '/collections', name: 'Collections' }

/** Why a field is read-only, shown under it. */
function FrozenNote({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <FieldDescription id={id} className="flex items-center gap-1.5">
      <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </FieldDescription>
  )
}

/** Where the mint page link stands. It is reserved in Deploy, not edited here. */
function AddressLine({ collection }: { collection: Props['collection'] }) {
  const state = slugState(collection)
  return (
    <Field>
      <FieldTitle>Mint page link</FieldTitle>
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        {state.kind === 'permanent' ? (
          <>
            <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="numeric text-foreground">cobweb.app/{state.slug}</span>
          </>
        ) : state.kind === 'reserved' ? (
          <>
            <ClockIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span>
              <span className="numeric text-foreground">cobweb.app/{state.slug}</span>, reserved until{' '}
              <span className="numeric">{formatReservedUntil(state.until)}</span>.
            </span>
          </>
        ) : state.kind === 'lapsed' ? (
          'Reservation lapsed. Reserve it again in Deploy.'
        ) : collection.status === 'deployed' ? (
          'Not set yet. Set it in Manage drop, Mint page.'
        ) : (
          'Not reserved yet. Reserve it in Deploy.'
        )}
      </p>
    </Field>
  )
}

/**
 * The Details screen: edit the collection's name, symbol and description; the supply and type are
 * shown read-only (the supply is set at Generate or from the uploads). "Save and
 * continue" saves, then goes on to Art; a failed save stays here with its errors.
 */
export function DetailsForm({ collection, next, readOnly = false }: Props) {
  const router = useRouter()
  const action = updateCollectionDetails.bind(null, collection.id)
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)
  // Each submit returns a new state object, so this runs once per successful save.
  useEffect(() => {
    if (state.saved && next) router.push(next.href)
  }, [state, next, router])
  const [symbol, setSymbol] = useState(collection.symbol)
  const [description, setDescription] = useState(collection.description)

  const frozen = frozenDetailFields(collection.status)
  const errors = state.fieldErrors ?? {}
  const type = PROJECT_TYPES.find((entry) => entry.value === collection.project_type)
  const deployedNote = 'Fixed at deployment.'

  return (
    <form action={formAction} className="flex flex-1 flex-col gap-8">
      <FieldGroup className="gap-7">
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field data-invalid={!!errors.name} data-disabled={frozen.has('name')}>
            <FieldLabel htmlFor="details-name">Name</FieldLabel>
            <Input
              id="details-name"
              name="name"
              defaultValue={collection.name}
              maxLength={64}
              autoComplete="off"
              readOnly={frozen.has('name')}
              aria-invalid={!!errors.name}
              aria-describedby={
                errors.name ? 'details-name-error' : frozen.has('name') ? 'details-name-frozen' : undefined
              }
              required
            />
            {errors.name ? (
              <FieldError id="details-name-error">{errors.name}</FieldError>
            ) : (
              frozen.has('name') && <FrozenNote id="details-name-frozen">{deployedNote}</FrozenNote>
            )}
          </Field>
          <Field data-invalid={!!errors.symbol} data-disabled={frozen.has('symbol')}>
            <FieldLabel htmlFor="details-symbol">Symbol</FieldLabel>
            <Input
              id="details-symbol"
              name="symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={12}
              autoComplete="off"
              className="numeric tracking-wide"
              readOnly={frozen.has('symbol')}
              aria-invalid={!!errors.symbol}
              aria-describedby={errors.symbol ? 'details-symbol-error' : undefined}
              required
            />
            <FieldError id="details-symbol-error">{errors.symbol}</FieldError>
          </Field>
        </div>

        <AddressLine collection={collection} />

        <Field data-invalid={!!errors.description} data-disabled={readOnly}>
          <FieldLabel htmlFor="details-description">Description</FieldLabel>
          <Textarea
            id="details-description"
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            rows={5}
            readOnly={readOnly}
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? 'details-description-error' : 'details-description-help'}
          />
          {errors.description ? (
            <FieldError id="details-description-error">{errors.description}</FieldError>
          ) : readOnly ? (
            <FrozenNote id="details-description-help">Edit it in Manage drop, Mint page.</FrozenNote>
          ) : (
            <FieldDescription id="details-description-help">
              Shown on the mint page. {description.length.toLocaleString('en-US')} of 2,000 characters.
            </FieldDescription>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          {/* Read-only: set at Generate or from the uploads (`setCollectionSupply`), never typed here. */}
          <Field data-disabled>
            <FieldLabel htmlFor="details-supply">Supply</FieldLabel>
            <Input
              id="details-supply"
              value={
                collection.max_supply === null ? 'Not set yet' : collection.max_supply.toLocaleString('en-US')
              }
              className={collection.max_supply === null ? undefined : 'numeric'}
              readOnly
              aria-describedby="details-supply-help"
            />
            <FrozenNote id="details-supply-help">
              {frozen.has('maxSupply')
                ? 'Fixed when the art was locked.'
                : `${SUPPLY_SOURCE[collection.project_type]}. Up to ${supplyLimit(collection.project_type).toLocaleString('en-US')}.`}
            </FrozenNote>
          </Field>
          <Field data-disabled>
            <FieldLabel htmlFor="details-type">Type</FieldLabel>
            <Input id="details-type" value={type?.name ?? ''} readOnly aria-describedby="details-type-help" />
            <FrozenNote id="details-type-help">
              Set when the collection was created. {type?.description}
            </FrozenNote>
          </Field>
        </div>
      </FieldGroup>

      {state.formError && (
        <p
          role="alert"
          className="bg-destructive-soft text-destructive-foreground rounded-md px-3.5 py-2.5 text-sm"
        >
          {state.formError}
        </p>
      )}

      {readOnly ? (
        <StageFooter previous={BACK_TO_COLLECTIONS} next={next} />
      ) : (
        <StageFooter previous={BACK_TO_COLLECTIONS}>
          <Button type="submit" disabled={pending || (state.saved && !!next)}>
            {pending && <Spinner />}
            Save and continue
            {!pending && <ArrowRightIcon />}
          </Button>
        </StageFooter>
      )}
    </form>
  )
}
