'use client'

import { useId, useState } from 'react'
import { Input } from '@cobweb/ui/components/input'
import { cn } from '@cobweb/ui/lib/utils'

/**
 * A whole-number input that commits only valid values. While the text is invalid the last good
 * value stays in use, the reason shows under the field, and leaving the field restores it.
 */
export function QuantityInput({
  value,
  max,
  onCommit,
  label,
  disabled,
  className,
}: {
  value: number
  max: number
  onCommit: (value: number) => void
  /** Accessible name. */
  label: string
  disabled?: boolean
  className?: string
}) {
  const errorId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? String(value)
  const parsed = /^\d+$/.test(text) ? Number(text) : Number.NaN
  const error =
    !Number.isInteger(parsed) || parsed < 1
      ? 'Enter a whole number, 1 or more.'
      : parsed > max
        ? `The most is ${max.toLocaleString('en-US')}.`
        : null

  return (
    <div className={cn('space-y-1.5', className)}>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="numeric"
        disabled={disabled}
        value={text}
        onChange={(event) => {
          const next = event.target.value.trim()
          setDraft(next)
          if (/^\d+$/.test(next) && Number(next) >= 1 && Number(next) <= max) onCommit(Number(next))
        }}
        onBlur={() => setDraft(null)}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
    </div>
  )
}
