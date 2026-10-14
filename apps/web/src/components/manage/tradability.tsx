'use client'

import { LockIcon, LockOpenIcon, ShieldAlertIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { getAddress, isAddress } from 'viem'
import { Alert, AlertDescription } from '@cobweb/ui/components/alert'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { Checkbox } from '@cobweb/ui/components/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { RadioGroup, RadioGroupItem } from '@cobweb/ui/components/radio-group'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { ChainName } from '@/components/chains/chain-icon'
import type { Address, Deployment, SupportedChain } from '@/lib/demo'
import { AddressLine } from './bits'
import { Setting } from './settings-parts'
import { SAMPLE, sampleRequest } from './manage-sim'
import { TransactionDialog } from './transaction-dialog'

const DEFAULT_VALIDATOR = SAMPLE.transferValidator

/**
 * Tradability, as two rows of Settings, Advanced: the collection's transfer validator and its
 * lock. The validator decides whether and where tokens can be traded, and it is what enforces
 * royalties on secondary sales.
 */
export function TradabilitySettings({
  deployment,
  chain,
}: {
  deployment: Deployment
  chain: SupportedChain
}) {
  const [validator, setValidator] = useState<Address>(DEFAULT_VALIDATOR)
  // Seam: read from the validator (`getCollectionSecurityPolicy` or the V5 ruleset) through the freshness server.
  const [level, setLevel] = useState<TransferLevel>(deployment.transfersLocked ? 'locked' : 'enforced')
  const [dialog, setDialog] = useState<{
    key: 'lock' | 'validator'
    id: number
    level: TransferLevel
  } | null>(null)
  const [open, setOpen] = useState(false)
  const show = (key: 'lock' | 'validator') => {
    setDialog({ key, id: Date.now(), level })
    setOpen(true)
  }
  const isDefault = validator.toLowerCase() === DEFAULT_VALIDATOR.toLowerCase()
  const base = { open, onOpenChange: setOpen, chain }

  return (
    <>
      <Setting
        title="Transfer validator"
        description="Governs whether and where these tokens can be traded. Royalties are enforced on secondary sales through it."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <AddressLine address={validator} chain={chain} />
            <Badge variant={isDefault ? 'secondary' : 'warning'}>
              {isDefault ? 'Limit Break default' : 'Custom'}
            </Badge>
          </div>
          <Button variant="destructive" size="sm" onClick={() => show('validator')}>
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
          {!chain.transferLock ? (
            <p className="text-muted-foreground text-sm">
              <ChainName chain={chain} className="text-foreground" iconClassName="size-3.5" /> has no transfer
              validator, so transfers cannot be locked there.
            </p>
          ) : level === 'locked' ? (
            <Badge variant="destructive" className="w-fit">
              <LockIcon aria-hidden="true" />
              Locked. Nobody can send, sell or list
            </Badge>
          ) : level === 'open' ? (
            <Badge variant="warning" className="w-fit">
              <LockOpenIcon aria-hidden="true" />
              Transferable, royalties not enforced
            </Badge>
          ) : (
            <StatusBadge status="draft">Transferable, royalties enforced</StatusBadge>
          )}
          {chain.transferLock && (
            <Button
              variant={level === 'enforced' ? 'destructive' : 'secondary'}
              size="sm"
              onClick={() => show('lock')}
            >
              <ShieldAlertIcon aria-hidden="true" />
              Change level
            </Button>
          )}
        </div>
      </Setting>

      {dialog?.key === 'lock' && (
        <LevelDialog
          key={dialog.id}
          {...base}
          collection={deployment.contractAddress}
          current={dialog.level}
          onApply={setLevel}
        />
      )}
      {dialog?.key === 'validator' && (
        <ValidatorDialog key={dialog.id} {...base} current={validator} onApply={setValidator} />
      )}
    </>
  )
}

type TransferLevel = 'enforced' | 'open' | 'locked'

/** Legacy's three levels (OPEN_TO_ALL, FULLY_OPEN, SOULBOUND), in Cobweb's words. */
const LEVELS: { value: TransferLevel; title: string; description: string; arg: string }[] = [
  {
    value: 'enforced',
    title: 'Royalties enforced',
    description: 'Holders can send and sell. Sales go through only where your royalty is paid. The default.',
    arg: 'Royalties enforced',
  },
  {
    value: 'open',
    title: 'Royalties not enforced',
    description:
      'Holders can send and sell anywhere, like a plain ERC-721. Royalties are up to the marketplace.',
    arg: 'Open',
  },
  {
    value: 'locked',
    title: 'Locked',
    description: 'Nobody can send, sell or list until you change it back. Open listings stop working.',
    arg: 'Non-transferable',
  },
]

/** Change the collection's transfer level on the validator. Red for anything but the default. */
function LevelDialog({
  collection,
  current,
  onApply,
  ...base
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: SupportedChain
  collection: Address
  current: TransferLevel
  onApply: (level: TransferLevel) => void
}) {
  const id = useId()
  const [next, setNext] = useState<TransferLevel>(current)
  const choice = LEVELS.find((level) => level.value === next)!
  return (
    <TransactionDialog
      {...base}
      destructive={next !== 'enforced'}
      title="Transfer level"
      description="Applies to every token in the collection as soon as the transaction confirms. Mints and airdrops are not affected."
      actionLabel={`Set ${choice.title.toLowerCase()}`}
      successMessage={`Transfers: ${choice.title.toLowerCase()}`}
      request={
        next === current
          ? null
          : sampleRequest({
              // Seam: legacy called `setRulesetOfCollection(collection, 0 | 1 | 2, 0x0, 0, 0)` on validator
              // V5 and `setTransferSecurityLevelOfCollection(collection, 0 | 1 | 9, false, false, false)` on
              // V4. The exact call per chain is confirmed in Phase 5 (MASTER_PLAN, Contracts: lock).
              contract: 'Transfer validator',
              functionName: 'setTransferSecurityLevelOfCollection',
              args: [
                { name: 'collection', value: collection },
                { name: 'level', value: choice.arg },
              ],
            })
      }
      onConfirmed={() => onApply(next)}
    >
      <RadioGroup value={next} onValueChange={(value) => setNext(value as TransferLevel)} className="gap-3">
        {LEVELS.map((level) => (
          <label
            key={level.value}
            htmlFor={`${id}-${level.value}`}
            className="flex items-start gap-3 text-sm"
          >
            <RadioGroupItem id={`${id}-${level.value}`} value={level.value} className="mt-0.5" />
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
  onApply,
  ...base
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: SupportedChain
  current: Address
  onApply: (validator: Address) => void
}) {
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
          ? sampleRequest({
              contract: 'Collection',
              functionName: 'setTransferValidator',
              args: [{ name: 'validator', value: address }],
            })
          : null
      }
      onConfirmed={() => address && onApply(address)}
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
              {current.toLowerCase() !== DEFAULT_VALIDATOR.toLowerCase() && (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto px-0"
                  onClick={() => setValue(DEFAULT_VALIDATOR)}
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
