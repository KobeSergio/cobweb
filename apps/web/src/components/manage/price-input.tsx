'use client'

import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@cobweb/ui/components/input-group'
import type { SupportedChain } from '@/lib/demo'

/**
 * A price per token in the chain's native token, with the symbol beside it (as legacy did) and
 * the checks of `priceError`: 0 to 1,000,000, at most 18 decimal places. Typing keeps only digits
 * and one decimal point; a comma is read as the decimal point.
 */
export function PriceInput({
  id,
  value,
  onChange,
  chain,
  error,
  label = 'Price per token',
  hint,
  readOnly,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  chain: SupportedChain
  error: string | null
  label?: string
  hint?: React.ReactNode
  readOnly?: boolean
}) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          value={value}
          onChange={(event) =>
            onChange(
              event.target.value
                .replace(',', '.')
                .replace(/[^0-9.]/g, '')
                .replace(/(\..*)\./g, '$1'),
            )
          }
          inputMode="decimal"
          autoComplete="off"
          className="numeric"
          readOnly={readOnly}
          aria-invalid={!!error}
          aria-describedby={`${id}-help`}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="numeric">{chain.nativeSymbol}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      {error ? (
        <FieldError id={`${id}-help`}>{error}</FieldError>
      ) : (
        <FieldDescription id={`${id}-help`}>{hint ?? 'Enter 0 for a free mint.'}</FieldDescription>
      )}
    </Field>
  )
}
