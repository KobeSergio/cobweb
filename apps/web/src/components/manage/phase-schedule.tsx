'use client'

import { AlertTriangleIcon, CalendarIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Calendar } from '@cobweb/ui/components/calendar'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@cobweb/ui/components/popover'
import { Switch } from '@cobweb/ui/components/switch'
import { formatUtc, toWei, type MintGroup } from '@/lib/demo'
import { count, relativeTo, useTimeZone } from './format'
import type { PhaseContext } from './phase-dialogs'
import { PhaseDetailsFields, type PhaseDetails } from './phase-details'
import { allocationCheck, phaseNameError, priceError } from './phase-rules'
import { PriceInput } from './price-input'
import { defaultStart, unixToZoned, zonedToUnix, type ZonedStart } from './schedule'
import { scheduleWarning } from './schedule-logic'
import { TransactionDialog } from './transaction-dialog'

/** `YYYY-MM-DD` to a Date for the calendar (a calendar day, not an instant). */
const toCalendarDay = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return year && month && day ? new Date(year, month - 1, day) : undefined
}
const fromCalendarDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/**
 * Date and time in the creator's time zone, with what that means in UTC and the exact value
 * the transaction sends. Warns when the time has already passed on chain, or does not exist in the
 * zone (skipped by a daylight-saving change).
 */
function StartPicker({
  value,
  onChange,
  blockTimestamp,
  timeZone,
}: {
  value: ZonedStart
  onChange: (start: ZonedStart) => void
  blockTimestamp: number
  timeZone: string
}) {
  const id = useId()
  const [calendarOpen, setCalendarOpen] = useState(false)
  const unix = zonedToUnix(value, timeZone)
  const warning = scheduleWarning(unix, blockTimestamp)
  const day = toCalendarDay(value.date)
  const chainDay = toCalendarDay(unixToZoned(blockTimestamp, timeZone).date)
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Field>
          <FieldLabel htmlFor={`${id}-date`}>Date</FieldLabel>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button id={`${id}-date`} type="button" variant="outline" className="justify-start font-normal">
                <CalendarIcon aria-hidden="true" />
                {day
                  ? day.toLocaleDateString('en-US', {
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
                selected={day}
                defaultMonth={day}
                disabled={chainDay ? { before: chainDay } : undefined}
                onSelect={(date) => {
                  if (date) onChange({ ...value, date: fromCalendarDay(date) })
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

      {unix !== null ? (
        <dl className="bg-well shadow-inset grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border px-4 py-3 text-[0.8125rem]">
          <dt className="text-muted-foreground">UTC</dt>
          <dd className="numeric text-right">{formatUtc(unix)}</dd>
          <dt className="text-muted-foreground">Unix time sent</dt>
          <dd className="numeric text-right">{unix}</dd>
          <dt className="text-muted-foreground">From the chain&apos;s time</dt>
          <dd className="numeric text-right">{relativeTo(unix, blockTimestamp)}</dd>
        </dl>
      ) : (
        value.date &&
        value.time && (
          <FieldError>
            {value.time} does not exist on that day in {timeZone}: the clocks skip it. Pick another time.
          </FieldError>
        )
      )}
      {warning && (
        <p role="alert" className="bg-warning-soft flex gap-2 rounded-lg px-4 py-3 text-sm">
          <AlertTriangleIcon aria-hidden="true" className="text-warning-foreground mt-0.5 size-4 shrink-0" />
          {warning}
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
  const timeZone = useTimeZone()
  const [start, setStart] = useState<ZonedStart>(() =>
    group.scheduledStart > 0
      ? unixToZoned(group.scheduledStart, timeZone)
      : defaultStart(ctx.blockTimestamp, timeZone),
  )
  const unix = zonedToUnix(start, timeZone)
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
      <StartPicker
        value={start}
        onChange={setStart}
        blockTimestamp={ctx.blockTimestamp}
        timeZone={timeZone}
      />
    </TransactionDialog>
  )
}

/**
 * Register a new whitelist phase with its price, allocation and an optional start, in one
 * `registerMintGroup` call (legacy registered an index with an empty `setMintQuota` and set the
 * rest in later transactions). Name, description and visibility are saved by Cobweb.
 */
export function AddPhaseDialog({
  onAdd,
  ...ctx
}: PhaseContext & { onAdd: (group: Omit<MintGroup, 'active'>) => void }) {
  const id = useId()
  const timeZone = useTimeZone()
  const nextId = Math.max(0, ...ctx.groups.map((group) => group.id)) + 1
  const [details, setDetails] = useState<PhaseDetails>({ name: '', description: '', visible: true })
  const [price, setPrice] = useState('0')
  const [supply, setSupply] = useState(() =>
    String(Math.min(100, Math.max(0, ctx.maxSupply - ctx.groups.reduce((sum, g) => sum + g.maxSupply, 0)))),
  )
  const [scheduled, setScheduled] = useState(false)
  const [start, setStart] = useState<ZonedStart>(() => defaultStart(ctx.blockTimestamp, timeZone))

  const nameError = phaseNameError(
    details.name,
    ctx.groups.map((group) => group.name),
  )
  const priceProblem = priceError(price, ctx.chain.nativeSymbol)
  const allocation = allocationCheck({
    groups: ctx.groups,
    maxSupply: ctx.maxSupply,
    groupId: null,
    value: supply,
    airdropped: ctx.airdropped,
    min: 1,
  })
  const unix = scheduled ? zonedToUnix(start, timeZone) : 0
  const ready = !nameError && !priceProblem && !allocation.error && unix !== null

  return (
    <TransactionDialog
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      chain={ctx.chain}
      title="Add a phase"
      description="A new whitelist phase. It starts closed unless you schedule it; add its addresses on the Whitelist tab."
      actionLabel="Add phase"
      successMessage={`${details.name.trim() || 'Phase'} added`}
      className="sm:max-w-xl"
      request={
        ready
          ? {
              contract: 'Collection',
              functionName: 'registerMintGroup',
              args: [
                { name: 'mintGroup', value: String(nextId) },
                { name: 'price', value: `${toWei(price.trim())} wei` },
                { name: 'maxSupply', value: String(allocation.next) },
                { name: 'startTimestamp', value: String(unix) },
              ],
              check: () => (allocation.next > allocation.room ? 'AllocationsExceedMaxSupply' : null),
            }
          : null
      }
      onConfirmed={() =>
        // Seam: name, description and visibility are written to `mint_groups` with the group id.
        onAdd({
          id: nextId,
          name: details.name.trim(),
          description: details.description.trim(),
          visible: details.visible,
          kind: 'whitelist',
          priceWei: toWei(price.trim()),
          maxSupply: allocation.next,
          minted: 0,
          flag: false,
          scheduledStart: unix ?? 0,
        })
      }
    >
      <div className="grid gap-5">
        <PhaseDetailsFields
          value={details}
          onChange={setDetails}
          nameError={details.name ? nameError : null}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <PriceInput
            id={`${id}-price`}
            value={price}
            onChange={setPrice}
            chain={ctx.chain}
            error={priceProblem}
          />
          <Field data-invalid={!!allocation.error}>
            <FieldLabel htmlFor={`${id}-supply`}>Max supply</FieldLabel>
            <Input
              id={`${id}-supply`}
              type="number"
              min={1}
              max={allocation.room}
              value={supply}
              onChange={(event) => setSupply(event.target.value)}
              aria-invalid={!!allocation.error}
            />
            {allocation.error ? (
              <FieldError>{allocation.error}</FieldError>
            ) : (
              <FieldDescription className={allocation.warning ? 'text-warning-foreground' : undefined}>
                {allocation.warning ?? (
                  <>
                    <span className="numeric">{count(allocation.room)}</span> not allocated yet.
                  </>
                )}
              </FieldDescription>
            )}
          </Field>
        </div>
        <Field orientation="horizontal">
          <Switch id={`${id}-scheduled`} checked={scheduled} onCheckedChange={setScheduled} />
          <FieldLabel htmlFor={`${id}-scheduled`}>Schedule a start</FieldLabel>
        </Field>
        {scheduled && (
          <StartPicker
            value={start}
            onChange={setStart}
            blockTimestamp={ctx.blockTimestamp}
            timeZone={timeZone}
          />
        )}
      </div>
    </TransactionDialog>
  )
}
