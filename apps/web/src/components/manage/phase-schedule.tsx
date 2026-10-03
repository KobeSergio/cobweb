'use client'

import { AlertTriangleIcon, CalendarIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Calendar } from '@cobweb/ui/components/calendar'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@cobweb/ui/components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@cobweb/ui/components/popover'
import { Switch } from '@cobweb/ui/components/switch'
import { formatUtc, toWei, type MintGroup } from '@/lib/demo'
import { count, NATIVE_AMOUNT, relativeTo, useTimeZone } from './format'
import { allocationRoom, type PhaseContext } from './phase-dialogs'
import { TransactionDialog } from './transaction-dialog'

type Start = { date: Date | undefined; time: string }

/** A start as the creator's local date and time, from a unix time. */
function startFrom(seconds: number): Start {
  const date = new Date(seconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

/** The default: a day after the chain's time, on the hour. */
function defaultStart(blockTimestamp: number): Start {
  return startFrom(Math.ceil((blockTimestamp + 86_400) / 3600) * 3600)
}

/** Local date and time to the unix seconds the contract receives, or null if incomplete. */
function toUnix(start: Start): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(start.time)
  if (!start.date || !match) return null
  const { date } = start
  const local = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Number(match[1]),
    Number(match[2]),
  )
  return Math.floor(local.getTime() / 1000)
}

/**
 * Date and time in the creator's time zone, with what that means in UTC and the exact value
 * the transaction sends. Warns when the time has already passed on chain.
 */
function StartPicker({
  value,
  onChange,
  blockTimestamp,
}: {
  value: Start
  onChange: (start: Start) => void
  blockTimestamp: number
}) {
  const id = useId()
  const timeZone = useTimeZone()
  const [calendarOpen, setCalendarOpen] = useState(false)
  const unix = toUnix(value)
  const chainDay = startFrom(blockTimestamp).date
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Field>
          <FieldLabel htmlFor={`${id}-date`}>Date</FieldLabel>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button id={`${id}-date`} type="button" variant="outline" className="justify-start font-normal">
                <CalendarIcon aria-hidden="true" />
                {value.date
                  ? value.date.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Pick a date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={value.date}
                defaultMonth={value.date}
                disabled={chainDay ? { before: chainDay } : undefined}
                onSelect={(date) => {
                  onChange({ ...value, date })
                  setCalendarOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-time`}>Time</FieldLabel>
          <Input
            id={`${id}-time`}
            type="time"
            value={value.time}
            onChange={(event) => onChange({ ...value, time: event.target.value })}
            className="numeric"
          />
        </Field>
      </div>
      <p className="text-muted-foreground -mt-2 text-[0.8125rem]">
        In your time zone, <span className="text-foreground">{timeZone}</span>.
      </p>

      {unix !== null && (
        <dl className="bg-well shadow-inset grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border px-4 py-3 text-[0.8125rem]">
          <dt className="text-muted-foreground">UTC</dt>
          <dd className="numeric text-right">{formatUtc(unix)}</dd>
          <dt className="text-muted-foreground">Unix time sent</dt>
          <dd className="numeric text-right">{unix}</dd>
          <dt className="text-muted-foreground">From the chain&apos;s time</dt>
          <dd className="numeric text-right">{relativeTo(unix, blockTimestamp)}</dd>
        </dl>
      )}
      {unix !== null && unix <= blockTimestamp && (
        <p role="alert" className="bg-warning-soft flex gap-2 rounded-lg px-4 py-3 text-sm">
          <AlertTriangleIcon aria-hidden="true" className="text-warning-foreground mt-0.5 size-4 shrink-0" />
          This time has already passed on chain, so the phase opens as soon as the transaction confirms.
        </p>
      )}
    </div>
  )
}

/** Schedule a start: the phase opens by itself at that second and stays open until closed. */
export function ScheduleDialog({
  group,
  onApply,
  ...ctx
}: PhaseContext & { group: MintGroup; onApply: (patch: Partial<MintGroup>) => void }) {
  const [start, setStart] = useState<Start>(() =>
    group.scheduledStart > 0 ? startFrom(group.scheduledStart) : defaultStart(ctx.blockTimestamp),
  )
  const unix = toUnix(start)
  return (
    <TransactionDialog
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      chain={ctx.chain}
      title={`Schedule ${group.name}`}
      description="The phase opens by itself at this time and stays open until you close it. There is no end time."
      actionLabel="Schedule start"
      successMessage={`${group.name} is scheduled`}
      request={
        unix === null
          ? null
          : {
              contract: 'Collection',
              functionName: 'scheduleMintGroupStart',
              args: [
                { name: 'mintGroup', value: String(group.id) },
                { name: 'startTimestamp', value: String(unix) },
              ],
            }
      }
      onConfirmed={() => unix !== null && onApply({ scheduledStart: unix })}
    >
      <StartPicker value={start} onChange={setStart} blockTimestamp={ctx.blockTimestamp} />
    </TransactionDialog>
  )
}

/** Register a new whitelist phase with its price, allocation and an optional start. */
export function AddPhaseDialog({
  onAdd,
  ...ctx
}: PhaseContext & { onAdd: (group: Omit<MintGroup, 'active'>) => void }) {
  const id = useId()
  const nextId = Math.max(0, ...ctx.groups.map((group) => group.id)) + 1
  const room = allocationRoom(ctx.groups, ctx.maxSupply, null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('0')
  const [supply, setSupply] = useState(String(Math.min(100, Math.max(0, room))))
  const [scheduled, setScheduled] = useState(false)
  const [start, setStart] = useState<Start>(() => defaultStart(ctx.blockTimestamp))

  const nameError = name.trim() ? null : 'Name the phase, for example "Holders".'
  const priceError = NATIVE_AMOUNT.test(price.trim()) ? null : 'Enter an amount such as 0.002.'
  const supplyNumber = Number(supply)
  const supplyError =
    !/^\d+$/.test(supply) || supplyNumber < 1
      ? 'Enter a whole number of 1 or more.'
      : supplyNumber > room
        ? `Only ${count(room)} tokens are not allocated to a phase.`
        : null
  const unix = scheduled ? toUnix(start) : 0
  const ready = !nameError && !priceError && !supplyError && unix !== null

  return (
    <TransactionDialog
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      chain={ctx.chain}
      title="Add a phase"
      description="A new whitelist phase. It starts closed unless you schedule it; add its addresses on the Whitelist tab."
      actionLabel="Add phase"
      successMessage={`${name.trim() || 'Phase'} added`}
      className="sm:max-w-xl"
      request={
        ready
          ? {
              contract: 'Collection',
              functionName: 'registerMintGroup',
              args: [
                { name: 'mintGroup', value: String(nextId) },
                { name: 'price', value: `${toWei(price.trim())} wei` },
                { name: 'maxSupply', value: String(supplyNumber) },
                { name: 'startTimestamp', value: String(unix) },
              ],
              check: () => (supplyNumber > room ? 'AllocationsExceedMaxSupply' : null),
            }
          : null
      }
      onConfirmed={() =>
        onAdd({
          id: nextId,
          name: name.trim(),
          kind: 'whitelist',
          priceWei: toWei(price.trim()),
          maxSupply: supplyNumber,
          minted: 0,
          flag: false,
          scheduledStart: unix ?? 0,
        })
      }
    >
      <div className="grid gap-5">
        <Field data-invalid={!!name && !!nameError}>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            autoComplete="off"
          />
          <FieldDescription>Shown on the mint page. Stored by Cobweb, not on chain.</FieldDescription>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!priceError}>
            <FieldLabel htmlFor={`${id}-price`}>Price per token</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={`${id}-price`}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
                className="numeric"
                aria-invalid={!!priceError}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText className="numeric">{ctx.chain.nativeSymbol}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            {priceError && <FieldError>{priceError}</FieldError>}
          </Field>
          <Field data-invalid={!!supplyError}>
            <FieldLabel htmlFor={`${id}-supply`}>Max supply</FieldLabel>
            <Input
              id={`${id}-supply`}
              type="number"
              min={1}
              max={room}
              value={supply}
              onChange={(event) => setSupply(event.target.value)}
              aria-invalid={!!supplyError}
            />
            {supplyError ? (
              <FieldError>{supplyError}</FieldError>
            ) : (
              <FieldDescription>
                <span className="numeric">{count(room)}</span> not allocated yet.
              </FieldDescription>
            )}
          </Field>
        </div>
        <Field orientation="horizontal">
          <Switch id={`${id}-scheduled`} checked={scheduled} onCheckedChange={setScheduled} />
          <FieldLabel htmlFor={`${id}-scheduled`}>Schedule a start</FieldLabel>
        </Field>
        {scheduled && <StartPicker value={start} onChange={setStart} blockTimestamp={ctx.blockTimestamp} />}
      </div>
    </TransactionDialog>
  )
}
