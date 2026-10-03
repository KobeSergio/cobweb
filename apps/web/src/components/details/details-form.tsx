'use client'

import { CheckIcon, ClockIcon, LockIcon } from 'lucide-react'
import { useActionState, useState } from 'react'
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
import {
  formatReservedUntil,
  MAX_SUPPLY,
  PROJECT_TYPES,
  SINGLE_ASSET_MAX_SUPPLY,
  slugState,
} from '@/lib/collections'
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
  next?: FlowLink
}

/** Why a field is read-only, shown under it. */
function FrozenNote({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <FieldDescription id={id} className="flex items-center gap-1.5">
      <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </FieldDescription>
  )
}

/** Where the mint page address stands. It is reserved in Deploy, not edited here. */
function AddressLine({ collection }: { collection: Props['collection'] }) {
  const state = slugState(collection)
  return (
    <Field>
      <FieldTitle>Mint page address</FieldTitle>
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

/** The Details screen: edit the collection's name, symbol, description and supply. */
export function DetailsForm({ collection, next }: Props) {
  const action = updateCollectionDetails.bind(null, collection.id)
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)
  const [symbol, setSymbol] = useState(collection.symbol)
  const [description, setDescription] = useState(collection.description)

  const frozen = frozenDetailFields(collection.status)
  const errors = state.fieldErrors ?? {}
  const type = PROJECT_TYPES.find((entry) => entry.value === collection.project_type)
  const supplyLimit = collection.project_type === 'single_asset' ? SINGLE_ASSET_MAX_SUPPLY : MAX_SUPPLY
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

        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="details-description">Description</FieldLabel>
          <Textarea
            id="details-description"
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            rows={5}
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? 'details-description-error' : 'details-description-help'}
          />
          {errors.description ? (
            <FieldError id="details-description-error">{errors.description}</FieldError>
          ) : (
            <FieldDescription id="details-description-help">
              Shown on the mint page. {description.length.toLocaleString('en-US')} of 2,000 characters.
            </FieldDescription>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <Field data-invalid={!!errors.maxSupply} data-disabled={frozen.has('maxSupply')}>
            <FieldLabel htmlFor="details-supply">Supply</FieldLabel>
            <Input
              id="details-supply"
              name="maxSupply"
              type="number"
              inputMode="numeric"
              min={1}
              max={supplyLimit}
              defaultValue={collection.max_supply}
              readOnly={frozen.has('maxSupply')}
              aria-invalid={!!errors.maxSupply}
              aria-describedby={errors.maxSupply ? 'details-supply-error' : 'details-supply-help'}
              required
            />
            {errors.maxSupply ? (
              <FieldError id="details-supply-error">{errors.maxSupply}</FieldError>
            ) : frozen.has('maxSupply') ? (
              <FrozenNote id="details-supply-help">Fixed when the art was locked.</FrozenNote>
            ) : (
              <FieldDescription id="details-supply-help">
                Total tokens. Up to {supplyLimit.toLocaleString('en-US')}.
              </FieldDescription>
            )}
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

      <StageFooter next={next}>
        <p aria-live="polite" className="text-muted-foreground flex items-center gap-1.5 text-sm">
          {state.saved && !pending && (
            <>
              <CheckIcon aria-hidden="true" className="text-success size-4" />
              Saved
            </>
          )}
        </p>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          Save details
        </Button>
      </StageFooter>
    </form>
  )
}
