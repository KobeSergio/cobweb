'use client'

import { LockIcon, LockOpenIcon, ShieldAlertIcon } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getAddress, isAddress, zeroAddress, type Hex } from 'viem'
import { DEFAULT_TRANSFER_VALIDATOR } from '@cobweb/shared'
import { Alert, AlertDescription } from '@cobweb/ui/components/alert'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { Checkbox } from '@cobweb/ui/components/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { RadioGroup, RadioGroupItem } from '@cobweb/ui/components/radio-group'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { ChainName } from '@/components/chains/chain-icon'
import type { ActionResult } from '@/lib/art/result'
import type { Address, SupportedChain } from '@/lib/demo'
import { settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView, TransferLevelState } from '@/lib/manage/settings-types'
import { TRANSFER_LEVELS, type TransferLevelValue } from '@/lib/manage/settings-view'
import { AddressLine } from './bits'
import { settingsRequest, type SettingsDialogBase } from './settings-dialogs'
import { Setting } from './settings-parts'
import { TransactionDialog } from './transaction-dialog'

/**
 * Tradability, as two rows of Settings, Advanced (docs/specs/2026-10-15-airdrop-settings.md, section 7.4): the
 * collection's transfer validator and the level it holds for the collection. The validator decides whether and
 * where tokens can be traded, and it is what enforces royalties on secondary sales. `off` is why nothing can be
 * changed now (the chain unread); `blocked` the owner check, under which the dialogs open with their action off.
 */
export function TradabilitySettings({
  view,
  chain,
  off,
  blocked,
  confirm,
  onConfirmed,
}: {
  view: SettingsView
  chain: SupportedChain
  off: string | null
  blocked: string | null
  confirm(hash: Hex, call: ManageCall): Promise<ActionResult<SettingsView>>
  onConfirmed(view: SettingsView): void
}) {
  // One dialog at a time; `at` freezes the view it was opened with, so its text does not flip once it lands.
  const [dialog, setDialog] = useState<{ key: 'level' | 'validator'; id: number; at: SettingsView } | null>(
    null,
  )
  const [open, setOpen] = useState(false)
  // The id of the dialog on screen, if any: a failure that reaches a closed or replaced dialog is toasted.
  const shownId = useRef<number | null>(null)
  shownId.current = dialog && open ? dialog.id : null
  const failedFor = (id: number | undefined) => (message: string) => {
    if (shownId.current !== id) toast.error(message)
  }
  const show = (key: 'level' | 'validator') => {
    setDialog({ key, id: Date.now(), at: view })
    setOpen(true)
  }
  const validator = view.transferValidator
  const level = view.level
  const base = {
    open,
    onOpenChange: setOpen,
    chain,
    blocked,
    confirm,
    onConfirmed,
    onFailed: failedFor(dialog?.id),
  }
  const atValidator = dialog?.at.transferValidator ?? null

  return (
    <>
      <Setting
        title="Transfer validator"
        description="Governs whether and where these tokens can be traded. Royalties are enforced on secondary sales through it."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {validator === null ? (
            <p className="text-muted-foreground text-sm">Not read</p>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <AddressLine address={validator} chain={chain} />
              <Badge variant={validator === DEFAULT_TRANSFER_VALIDATOR ? 'secondary' : 'warning'}>
                {validator === DEFAULT_TRANSFER_VALIDATOR
                  ? 'Limit Break default'
                  : validator === zeroAddress
                    ? 'No validator'
                    : 'Custom'}
              </Badge>
            </div>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => show('validator')}
            disabled={!!off || validator === null}
            title={off ?? undefined}
          >
            <ShieldAlertIcon aria-hidden="true" />
            Change validator
          </Button>
        </div>
      </Setting>

      <Setting
        title="Transfers"
        description="The validator's level for this collection: royalties enforced (the default), royalties not enforced, or locked. Mints and airdrops work at every level."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LevelState level={level} chain={chain} />
          {(level?.kind === 'unread' || level?.kind === 'level') && (
            <Button
              variant={
                level.kind === 'level' && level.level === TRANSFER_LEVELS.enforced
                  ? 'destructive'
                  : 'secondary'
              }
              size="sm"
              onClick={() => show('level')}
              disabled={!!off}
              title={off ?? undefined}
            >
              <ShieldAlertIcon aria-hidden="true" />
              Change level
            </Button>
          )}
        </div>
      </Setting>

      {dialog?.key === 'level' && atValidator && (
        <LevelDialog
          key={dialog.id}
          {...base}
          validator={atValidator}
          collection={dialog.at.contract}
          current={dialog.at.level?.kind === 'level' ? dialog.at.level.level : null}
        />
      )}
      {dialog?.key === 'validator' && atValidator && (
        <ValidatorDialog key={dialog.id} {...base} current={atValidator} />
      )}
    </>
  )
}

/** The level the validator holds for the collection, in the creator's words. */
function LevelState({ level, chain }: { level: TransferLevelState | null; chain: SupportedChain }) {
  if (level === null) return <p className="text-muted-foreground text-sm">Not read</p>
  if (level.kind === 'none')
    return level.reason === 'no-code' ? (
      <p className="text-muted-foreground text-sm">
        <ChainName chain={chain} className="text-foreground" iconClassName="size-3.5" /> has no transfer
        validator, so transfers cannot be locked there.
      </p>
    ) : (
      <p className="text-muted-foreground text-sm">No validator is set, so transfers are not checked.</p>
    )
  if (level.kind === 'unread')
    return (
      <p className="text-muted-foreground text-sm">
        The validator did not answer for this collection, so its level is not shown.
      </p>
    )
  if (level.level === TRANSFER_LEVELS.locked)
    return (
      <Badge variant="destructive" className="w-fit">
        <LockIcon aria-hidden="true" />
        Locked. Nobody can send, sell or list
      </Badge>
    )
  if (level.level === TRANSFER_LEVELS.open)
    return (
      <Badge variant="warning" className="w-fit">
        <LockOpenIcon aria-hidden="true" />
        Transferable, royalties not enforced
      </Badge>
    )
  if (level.level === TRANSFER_LEVELS.enforced)
    return <StatusBadge status="draft">Transferable, royalties enforced</StatusBadge>
  return <p className="text-sm">Level {level.level}, set outside Cobweb</p>
}

/** Legacy's three levels (OPEN_TO_ALL, FULLY_OPEN, SOULBOUND), in Cobweb's words, with the value the validator takes. */
const LEVELS: { value: TransferLevelValue; title: string; description: string }[] = [
  {
    value: TRANSFER_LEVELS.enforced,
    title: 'Royalties enforced',
    description: 'Holders can send and sell. Sales go through only where your royalty is paid. The default.',
  },
  {
    value: TRANSFER_LEVELS.open,
    title: 'Royalties not enforced',
    description:
      'Holders can send and sell anywhere, like a plain ERC-721. Royalties are up to the marketplace.',
  },
  {
    value: TRANSFER_LEVELS.locked,
    title: 'Locked',
    description: 'Nobody can send, sell or list until you change it back. Open listings stop working.',
  },
]

/** Change the collection's transfer level on its validator. Red for anything but the default. */
function LevelDialog({
  validator,
  collection,
  current,
  confirm,
  onConfirmed,
  ...base
}: SettingsDialogBase & { validator: Address; collection: Address; current: number | null }) {
  const id = useId()
  const [next, setNext] = useState<TransferLevelValue>(
    LEVELS.find((level) => level.value === current)?.value ?? TRANSFER_LEVELS.enforced,
  )
  const choice = LEVELS.find((level) => level.value === next) ?? LEVELS[0]!
  return (
    <TransactionDialog
      {...base}
      destructive={next !== TRANSFER_LEVELS.enforced}
      title="Transfer level"
      description="Applies to every token in the collection as soon as the transaction confirms. Mints and airdrops are not affected."
      actionLabel={`Set ${choice.title.toLowerCase()}`}
      successMessage={`Transfers: ${choice.title.toLowerCase()}`}
      request={
        next === current
          ? null
          : settingsRequest(settingsCalls.level(validator, collection, next), base.chain, confirm)
      }
      onConfirmed={onConfirmed}
    >
      <RadioGroup
        value={String(next)}
        onValueChange={(value) => setNext(Number(value) as TransferLevelValue)}
        className="gap-3"
      >
        {LEVELS.map((level) => (
          <label
            key={level.value}
            htmlFor={`${id}-${level.value}`}
            className="flex items-start gap-3 text-sm"
          >
            <RadioGroupItem id={`${id}-${level.value}`} value={String(level.value)} className="mt-0.5" />
            <span>
              <span className="font-medium">
                {level.title}
                {level.value === current && <span className="text-muted-foreground font-normal"> (now)</span>}
              </span>
              <span className="text-muted-foreground block text-[0.8125rem]">{level.description}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </TransactionDialog>
  )
}

/** Point the collection at another transfer validator. Red, and confirmed with a tick box. */
function ValidatorDialog({
  current,
  confirm,
  onConfirmed,
  ...base
}: SettingsDialogBase & { current: Address }) {
  const id = useId()
  const [value, setValue] = useState('')
  const [understood, setUnderstood] = useState(false)
  const trimmed = value.trim()
  const address = isAddress(trimmed) ? getAddress(trimmed) : null
  const error = !trimmed
    ? null
    : !address
      ? 'Enter a full 0x address, 42 characters, with a matching checksum.'
      : address.toLowerCase() === current.toLowerCase()
        ? 'That is the current validator.'
        : null

  return (
    <TransactionDialog
      {...base}
      destructive
      title="Change the transfer validator"
      description="The validator decides whether and where every token in the collection can be traded, and it enforces your royalties on secondary sales."
      actionLabel="Change validator"
      successMessage="Transfer validator changed"
      request={
        address && !error && understood
          ? settingsRequest(settingsCalls.validator(address), base.chain, confirm)
          : null
      }
      onConfirmed={onConfirmed}
    >
      <div className="grid gap-5">
        <Alert variant="destructive">
          <ShieldAlertIcon aria-hidden="true" />
          <AlertDescription>
            A validator you have not checked can block every transfer or let tokens trade without paying
            royalties. Use only a validator you trust. The zero address removes the check entirely.
          </AlertDescription>
        </Alert>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={`${id}-validator`}>New validator address</FieldLabel>
          <Input
            id={`${id}-validator`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
            className="numeric"
            aria-invalid={!!error}
            aria-describedby={`${id}-validator-help`}
          />
          {error ? (
            <FieldError id={`${id}-validator-help`}>{error}</FieldError>
          ) : (
            <FieldDescription id={`${id}-validator-help`} className="flex flex-wrap items-center gap-x-2">
              <span>
                Now <span className="numeric break-all">{current}</span>
              </span>
              {current !== DEFAULT_TRANSFER_VALIDATOR && (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto px-0"
                  onClick={() => setValue(DEFAULT_TRANSFER_VALIDATOR)}
                >
                  Use the Limit Break default
                </Button>
              )}
            </FieldDescription>
          )}
        </Field>
        <label htmlFor={`${id}-understood`} className="flex items-start gap-3 text-sm">
          <Checkbox
            id={`${id}-understood`}
            checked={understood}
            onCheckedChange={(checked) => setUnderstood(checked === true)}
            className="mt-0.5"
          />
          I understand this changes where and whether holders can trade, and how royalties are enforced.
        </label>
      </div>
    </TransactionDialog>
  )
}
