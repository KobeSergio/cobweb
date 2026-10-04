'use client'

import { useState } from 'react'
import { CopyIcon, TagsIcon, Trash2Icon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@cobweb/ui/components/alert-dialog'
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
import { Label } from '@cobweb/ui/components/label'
import { ToggleGroup, ToggleGroupItem } from '@cobweb/ui/components/toggle-group'
import { QuantityInput } from './quantity-input'
import { ATTRIBUTE_TEXT_MAX } from './token-list'
import { MAX_EDITIONS_PER_FILE, type Attribute } from './types'

const files = (count: number) => `${count.toLocaleString('en-US')} ${count === 1 ? 'file' : 'files'}`

/** Sets the same edition count on every selected file. */
export function BulkEditionsDialog({
  count,
  onApply,
}: {
  count: number
  onApply: (quantity: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState(1)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <CopyIcon aria-hidden="true" />
          Editions
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set editions</DialogTitle>
          <DialogDescription>
            Every one of the {files(count)} selected gets this many editions, from 1 to{' '}
            {MAX_EDITIONS_PER_FILE.toLocaleString('en-US')}.
          </DialogDescription>
        </DialogHeader>
        <QuantityInput value={quantity} max={MAX_EDITIONS_PER_FILE} label="Editions" onCommit={setQuantity} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => {
              onApply(quantity)
              setOpen(false)
            }}
          >
            Set editions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Mode = 'set' | 'clear'

function AttributeForm({
  count,
  onSet,
  onClear,
  onDone,
}: {
  count: number
  onSet: (attribute: Attribute) => void
  onClear: (traitType: string) => void
  onDone: () => void
}) {
  const [mode, setMode] = useState<Mode>('set')
  const [traitType, setTraitType] = useState('')
  const [value, setValue] = useState('')
  const ready = traitType.trim() !== '' && (mode === 'clear' || value.trim() !== '')
  return (
    <>
      <DialogHeader>
        <DialogTitle>Attribute for {files(count)}</DialogTitle>
        <DialogDescription>
          Set a trait on every selected file, replacing any value it has for that trait type, or remove the
          trait type from all of them.
        </DialogDescription>
      </DialogHeader>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={mode}
        aria-label="What to do"
        onValueChange={(next) => next && setMode(next as Mode)}
      >
        <ToggleGroupItem value="set">Set a trait</ToggleGroupItem>
        <ToggleGroupItem value="clear">Remove a trait type</ToggleGroupItem>
      </ToggleGroup>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bulk-trait-type">Trait type</Label>
          <Input
            id="bulk-trait-type"
            placeholder="For example Background"
            maxLength={ATTRIBUTE_TEXT_MAX}
            value={traitType}
            onChange={(event) => setTraitType(event.target.value)}
          />
        </div>
        {mode === 'set' && (
          <div className="space-y-1.5">
            <Label htmlFor="bulk-trait-value">Value</Label>
            <Input
              id="bulk-trait-value"
              placeholder="For example Gold"
              maxLength={ATTRIBUTE_TEXT_MAX}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button
          type="button"
          variant={mode === 'clear' ? 'destructive' : 'default'}
          disabled={!ready}
          onClick={() => {
            if (mode === 'set') onSet({ traitType: traitType.trim(), value: value.trim() })
            else onClear(traitType.trim())
            onDone()
          }}
        >
          {mode === 'set' ? 'Set trait' : 'Remove trait type'}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Sets or removes one attribute on every selected file (legacy custom layers, applied to a batch). */
export function BulkAttributeDialog({
  count,
  onSet,
  onClear,
}: {
  count: number
  onSet: (attribute: Attribute) => void
  onClear: (traitType: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <TagsIcon aria-hidden="true" />
          Attribute
        </Button>
      </DialogTrigger>
      <DialogContent>
        <AttributeForm count={count} onSet={onSet} onClear={onClear} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** Removes every selected file with its editions. */
export function BulkRemoveButton({ count, onConfirm }: { count: number; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Trash2Icon aria-hidden="true" />
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {files(count)}?</AlertDialogTitle>
          <AlertDialogDescription>
            They are taken out of the collection with all their editions, and the token ids after them close
            up. You can add the files again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep them</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Remove {files(count)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
