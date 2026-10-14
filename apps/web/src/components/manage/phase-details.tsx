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
import { THROWN, type ActionResult } from '@/lib/art/result'
import type { MintGroup } from '@/lib/demo'
import { PHASE_DESCRIPTION_MAX, PHASE_NAME_MAX, phaseNameError } from './phase-rules'
import type { PhasesServer } from './phases-server'

/** What Cobweb stores about a phase, apart from the chain: shown on the mint page only. */
export type PhaseDetails = { name: string; description: string; visible: boolean }

/**
 * Name, description and, for Add phase, the mint page switch, as legacy's mint group form had them. Edit
 * details leaves the switch out: a phase is hidden or shown from its menu (docs/specs/2026-10-15-phases.md,
 * section 7.4).
 */
export function PhaseDetailsFields({
  value,
  onChange,
  nameError,
  showVisibility = true,
}: {
  value: PhaseDetails
  onChange: (value: PhaseDetails) => void
  nameError: string | null
  showVisibility?: boolean
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
      {showVisibility && (
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
      )}
    </div>
  )
}

/**
 * Edit a phase's name and description, or name a group registered outside Cobweb. No transaction: Cobweb
 * stores these, through `renamePhase`, which checks the session and ownership.
 */
export function PhaseDetailsDialog({
  open,
  onOpenChange,
  group,
  others,
  server,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: MintGroup
  /** The other phases' names, which this one may not repeat. */
  others: string[]
  server: PhasesServer
  onSaved: (details: { name: string; description: string }) => void
}) {
  const named = group.named !== false
  // A group without a row reads "Group N" until named: the field starts empty.
  const [value, setValue] = useState<PhaseDetails>({
    name: named ? group.name : '',
    description: group.description ?? '',
    visible: group.visible !== false,
  })
  const [saving, setSaving] = useState(false)
  const nameError = phaseNameError(value.name, others)
  const invalid = !!nameError || value.description.length > PHASE_DESCRIPTION_MAX
  const unchanged =
    named && value.name.trim() === group.name && value.description.trim() === (group.description ?? '')

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (invalid || unchanged) return
    setSaving(true)
    const details = { name: value.name.trim(), description: value.description.trim() }
    let result: ActionResult
    try {
      result = await server.rename(group.id, details)
    } catch {
      result = { ok: false, error: THROWN }
    }
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    onSaved(details)
    toast.success(`${details.name} saved`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{named ? `Edit ${group.name}` : `Name group ${group.id}`}</DialogTitle>
            <DialogDescription>
              {named
                ? "How the phase appears on the mint page. Price, supply and start are changed on chain from the phase's menu."
                : 'This group was registered on the contract outside Cobweb. Name it to show it on the mint page and to add its whitelist.'}
            </DialogDescription>
          </DialogHeader>
          <PhaseDetailsFields
            value={value}
            onChange={setValue}
            nameError={nameError}
            showVisibility={false}
          />
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
