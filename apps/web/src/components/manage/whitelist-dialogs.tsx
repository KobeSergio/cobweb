'use client'

import { useDeferredValue, useId, useMemo, useState } from 'react'
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
import type { MintGroup, SupportedChain } from '@/lib/demo'
import { count } from './format'
import { sampleRequest } from './manage-sim'
import { parseRecipients, type ParseOptions, type Recipient } from './recipients'
import { ParsePreview, RecipientsInput } from './recipients-input'
import type { SnapshotSource } from './snapshot-tab'
import { TransactionDialog } from './transaction-dialog'
import { sentQuota, type PendingChunk } from './whitelist-model'

export const WHITELIST_PARSE: ParseOptions = {
  defaultAmount: 1,
  maxAmount: 10_000,
  onDuplicate: 'last',
  amountName: 'quota',
}

export const WHITELIST_TEMPLATE = {
  fileName: 'whitelist-template.csv',
  text: 'address,quota\n0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291,2\n0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0,1\n',
}

/** Add addresses from a CSV, pasted text or one at a time, with a preview before anything changes. */
export function AddAddressesDialog({
  open,
  onOpenChange,
  group,
  existing,
  snapshot,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: MintGroup
  /** Addresses already on the list, lowercased, to say how many are updates. */
  existing: Set<string>
  snapshot: SnapshotSource
  onAdd: (rows: Recipient[]) => void
}) {
  const [text, setText] = useState('')
  const deferred = useDeferredValue(text)
  const result = useMemo(() => parseRecipients(deferred, WHITELIST_PARSE), [deferred])
  const updates = result.rows.filter((row) => existing.has(row.address.toLowerCase())).length
  const stale = deferred !== text

  function close(next: boolean) {
    if (!next) setText('')
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add to {group.name}</DialogTitle>
          <DialogDescription>
            Addresses are checked and saved here first. They can mint once their chunk is written on chain.
          </DialogDescription>
        </DialogHeader>
        <RecipientsInput
          text={text}
          onTextChange={setText}
          options={WHITELIST_PARSE}
          template={WHITELIST_TEMPLATE}
          snapshot={snapshot}
        />
        <ParsePreview result={result} amountName="quota" />
        {updates > 0 && (
          <p className="text-muted-foreground text-[0.8125rem]">
            {count(updates)} {updates === 1 ? 'address is' : 'addresses are'} already listed;{' '}
            {updates === 1 ? 'its' : 'their'} quota will be replaced. Quota already used is kept by the
            contract.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            disabled={result.rows.length === 0 || stale}
            onClick={() => {
              onAdd(result.rows)
              close(false)
            }}
          >
            {result.rows.length === 0
              ? 'Add addresses'
              : `Add ${count(result.rows.length)} ${result.rows.length === 1 ? 'address' : 'addresses'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One quota for every address on the list. Staged like any other edit. */
export function QuotaForAllDialog({
  open,
  onOpenChange,
  total,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  total: number
  onApply: (quota: number) => void
}) {
  const id = useId()
  const [value, setValue] = useState('1')
  const quota = Number(value)
  const valid = /^\d+$/.test(value) && quota >= 1 && quota <= 10_000
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!valid) return
            onApply(quota)
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>Set one quota for all</DialogTitle>
            <DialogDescription>
              Every one of the {count(total)} addresses gets the same quota. Changed addresses are written
              again in the next chunks.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={!valid}>
            <FieldLabel htmlFor={`${id}-quota`}>Quota</FieldLabel>
            <Input
              id={`${id}-quota`}
              type="number"
              min={1}
              max={10_000}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {valid ? (
              <FieldDescription>
                Wallets that minted more than this keep their tokens and have nothing left.
              </FieldDescription>
            ) : (
              <FieldError>Enter a whole number from 1 to 10,000.</FieldError>
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Set quota
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** One `setMintQuota` transaction for a chunk. */
export function WriteChunkDialog({
  open,
  onOpenChange,
  chain,
  group,
  chunk,
  totalChunks,
  onWritten,
  onFailed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: SupportedChain
  group: MintGroup
  chunk: PendingChunk
  totalChunks: number
  onWritten: (hash: `0x${string}`) => void
  onFailed: (message: string) => void
}) {
  const removals = chunk.entries.filter((entry) => entry.state === 'removing').length
  const quotaTotal = chunk.entries.reduce((sum, entry) => sum + sentQuota(entry), 0)
  return (
    <TransactionDialog
      open={open}
      onOpenChange={onOpenChange}
      chain={chain}
      title={`Write chunk ${chunk.number} of ${totalChunks}`}
      description={`Sets the quota of ${count(chunk.entries.length)} addresses in ${group.name}. Sending a chunk twice is safe: quota already used is never granted again.`}
      actionLabel={chunk.status === 'failed' ? 'Retry chunk' : 'Write chunk'}
      successMessage={`Chunk ${chunk.number} is on chain`}
      request={sampleRequest({
        contract: 'Collection',
        functionName: 'setMintQuota',
        args: [
          { name: 'addresses', value: `${count(chunk.entries.length)} addresses` },
          { name: 'mintGroup', value: String(group.id) },
          { name: 'quotas', value: `${count(chunk.entries.length)} values, ${count(quotaTotal)} in total` },
        ],
      })}
      onConfirmed={onWritten}
      onFailed={onFailed}
    >
      {removals > 0 && (
        <p className="text-muted-foreground text-sm">
          {count(removals)} {removals === 1 ? 'address is' : 'addresses are'} removed by setting the quota to
          0.
        </p>
      )}
    </TransactionDialog>
  )
}
