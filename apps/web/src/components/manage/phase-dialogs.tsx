'use client'

import { useId, useState } from 'react'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { formatNative, toWei, type MintGroup, type SupportedChain } from '@/lib/demo'
import { count, shortUtc } from './format'
import { allocationCheck, priceError, publicCapError } from './phase-rules'
import { PriceInput } from './price-input'
import { TransactionDialog } from './transaction-dialog'

/** What every phase dialog needs from the screen. */
export type PhaseContext = {
  chain: SupportedChain
  groups: MintGroup[]
  /** The collection's max supply: allocations together may not exceed it. */
  maxSupply: number
  /** Tokens airdropped (and burned): collection supply no phase can sell. */
  airdropped: number
  blockTimestamp: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Open now or Close. Closing also clears the schedule, as the contract does. */
export function StatusDialog({
  group,
  nextStatus,
  onApply,
  ...ctx
}: PhaseContext & { group: MintGroup; nextStatus: boolean; onApply: (patch: Partial<MintGroup>) => void }) {
  const others = ctx.groups.filter((other) => other.id !== group.id && other.active)
  return (
    <TransactionDialog
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      chain={ctx.chain}
      title={nextStatus ? `Open ${group.name}` : `Close ${group.name}`}
      description={
        nextStatus
          ? 'Minting starts as soon as the transaction confirms, and the phase stays open until you close it.'
          : 'Minting in this phase stops as soon as the transaction confirms.'
      }
      actionLabel={nextStatus ? 'Open phase' : 'Close phase'}
      destructive={!nextStatus}
      successMessage={nextStatus ? `${group.name} is open` : `${group.name} is closed`}
      request={{
        contract: 'Collection',
        functionName: 'setMintGroupStatus',
        args: [
          { name: 'mintGroup', value: String(group.id) },
          { name: 'status', value: String(nextStatus) },
        ],
      }}
      onConfirmed={() => onApply(nextStatus ? { flag: true } : { flag: false, scheduledStart: 0 })}
    >
      <ul className="text-muted-foreground grid list-disc gap-1.5 pl-5 text-sm">
        {!nextStatus && group.scheduledStart > 0 && (
          <li>
            Closing also clears the scheduled start (
            <span className="numeric">{shortUtc(group.scheduledStart)}</span>). To run it again, open it by
            hand or schedule a new start.
          </li>
        )}
        {!nextStatus && group.scheduledStart === 0 && <li>You can open it again at any time.</li>}
        {nextStatus && others.length > 0 && (
          <li>
            {others.map((other) => other.name).join(' and ')} {others.length === 1 ? 'is' : 'are'} also open.{' '}
            {others.length === 1 ? 'Both phases' : 'All of them'} will be live at once; close one if that is
            not what you want.
          </li>
        )}
        {nextStatus && group.scheduledStart > 0 && (
          <li>
            It is scheduled for <span className="numeric">{shortUtc(group.scheduledStart)}</span>. Opening now
            starts it early.
          </li>
        )}
        {nextStatus && group.minted >= group.maxSupply && (
          <li>
            Its allocation is full, so it will be open but nobody can mint until you raise the max supply.
          </li>
        )}
      </ul>
    </TransactionDialog>
  )
}

/** The emergency stop: closes every phase in one transaction, clearing every schedule. */
export function CloseAllDialog({ onApply, ...ctx }: PhaseContext & { onApply: () => void }) {
  const scheduled = ctx.groups.filter((group) => group.scheduledStart > 0)
  return (
    <TransactionDialog
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      chain={ctx.chain}
      destructive
      title="Close every phase"
      description="Minting stops in every phase as soon as the transaction confirms. Use it to pause the whole drop."
      actionLabel="Close all phases"
      successMessage="Every phase is closed"
      request={{
        contract: 'Collection',
        functionName: 'stopOrStartAllMintGroups',
        args: [{ name: 'status', value: 'false' }],
      }}
      onConfirmed={onApply}
    >
      {scheduled.length > 0 && (
        <p className="text-muted-foreground text-sm">
          This also clears the scheduled start of {scheduled.map((group) => group.name).join(' and ')}.
          Schedule
          {scheduled.length === 1 ? ' it' : ' them'} again when you are ready.
        </p>
      )}
    </TransactionDialog>
  )
}

/** Removes a scheduled start without opening or closing the phase. */
export function ClearScheduleDialog({
  group,
  onApply,
  ...ctx
}: PhaseContext & { group: MintGroup; onApply: (patch: Partial<MintGroup>) => void }) {
  return (
    <TransactionDialog
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      chain={ctx.chain}
      title="Clear the scheduled start"
      description={`${group.name} will no longer open by itself at ${shortUtc(group.scheduledStart)}. It stays closed until you open it or schedule it again.`}
      actionLabel="Clear schedule"
      successMessage={`${group.name} is no longer scheduled`}
      request={{
        contract: 'Collection',
        functionName: 'scheduleMintGroupStart',
        args: [
          { name: 'mintGroup', value: String(group.id) },
          { name: 'startTimestamp', value: '0' },
        ],
      }}
      onConfirmed={() => onApply({ scheduledStart: 0 })}
    />
  )
}

/** Change the price per token, entered in the native token. */
export function PriceDialog({
  group,
  onApply,
  ...ctx
}: PhaseContext & { group: MintGroup; onApply: (patch: Partial<MintGroup>) => void }) {
  const id = useId()
  const [value, setValue] = useState(formatNative(group.priceWei, '', 18).trim().replace(/,/g, ''))
  const error = priceError(value, ctx.chain.nativeSymbol)
  const wei = error ? null : toWei(value.trim())
  const unchanged = wei === group.priceWei
  return (
    <TransactionDialog
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      chain={ctx.chain}
      title={`Price for ${group.name}`}
      description="Applies to every mint after the transaction confirms. Platform fees are added on top for the minter."
      actionLabel="Change price"
      successMessage={`${group.name} price changed`}
      request={
        wei && !unchanged
          ? {
              contract: 'Collection',
              functionName: 'changeSalePrice',
              args: [
                { name: 'price', value: `${wei} wei` },
                { name: 'mintGroup', value: String(group.id) },
              ],
            }
          : null
      }
      onConfirmed={() => wei && onApply({ priceWei: wei })}
    >
      <PriceInput
        id={`${id}-price`}
        value={value}
        onChange={setValue}
        chain={ctx.chain}
        error={error}
        hint={<>Now {formatNative(group.priceWei, ctx.chain.nativeSymbol, 18)}. Enter 0 for a free mint.</>}
      />
    </TransactionDialog>
  )
}

/** Change the allocation: never below what the phase has minted, never past the collection's supply. */
export function SupplyDialog({
  group,
  onApply,
  ...ctx
}: PhaseContext & { group: MintGroup; onApply: (patch: Partial<MintGroup>) => void }) {
  const id = useId()
  const [value, setValue] = useState(String(group.maxSupply))
  const { error, warning, room, next } = allocationCheck({
    groups: ctx.groups,
    maxSupply: ctx.maxSupply,
    groupId: group.id,
    value,
    airdropped: ctx.airdropped,
  })
  return (
    <TransactionDialog
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      chain={ctx.chain}
      title={`Max supply for ${group.name}`}
      description="How many tokens this phase may mint in total. Unsold tokens do not move to another phase by themselves; lower one phase and raise another."
      actionLabel="Change max supply"
      successMessage={`${group.name} max supply changed`}
      request={
        error || next === group.maxSupply
          ? null
          : {
              contract: 'Collection',
              functionName: 'setMintGroupMaxSupply',
              args: [
                { name: 'mintGroup', value: String(group.id) },
                { name: 'maxSupply', value: String(next) },
              ],
              check: () =>
                next < group.minted ? 'BelowMinted' : next > room ? 'AllocationsExceedMaxSupply' : null,
            }
      }
      onConfirmed={() => onApply({ maxSupply: next })}
    >
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor={`${id}-supply`}>Max supply</FieldLabel>
        <Input
          id={`${id}-supply`}
          type="number"
          inputMode="numeric"
          min={group.minted}
          max={room}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={!!error}
          aria-describedby={`${id}-supply-help`}
        />
        {error ? (
          <FieldError id={`${id}-supply-help`}>{error}</FieldError>
        ) : (
          <FieldDescription id={`${id}-supply-help`}>
            Between <span className="numeric">{count(group.minted)}</span> (already minted) and{' '}
            <span className="numeric">{count(room)}</span> (room left in the collection).
          </FieldDescription>
        )}
        {warning && <p className="text-warning-foreground text-[0.8125rem]">{warning}</p>}
      </Field>
    </TransactionDialog>
  )
}

/** The public phase's lifetime cap per wallet. */
export function PublicCapDialog({
  cap,
  onApply,
  ...ctx
}: PhaseContext & { cap: number; onApply: (cap: number) => void }) {
  const id = useId()
  const [value, setValue] = useState(String(cap))
  const next = Number(value)
  const error = publicCapError(value, ctx.maxSupply)
  const publicAllocation = ctx.groups.find((group) => group.kind === 'public')?.maxSupply
  // Legacy refused a limit above the public allocation; the contract allows it, so it is a note.
  const above = !error && publicAllocation !== undefined && next > publicAllocation
  return (
    <TransactionDialog
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      chain={ctx.chain}
      title="Public mints per wallet"
      description="The most one wallet can mint in the public phase, over the whole sale. Whitelist phases use each address's quota instead."
      actionLabel="Change limit"
      successMessage="Public limit changed"
      request={
        error || next === cap
          ? null
          : {
              contract: 'Collection',
              functionName: 'setPublicMaxMintPerWallet',
              args: [{ name: 'cap', value: String(next) }],
            }
      }
      onConfirmed={() => onApply(next)}
    >
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor={`${id}-cap`}>Per wallet</FieldLabel>
        <Input
          id={`${id}-cap`}
          type="number"
          inputMode="numeric"
          min={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={!!error}
          aria-describedby={`${id}-cap-help`}
        />
        {error ? (
          <FieldError id={`${id}-cap-help`}>{error}</FieldError>
        ) : (
          <FieldDescription id={`${id}-cap-help`}>
            Wallets that already minted more keep their tokens; they just cannot mint again.
          </FieldDescription>
        )}
        {above && (
          <p className="text-warning-foreground text-[0.8125rem]">
            More than the public phase&apos;s {count(publicAllocation ?? 0)} tokens, so one wallet could take
            the whole phase.
          </p>
        )}
      </Field>
    </TransactionDialog>
  )
}
