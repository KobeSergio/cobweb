'use client'

import { AlertTriangleIcon, CalendarIcon, ExternalLinkIcon, InfoIcon } from 'lucide-react'
import { useEffect, useId, useReducer, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Calendar } from '@cobweb/ui/components/calendar'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@cobweb/ui/components/popover'
import { Switch } from '@cobweb/ui/components/switch'
import { deployReducer, type DeployEvent } from '@/components/deploy/deploy-machine'
import { classifyError } from '@/components/deploy/tx-errors'
import { isTxRunning, TX_IDLE, TxProgress, type TxFailure } from '@/components/deploy/tx-progress'
import {
  explorerTxUrl,
  formatUtc,
  shortAddress,
  toWei,
  type MintGroup,
  type SupportedChain,
} from '@/lib/demo'
import { phaseCalls } from '@/lib/manage/phase-calls'
import type { PhaseAdd, PhasesView } from '@/lib/manage/phases-types'
import { count, relativeTo, useTimeZone } from './format'
import { useManageActions } from './manage-context'
import { runManage, type PendingAdd } from './manage-machine'
import { phaseRequest, type PhaseContext } from './phase-dialogs'
import { PhaseDetailsFields, type PhaseDetails } from './phase-details'
import { allocationCheck, phaseNameError, priceError } from './phase-rules'
import type { PhasesServer } from './phases-server'
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
 * zone (skipped by a daylight-saving change). `now` is the chain's estimated time (the screen's
 * `useChainClock`): it moves the labels, the calendar's first day and the warning, never liveness.
 */
function StartPicker({
  value,
  onChange,
  now,
  timeZone,
}: {
  value: ZonedStart
  onChange: (start: ZonedStart) => void
  now: number
  timeZone: string
}) {
  const id = useId()
  const [calendarOpen, setCalendarOpen] = useState(false)
  const unix = zonedToUnix(value, timeZone)
  const warning = scheduleWarning(unix, now)
  const day = toCalendarDay(value.date)
  const chainDay = toCalendarDay(unixToZoned(now, timeZone).date)
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
          <dd className="numeric text-right">{relativeTo(unix, now)}</dd>
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
  onView,
  ...ctx
}: PhaseContext & { group: MintGroup; onView: (view: PhasesView) => void }) {
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
      request={phaseRequest(unix === null ? null : phaseCalls.schedule(group.id, unix), ctx)}
      onConfirmed={onView}
      onFailed={ctx.onFailed}
    >
      <StartPicker value={start} onChange={setStart} now={ctx.now} timeZone={timeZone} />
    </TransactionDialog>
  )
}

/**
 * Register a new whitelist phase with its price, allocation and an optional start, in one
 * `registerMintGroup` call (docs/specs/2026-10-15-phases.md, section 7.4). The id is the next free one
 * the contract reports. Name, description and visibility are recorded by Cobweb only after the receipt
 * proves the registration; until then the browser keeps the sent hash and the form (`pending`).
 */
export function AddPhaseDialog({
  onView,
  onRemember,
  onForget,
  ...ctx
}: PhaseContext & {
  onView: (view: PhasesView) => void
  onRemember: (pending: PendingAdd) => void
  onForget: () => void
}) {
  const id = useId()
  const timeZone = useTimeZone()
  const { actions } = useManageActions()
  const [nextId, setNextId] = useState<number | null>(null)
  const [idUnread, setIdUnread] = useState(false)
  const [details, setDetails] = useState<PhaseDetails>({ name: '', description: '', visible: true })
  const [price, setPrice] = useState('0')
  const [supply, setSupply] = useState(() =>
    String(Math.min(100, Math.max(0, ctx.maxSupply - ctx.groups.reduce((sum, g) => sum + g.maxSupply, 0)))),
  )
  const [scheduled, setScheduled] = useState(false)
  const [start, setStart] = useState<ZonedStart>(() => defaultStart(ctx.blockTimestamp, timeZone))

  // The next free id, from the contract's own list of groups (the highest plus one).
  useEffect(() => {
    let live = true
    actions.nextGroupId().then(
      (next) => {
        if (live) setNextId(next)
      },
      () => {
        if (live) setIdUnread(true)
      },
    )
    return () => {
      live = false
    }
  }, [actions])

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
  const ready = !nameError && !priceProblem && !allocation.error && unix !== null && nextId !== null
  const add: PhaseAdd | null =
    nextId === null
      ? null
      : {
          onchainId: nextId,
          name: details.name.trim(),
          description: details.description.trim(),
          visible: details.visible,
        }
  const request =
    ready && add && unix !== null
      ? phaseRequest(phaseCalls.register(add.onchainId, toWei(price.trim()), allocation.next, unix), ctx)
      : null

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
        request && add
          ? {
              ...request,
              confirm: (hash) => ctx.server.record(hash, add),
              pending: {
                remember: (hash) => onRemember({ hash, form: add }),
                forget: onForget,
              },
            }
          : null
      }
      onConfirmed={onView}
      onFailed={ctx.onFailed}
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
        {scheduled && <StartPicker value={start} onChange={setStart} now={ctx.now} timeZone={timeZone} />}
        {idUnread ? (
          <p className="text-destructive-foreground text-[0.8125rem]">
            The contract could not be read for the next phase id. Close this and try again.
          </p>
        ) : (
          nextId === null && (
            <p className="text-muted-foreground text-[0.8125rem]">
              Reading the next phase id from the contract.
            </p>
          )
        )}
      </div>
    </TransactionDialog>
  )
}

/**
 * An add this browser sent that Cobweb has not recorded yet (section 7.4): its name, its transaction,
 * "Check again", which runs the manage machine from verifying with the remembered hash and form, and
 * "Discard", for a transaction that was replaced or will never land.
 */
export function PendingAddPanel({
  pending,
  chain,
  server,
  onView,
  onForget,
}: {
  pending: PendingAdd
  chain: SupportedChain
  server: PhasesServer
  onView: (view: PhasesView) => void
  onForget: () => void
}) {
  const { chainId, wallet } = useManageActions()
  const [phase, dispatch] = useReducer(deployReducer, TX_IDLE)
  const running = isTxRunning(phase)

  async function check() {
    const last: { failure: TxFailure | null } = { failure: null }
    const report = (event: DeployEvent) => {
      if (event.type === 'failed') last.failure = event.failure
      dispatch(event)
    }
    let view: PhasesView | null = null
    try {
      view = await runManage<PhasesView>(
        {
          call: null,
          account: wallet,
          wallet,
          chainId,
          connectedChainId: chainId,
          sentHash: pending.hash,
          addId: pending.form.onchainId,
        },
        {
          switchChain: async () => {},
          simulate: () => Promise.reject(new Error('A remembered add is checked, never sent again.')),
          wait: async () => 'success',
          confirm: (hash) => server.record(hash, pending.form),
          forget: onForget,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        },
        report,
      )
    } catch (error) {
      report({ type: 'failed', failure: classifyError(error, 'confirming', 'manage') })
    }
    if (view) {
      onView(view)
      toast.success(`${pending.form.name} added`)
      return
    }
    // A terminal answer forgets the add, which closes this panel: its sentence goes to a toast.
    if (last.failure?.kind === 'refused') toast.error(last.failure.message)
  }

  return (
    <Alert>
      <InfoIcon aria-hidden="true" />
      <AlertTitle>A new phase is waiting to be recorded</AlertTitle>
      <AlertDescription>
        <p>
          This browser sent the registration of <span className="text-foreground">{pending.form.name}</span>{' '}
          as group <span className="numeric">{pending.form.onchainId}</span>. Cobweb records its name once the
          receipt shows it on the contract.
        </p>
        {chain.explorerUrl ? (
          <a
            href={explorerTxUrl(chain, pending.hash)}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[0.8125rem] underline-offset-4 hover:underline"
          >
            Transaction <span className="numeric">{shortAddress(pending.hash, 6)}</span>
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens the block explorer)</span>
          </a>
        ) : (
          <p className="numeric text-muted-foreground text-[0.8125rem] break-all">{pending.hash}</p>
        )}
        {phase.step !== 'idle' && (
          <TxProgress
            phase={phase}
            steps={[
              {
                step: 'verifying',
                label: 'Recording the phase',
                detail:
                  'Cobweb checks the receipt for the registration, records the name and reads the contract again.',
              },
            ]}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void check()} disabled={running}>
            Check again
          </Button>
          <Button variant="ghost" size="sm" onClick={onForget} disabled={running}>
            Discard
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
