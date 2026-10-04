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
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import type { Address, Deployment, SupportedChain } from '@/lib/demo'
import { AddressLine } from './bits'
import { Setting } from './settings-parts'
import { SAMPLE } from './simulate'
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
  const [locked, setLocked] = useState(deployment.transfersLocked)
  const [dialog, setDialog] = useState<{ key: 'lock' | 'validator'; id: number; locked: boolean } | null>(
    null,
  )
  const [open, setOpen] = useState(false)
  const show = (key: 'lock' | 'validator') => {
    setDialog({ key, id: Date.now(), locked })
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
        description="Locking stops every send, sale and listing until you unlock. Mints and airdrops still work."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!chain.transferLock ? (
            <p className="text-muted-foreground text-sm">
              {chain.name} has no transfer validator, so transfers cannot be locked there.
            </p>
          ) : locked ? (
            <Badge variant="destructive" className="w-fit">
              <LockIcon aria-hidden="true" />
              Locked. Nobody can send, sell or list
            </Badge>
          ) : (
            <StatusBadge status="draft">Transferable</StatusBadge>
          )}
          {chain.transferLock && (
            <Button variant={locked ? 'secondary' : 'destructive'} size="sm" onClick={() => show('lock')}>
              {locked ? <LockOpenIcon aria-hidden="true" /> : <LockIcon aria-hidden="true" />}
              {locked ? 'Unlock' : 'Lock'}
            </Button>
          )}
        </div>
      </Setting>

      {dialog?.key === 'lock' && (
        <TransactionDialog
          key={dialog.id}
          {...base}
          destructive={!dialog.locked}
          title={dialog.locked ? 'Unlock transfers' : 'Lock transfers'}
          description={
            dialog.locked
              ? 'Holders can send and sell again, and marketplaces can list the collection.'
              : 'From the moment this confirms, nobody can send, sell or list these tokens until you unlock them. Open listings stop working. Mints and airdrops still work.'
          }
          actionLabel={dialog.locked ? 'Unlock' : 'Lock transfers'}
          successMessage={dialog.locked ? 'Transfers unlocked' : 'Transfers locked'}
          request={{
            // SEAM: the validator's exact function and level per chain are confirmed in Phase 1 (MASTER_PLAN, Contracts: lock).
            contract: 'Transfer validator',
            functionName: 'setTransferSecurityLevelOfCollection',
            args: [
              { name: 'collection', value: deployment.contractAddress },
              { name: 'level', value: dialog.locked ? 'Default' : 'Non-transferable' },
            ],
          }}
          onConfirmed={() => setLocked(!dialog.locked)}
        />
      )}
      {dialog?.key === 'validator' && (
        <ValidatorDialog key={dialog.id} {...base} current={validator} onApply={setValidator} />
      )}
    </>
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
          ? {
              contract: 'Collection',
              functionName: 'setTransferValidator',
              args: [{ name: 'validator', value: address }],
            }
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
