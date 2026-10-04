'use client'

import { useId, useState } from 'react'
import { toast } from 'sonner'
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
import { Spinner } from '@cobweb/ui/components/spinner'
import { Switch } from '@cobweb/ui/components/switch'
import { Textarea } from '@cobweb/ui/components/textarea'
import type { MintGroup } from '@/lib/demo'
import { PHASE_DESCRIPTION_MAX, PHASE_NAME_MAX, phaseNameError } from './phase-rules'
import { saveOffChain } from './simulate'

/** What Cobweb stores about a phase, apart from the chain: shown on the mint page only. */
export type PhaseDetails = { name: string; description: string; visible: boolean }

/** Name, description and the mint page switch, as legacy's mint group form had them. */
export function PhaseDetailsFields({
  value,
  onChange,
  nameError,
}: {
  value: PhaseDetails
  onChange: (value: PhaseDetails) => void
  nameError: string | null
}) {
  const id = useId()
  const tooLong = value.description.length > PHASE_DESCRIPTION_MAX
  return (
    <div className="grid gap-5">
      <Field data-invalid={!!nameError}>
        <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
        <Input
          id={`${id}-name`}
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          maxLength={PHASE_NAME_MAX}
          autoComplete="off"
          aria-invalid={!!nameError}
        />
        {nameError ? (
          <FieldError>{nameError}</FieldError>
        ) : (
          <FieldDescription>Shown on the mint page. Stored by Cobweb, not on chain.</FieldDescription>
        )}
      </Field>
      <Field data-invalid={tooLong}>
        <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
        <Textarea
          id={`${id}-description`}
          value={value.description}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          rows={3}
          placeholder="Who can mint in this phase, and anything they should know."
          aria-invalid={tooLong}
        />
        <FieldDescription className={tooLong ? 'text-destructive-foreground' : undefined}>
          <span className="numeric">{value.description.length.toLocaleString('en-US')}</span> of{' '}
          {PHASE_DESCRIPTION_MAX} characters. Optional.
        </FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <Switch
          id={`${id}-visible`}
          checked={value.visible}
          onCheckedChange={(visible) => onChange({ ...value, visible })}
        />
        <div className="grid gap-0.5">
          <FieldLabel htmlFor={`${id}-visible`}>Show on the mint page</FieldLabel>
          <FieldDescription>
            {value.visible
              ? 'Visitors see this phase, its price and whether they are on its list.'
              : 'Hidden from visitors. It still mints while open, for wallets that know to use it.'}
          </FieldDescription>
        </div>
      </Field>
    </div>
  )
}

/** Edit a phase's name, description and visibility. No transaction: Cobweb stores these. */
export function PhaseDetailsDialog({
  open,
  onOpenChange,
  group,
  others,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: MintGroup
  /** The other phases' names, which this one may not repeat. */
  others: string[]
  onSaved: (details: PhaseDetails) => void
}) {
  const [value, setValue] = useState<PhaseDetails>({
    name: group.name,
    description: group.description ?? '',
    visible: group.visible !== false,
  })
  const [saving, setSaving] = useState(false)
  const nameError = phaseNameError(value.name, others)
  const invalid = !!nameError || value.description.length > PHASE_DESCRIPTION_MAX
  const unchanged =
    value.name.trim() === group.name &&
    value.description.trim() === (group.description ?? '') &&
    value.visible === (group.visible !== false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (invalid || unchanged) return
    setSaving(true)
    try {
      // Seam: a server action that checks the session and ownership, then updates `mint_groups`.
      await saveOffChain()
      onSaved({ name: value.name.trim(), description: value.description.trim(), visible: value.visible })
      toast.success(`${value.name.trim()} saved`)
      onOpenChange(false)
    } catch {
      toast.error('The phase could not be saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Edit {group.name}</DialogTitle>
            <DialogDescription>
              How the phase appears on the mint page. Price, supply and start are changed on chain from the
              phase&apos;s menu.
            </DialogDescription>
          </DialogHeader>
          <PhaseDetailsFields value={value} onChange={setValue} nameError={nameError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={invalid || unchanged || saving}>
              {saving && <Spinner />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
