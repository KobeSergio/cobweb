'use client'

import { useDeferredValue, useId, useMemo, useState } from 'react'
import type { Hex } from 'viem'
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
import type { ActionResult } from '@/lib/art/result'
import type { MintGroup, SupportedChain } from '@/lib/demo'
import { phaseCalls, reviewOf } from '@/lib/manage/phase-calls'
import type { ChunkPlan, WhitelistView } from '@/lib/manage/whitelist-types'
import { QUOTA_MAX, WHITELIST_MAX } from '@/lib/manage/whitelist-view'
import { count } from './format'
import type { ManageRequest } from './manage-actions'
import { parseRecipients, type ParseOptions, type Recipient } from './recipients'
import { ParsePreview, RecipientsInput } from './recipients-input'
import type { SnapshotSource } from './snapshot-tab'
import { TransactionDialog } from './transaction-dialog'
import { capRoom } from './whitelist-model'

export const WHITELIST_PARSE: ParseOptions = {
  defaultAmount: 1,
  maxAmount: QUOTA_MAX,
  onDuplicate: 'last',
  amountName: 'quota',
}

export const WHITELIST_TEMPLATE = {
  fileName: 'whitelist-template.csv',
  text: 'address,quota\n0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291,2\n0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0,1\n',
}

const addressesWord = (value: number) => `${count(value)} ${value === 1 ? 'address' : 'addresses'}`

/**
 * Add addresses from a CSV, pasted text, one at a time or a holder snapshot, with a preview before anything
 * changes (docs/specs/2026-10-15-whitelist.md, section 7.4). It waits for the server, shows a refusal under the
 * form, and closes once the rows are saved; the cap is checked before anything is sent.
 */
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
  /** Addresses already listed, lowercased, staged removals included: to say how many are updates, and the room left. */
  existing: Set<string>
  /** Where the Snapshot tab reads; none hides the tab. */
  snapshot: SnapshotSource | undefined
  /** Saves the rows; answers the refusal's sentence, or null once they are saved. */
  onAdd: (rows: Recipient[]) => Promise<string | null>
}) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const deferred = useDeferredValue(text)
  const result = useMemo(() => parseRecipients(deferred, WHITELIST_PARSE), [deferred])
  const updates = result.rows.filter((row) => existing.has(row.address.toLowerCase())).length
  const { fresh, room } = capRoom(existing, result.rows)
  const full = fresh > room
  const stale = deferred !== text

  function close(next: boolean) {
    if (saving) return
    if (!next) {
      setText('')
      setFailure(null)
    }
    onOpenChange(next)
  }

  async function add() {
    setSaving(true)
    setFailure(null)
    const refused = await onAdd(result.rows)
    setSaving(false)
    if (refused) return setFailure(refused)
    setText('')
    onOpenChange(false)
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
        {full && (
          <FieldError>
            A whitelist holds up to {count(WHITELIST_MAX)} addresses. This one has room for {count(room)}{' '}
            more.
          </FieldError>
        )}
        {failure && <FieldError>{failure}</FieldError>}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={result.rows.length === 0 || stale || full || saving} onClick={() => void add()}>
            {saving && <Spinner />}
            {saving
              ? `Adding ${addressesWord(result.rows.length)}`
              : result.rows.length === 0
                ? 'Add addresses'
                : `Add ${addressesWord(result.rows.length)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One quota for every address on the list, saved by Cobweb and written by the next chunks. */
export function QuotaForAllDialog({
  open,
  onOpenChange,
  total,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The addresses listed, staged removals left out. */
  total: number
  /** Saves the quota; answers the refusal's sentence, or null once it is saved. */
  onApply: (quota: number) => Promise<string | null>
}) {
  const id = useId()
  const [value, setValue] = useState('1')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const quota = Number(value)
  const valid = /^\d+$/.test(value) && quota >= 1 && quota <= QUOTA_MAX

  function close(next: boolean) {
    if (saving) return
    if (!next) setFailure(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!valid || saving) return
            setSaving(true)
            setFailure(null)
            const refused = await onApply(quota)
            setSaving(false)
            if (refused) return setFailure(refused)
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
              max={QUOTA_MAX}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {valid ? (
              <FieldDescription>
                Wallets that minted more than this keep their tokens and have nothing left.
              </FieldDescription>
            ) : (
              <FieldError>Enter a whole number from 1 to {count(QUOTA_MAX)}.</FieldError>
            )}
          </Field>
          {failure && <FieldError>{failure}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Spinner />}
              {saving ? 'Setting quota' : 'Set quota'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A chunk as the dialog sends it (docs/specs/2026-10-15-whitelist.md, section 7.4): the server's plan as one
 * `setMintQuota` call, its review in counts, the server's confirm from the receipt and calldata, and the sent hash
 * kept until that confirm answers.
 */
export function chunkRequest(
  plan: ChunkPlan,
  chain: SupportedChain,
  confirm: (hash: Hex) => Promise<ActionResult<WhitelistView>>,
  pending: { remember(hash: Hex): void; forget(): void },
): ManageRequest<WhitelistView> {
  const call = phaseCalls.quotas(
    plan.onchainId,
    plan.entries.map((entry) => entry.address),
    plan.entries.map((entry) => entry.quota),
  )
  return {
    call,
    review: { contract: 'Collection', functionName: 'setMintQuota', args: reviewOf(call, chain) },
    confirm,
    pending,
  }
}

/** One `setMintQuota` transaction for the chunk the server built, on the manage machine. */
export function WriteChunkDialog({
  open,
  onOpenChange,
  chain,
  group,
  plan,
  retry,
  request,
  onConfirmed,
  onFailed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: SupportedChain
  group: MintGroup
  plan: ChunkPlan
  /** The last write of this group failed in this visit. */
  retry: boolean
  request: ManageRequest<WhitelistView>
  onConfirmed: (view: WhitelistView) => void
  onFailed: (message: string) => void
}) {
  const removals = plan.entries.filter((entry) => entry.quota === 0).length
  return (
    <TransactionDialog
      open={open}
      onOpenChange={onOpenChange}
      chain={chain}
      title={`Write chunk ${plan.number} of ${plan.of}`}
      description={`Sets the quota of ${addressesWord(plan.entries.length)} in ${group.name}. Sending a chunk twice is safe: quota already used is never granted again.`}
      actionLabel={retry ? 'Retry chunk' : 'Write chunk'}
      successMessage={`Chunk ${plan.number} is on chain`}
      request={request}
      onConfirmed={onConfirmed}
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
