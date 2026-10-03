'use client'

import { useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cobweb/ui/components/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'

export type NameRequest = {
  title: string
  description?: string
  label: string
  initial: string
  confirmLabel: string
  /** Names already used beside this one, compared without case. */
  taken: string[]
  /** A warning shown under the field, e.g. that the generated set will be cleared. */
  warning?: string
  onSubmit: (name: string) => void
}

/** Asks for a name: add or rename a layer, rename a trait. */
export function NameDialog({ request, onClose }: { request: NameRequest | null; onClose: () => void }) {
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed so each request starts with its own value. */}
        {request && <NameForm key={request.title + request.initial} request={request} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function NameForm({ request, onClose }: { request: NameRequest; onClose: () => void }) {
  const [value, setValue] = useState(request.initial)
  const [touched, setTouched] = useState(false)
  const name = value.trim()
  const clash = request.taken.some((taken) => taken.toLowerCase() === name.toLowerCase())
  const error = !name
    ? 'Enter a name.'
    : name.length > 40
      ? 'Use 40 characters or fewer.'
      : clash
        ? 'That name is already used here.'
        : null

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)
        if (error) return
        request.onSubmit(name)
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>{request.title}</DialogTitle>
        {request.description && <DialogDescription>{request.description}</DialogDescription>}
      </DialogHeader>
      <Field data-invalid={touched && !!error}>
        <FieldLabel htmlFor="art-name-input">{request.label}</FieldLabel>
        <Input
          id="art-name-input"
          value={value}
          autoFocus
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={touched && !!error}
          aria-describedby={
            touched && error ? 'art-name-error' : request.warning ? 'art-name-warning' : undefined
          }
        />
        {touched && error ? (
          <FieldError id="art-name-error">{error}</FieldError>
        ) : (
          request.warning && (
            <FieldDescription id="art-name-warning" className="text-warning-foreground">
              {request.warning}
            </FieldDescription>
          )
        )}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">{request.confirmLabel}</Button>
      </DialogFooter>
    </form>
  )
}
