'use client'

import { useId } from 'react'
import { ShuffleIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Panel } from '@cobweb/ui/components/panel'
import { Textarea } from '@cobweb/ui/components/textarea'
import { ToggleGroup, ToggleGroupItem } from '@cobweb/ui/components/toggle-group'
import {
  TOKEN_DESCRIPTION_MAX,
  TOKEN_NAME_MAX,
  tokenDescriptionError,
  tokenNameError,
  type TokenDetails,
  type TokenOrder,
} from './token-list'

const n = (value: number) => value.toLocaleString('en-US')

/** A fresh shuffle seed. */
export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

/**
 * The token name and description written into every token's metadata, as legacy's "Token Name"
 * and "Token Description" (separate from the collection's own). 1/1 tokens are "<name> #<id>" and
 * may have their ids shuffled; a single asset's tokens all carry the name as is (its `tokenURI` is
 * the same for every id, MASTER_PLAN, Contracts).
 *
 * Seam: saved with the token list at lock (Phase 3); until then it lives in the screen.
 */
export function TokenDetailsPanel({
  details,
  onChange,
  tokens,
  numbered,
  readOnly,
}: {
  details: TokenDetails
  onChange: (details: TokenDetails) => void
  /** How many tokens the art makes now, for the preview line. */
  tokens: number
  /** 1/1s: "<name> #<id>" and the order choice. Single asset: the name alone. */
  numbered: boolean
  readOnly: boolean
}) {
  const id = useId()
  const nameError = tokenNameError(details.name)
  const descriptionError = tokenDescriptionError(details.description)
  const name = details.name.trim() || 'Untitled'
  const preview = numbered
    ? tokens > 1
      ? `${name} #1 to ${name} #${n(tokens)}`
      : `${name} #1`
    : `Every token is named ${name}`

  return (
    <Panel
      title="Token metadata"
      description="Written into every token. Separate from the collection's own name and description."
      bodyClassName="grid gap-5 md:grid-cols-2"
    >
      <Field data-invalid={!!nameError}>
        <FieldLabel htmlFor={`${id}-name`}>Token name</FieldLabel>
        <Input
          id={`${id}-name`}
          value={details.name}
          maxLength={TOKEN_NAME_MAX}
          disabled={readOnly}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={`${id}-name-help`}
          onChange={(event) => onChange({ ...details, name: event.target.value })}
        />
        {nameError ? (
          <FieldError id={`${id}-name-help`}>{nameError}</FieldError>
        ) : (
          <FieldDescription id={`${id}-name-help`}>{preview}</FieldDescription>
        )}
      </Field>
      <Field data-invalid={!!descriptionError}>
        <FieldLabel htmlFor={`${id}-description`}>Token description</FieldLabel>
        <Textarea
          id={`${id}-description`}
          rows={3}
          value={details.description}
          maxLength={TOKEN_DESCRIPTION_MAX}
          disabled={readOnly}
          aria-describedby={`${id}-description-count`}
          className="resize-none"
          onChange={(event) => onChange({ ...details, description: event.target.value })}
        />
        <FieldDescription id={`${id}-description-count`} className="numeric text-right">
          {n(details.description.length)}/{n(TOKEN_DESCRIPTION_MAX)}
        </FieldDescription>
      </Field>
      {numbered && (
        <Field className="md:col-span-2">
          <FieldLabel id={`${id}-order`}>Token ids</FieldLabel>
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={details.order}
              disabled={readOnly}
              aria-labelledby={`${id}-order`}
              onValueChange={(value) =>
                value && onChange({ ...details, order: value as TokenOrder, seed: details.seed || newSeed() })
              }
            >
              <ToggleGroupItem value="upload">In file order</ToggleGroupItem>
              <ToggleGroupItem value="shuffled">Shuffled</ToggleGroupItem>
            </ToggleGroup>
            {details.order === 'shuffled' && !readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...details, seed: newSeed() })}
              >
                <ShuffleIcon aria-hidden="true" />
                Shuffle again
              </Button>
            )}
          </div>
          <FieldDescription>
            {details.order === 'upload'
              ? 'Ids follow the file order, editions of a file in a row.'
              : 'Ids are shuffled across every edition, so collectors cannot tell which id is which artwork.'}
          </FieldDescription>
        </Field>
      )}
    </Panel>
  )
}
