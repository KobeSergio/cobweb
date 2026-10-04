'use client'

import { useState } from 'react'
import { PlusIcon, TagsIcon, XIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@cobweb/ui/components/dialog'
import { Input } from '@cobweb/ui/components/input'
import { ATTRIBUTE_TEXT_MAX, attributeRowsError, MAX_ATTRIBUTES } from './token-list'
import type { Attribute } from './types'

function Editor({
  fileName,
  attributes,
  onSave,
  onDone,
}: {
  fileName: string
  attributes: Attribute[]
  onSave: (attributes: Attribute[]) => void
  onDone: () => void
}) {
  const [rows, setRows] = useState<Attribute[]>(
    attributes.length > 0 ? attributes : [{ traitType: '', value: '' }],
  )
  const update = (index: number, patch: Partial<Attribute>) =>
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)))

  const filled = rows.filter((row) => row.traitType.trim() || row.value.trim())
  const error = attributeRowsError(rows)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Attributes</DialogTitle>
        <DialogDescription>
          Trait type and value pairs for <span className="text-foreground">{fileName}</span>. They appear on
          marketplaces.
        </DialogDescription>
      </DialogHeader>
      <ul className="space-y-3">
        {rows.map((row, index) => (
          <li key={index} className="flex items-start gap-2">
            <Input
              aria-label={`Trait type ${index + 1}`}
              placeholder="Trait type"
              value={row.traitType}
              maxLength={ATTRIBUTE_TEXT_MAX}
              aria-invalid={!!row.value.trim() && !row.traitType.trim() ? true : undefined}
              onChange={(event) => update(index, { traitType: event.target.value })}
            />
            <Input
              aria-label={`Value ${index + 1}`}
              placeholder="Value"
              value={row.value}
              maxLength={ATTRIBUTE_TEXT_MAX}
              aria-invalid={!!row.traitType.trim() && !row.value.trim() ? true : undefined}
              onChange={(event) => update(index, { value: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove attribute ${index + 1}`}
              onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={rows.length >= MAX_ATTRIBUTES}
          onClick={() => setRows((current) => [...current, { traitType: '', value: '' }])}
        >
          <PlusIcon aria-hidden="true" />
          Add attribute
        </Button>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button
          type="button"
          disabled={error !== null}
          onClick={() => {
            onSave(filled.map((row) => ({ traitType: row.traitType.trim(), value: row.value.trim() })))
            onDone()
          }}
        >
          Save attributes
        </Button>
      </DialogFooter>
    </>
  )
}

/** Edit button and dialog for one artwork's attributes. The editor mounts fresh on each open. */
export function AttributesDialog({
  fileName,
  attributes,
  onSave,
}: {
  fileName: string
  attributes: Attribute[]
  onSave: (attributes: Attribute[]) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <TagsIcon aria-hidden="true" />
          Attributes
          <span className="sr-only"> for {fileName}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <Editor fileName={fileName} attributes={attributes} onSave={onSave} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
