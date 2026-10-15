'use client'

import { FlameIcon } from 'lucide-react'
import { useId, useState } from 'react'
import type { Hex } from 'viem'
import { Badge } from '@cobweb/ui/components/badge'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import type { ActionResult } from '@/lib/art/result'
import { formatNative, mulWei, shortAddress, type SupportedChain } from '@/lib/demo'
import type { AirdropRow, AirdropView } from '@/lib/manage/airdrop-types'
import { AIRDROP_MAX_TOKENS, BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { burnRequest, tokensLabel } from './airdrop-dialogs'
import { Row, TxLink } from './bits'
import { count, relativeTo, shortUtc } from './format'
import { toCsv } from './recipients'
import { TransactionDialog } from './transaction-dialog'

/** Token ids a recorded airdrop minted: `#41 to #50`, or `#41` for one. */
export function tokenRange(airdrop: AirdropRow): string {
  return airdrop.firstTokenId === airdrop.lastTokenId
    ? `#${airdrop.firstTokenId}`
    : `#${airdrop.firstTokenId} to #${airdrop.lastTokenId}`
}

/** History as CSV, one row per transaction in History's order (newest first), as legacy's "Export CSV". */
export function airdropHistoryCsv(airdrops: AirdropRow[], chain: SupportedChain): string {
  return toCsv([
    [
      'date_utc',
      'kind',
      'recipients',
      'tokens',
      'token_ids',
      `fee_${chain.nativeSymbol.toLowerCase()}`,
      'tx_hash',
    ],
    ...airdrops.map((airdrop) => [
      new Date(airdrop.confirmedAt * 1000).toISOString(),
      airdrop.kind,
      airdrop.recipients,
      airdrop.tokens,
      tokenRange(airdrop),
      formatNative(airdrop.feePaidWei, '', 18).trim().replace(/,/g, ''),
      airdrop.txHash,
    ]),
  ])
}

/** The batches and burns Cobweb confirmed, newest first. When is when Cobweb recorded each. */
export function AirdropHistory({
  airdrops,
  chain,
  readAt,
}: {
  airdrops: AirdropRow[]
  chain: SupportedChain
  readAt: number
}) {
  if (airdrops.length === 0) {
    return (
      <p className="text-muted-foreground px-6 py-10 text-center text-sm">
        No airdrops yet. Each one you send is listed here.
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-6">When</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead className="text-right">Recipients</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead>Token ids</TableHead>
          <TableHead className="text-right">Fee paid</TableHead>
          <TableHead className="pr-6 text-right">Transaction</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {airdrops.map((airdrop) => (
          <TableRow key={airdrop.txHash}>
            <TableCell className="pl-6">
              <span className="numeric text-sm">{shortUtc(airdrop.confirmedAt)}</span>
              <span className="text-muted-foreground block text-[0.8125rem]">
                {relativeTo(airdrop.confirmedAt, readAt)}
              </span>
            </TableCell>
            <TableCell>
              {airdrop.kind === 'burn' ? (
                <Badge variant="destructive">
                  <FlameIcon aria-hidden="true" />
                  Burn
                </Badge>
              ) : (
                <Badge variant="secondary">Airdrop</Badge>
              )}
            </TableCell>
            <TableCell className="numeric text-right">{count(airdrop.recipients)}</TableCell>
            <TableCell className="numeric text-right">{count(airdrop.tokens)}</TableCell>
            <TableCell className="numeric text-muted-foreground text-[0.8125rem]">
              {tokenRange(airdrop)}
            </TableCell>
            <TableCell className="numeric text-right">
              {formatNative(airdrop.feePaidWei, chain.nativeSymbol)}
            </TableCell>
            <TableCell className="pr-6 text-right">
              <TxLink chain={chain} hash={airdrop.txHash} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Why a burn quantity cannot be sent, or null: a whole number, no more than is left, 1,000 at most at a time. */
export function burnError(quantity: string, remaining: number): string | null {
  const amount = Number(quantity)
  if (!/^\d+$/.test(quantity) || amount < 1) return 'Enter a whole number of 1 or more.'
  if (amount > remaining) return `Only ${count(remaining)} tokens are left to mint.`
  if (amount > AIRDROP_MAX_TOKENS) return 'Burn up to 1,000 tokens at a time.'
  return null
}

/**
 * Burn mode's input, in place of the recipients: how many tokens to mint straight to the dead address
 * (MASTER_PLAN, Contracts: burn), where nobody can ever use them. `remaining` is null while the contract cannot
 * be read. `disabled` while a burn is in flight, so the quote keeps describing the burn being sent.
 */
export function BurnQuantity({
  quantity,
  onChange,
  error,
  remaining,
  disabled = false,
}: {
  quantity: string
  onChange: (value: string) => void
  error: string | null
  remaining: number | null
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Burning mints tokens to the dead address,{' '}
        <span className="numeric">{shortAddress(BURN_ADDRESS, 6)}</span>, where nobody can ever use them. Use
        it to shrink a drop that will not sell out. It cannot be undone, and it costs the airdrop fee per
        token.
      </p>
      <Field data-invalid={!!error} className="max-w-56">
        <FieldLabel htmlFor={`${id}-quantity`}>Tokens to burn</FieldLabel>
        <Input
          id={`${id}-quantity`}
          type="number"
          min={1}
          max={Math.min(remaining ?? AIRDROP_MAX_TOKENS, AIRDROP_MAX_TOKENS)}
          value={quantity}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={`${id}-quantity-help`}
        />
        {error ? (
          <FieldError id={`${id}-quantity-help`}>{error}</FieldError>
        ) : remaining !== null && remaining <= AIRDROP_MAX_TOKENS ? (
          <FieldDescription id={`${id}-quantity-help`}>
            Up to <span className="numeric">{count(remaining)}</span>, the tokens left to mint.
          </FieldDescription>
        ) : (
          <FieldDescription id={`${id}-quantity-help`}>
            Up to 1,000 at a time.
            {remaining !== null && (
              <>
                {' '}
                <span className="numeric">{count(remaining)}</span> are left to mint.
              </>
            )}
          </FieldDescription>
        )}
      </Field>
    </div>
  )
}

/**
 * The burn's confirmation: what it leaves, its fee, and typing "burn N" to enable the send, which sends one
 * batch to the dead address (docs/specs/2026-10-15-airdrop-settings.md, section 7.3). With `blocked` (the owner
 * check, or a hash waiting) it opens for reading, its action off.
 */
export function BurnDialog({
  open,
  onOpenChange,
  chain,
  amount,
  remaining,
  feePerTokenWei,
  blocked,
  confirm,
  pending,
  onBurned,
  onFailed,
  onRunningChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: SupportedChain
  amount: number
  remaining: number
  feePerTokenWei: string
  blocked: string | null
  confirm: (hash: Hex) => Promise<ActionResult<AirdropView>>
  pending: { remember(hash: Hex): void; forget(): void }
  onBurned: (view: AirdropView) => void
  onFailed: (message: string) => void
  /** Each run's start and end, told even after the dialog closed: the screen keeps the burn off meanwhile. */
  onRunningChange: (running: boolean) => void
}) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const fee = mulWei(feePerTokenWei, amount)
  const phrase = `burn ${amount}`
  const confirmed = typed.trim().toLowerCase() === phrase

  return (
    <TransactionDialog
      open={open}
      onOpenChange={onOpenChange}
      chain={chain}
      destructive
      blocked={blocked}
      title={`Burn ${tokensLabel(amount)}`}
      description="The tokens are minted to the dead address and counted against supply for good. This cannot be undone."
      actionLabel={`Burn ${tokensLabel(amount)}`}
      successMessage={`${tokensLabel(amount)} burned`}
      request={confirmed ? burnRequest(amount, feePerTokenWei, chain, confirm, pending) : null}
      onConfirmed={onBurned}
      onFailed={onFailed}
      onRunningChange={onRunningChange}
    >
      <dl className="divide-y rounded-lg border px-4">
        <Row label="Left to mint now">{count(remaining)}</Row>
        <Row label="Left after the burn">{count(remaining - amount)}</Row>
        <Row label="Fee">{formatNative(fee, chain.nativeSymbol)}</Row>
      </dl>
      <Field>
        <FieldLabel htmlFor={`${id}-confirm`}>
          Type <span className="numeric bg-surface-3 rounded-sm px-1.5">{phrase}</span> to confirm
        </FieldLabel>
        <Input
          id={`${id}-confirm`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="numeric"
        />
      </Field>
    </TransactionDialog>
  )
}

/** Left to mint now and after the send: `after` null means the send is more than is left; `remaining` null, not read. */
export function SupplyNote({
  remaining,
  after,
  label,
}: {
  remaining: number | null
  after: number | null
  label: string
}) {
  return (
    <div className="bg-well shadow-inset rounded-lg px-3 py-2.5 text-[0.8125rem]">
      <p className="flex justify-between">
        <span className="text-muted-foreground">Left to mint</span>
        <span className={remaining === null ? 'text-muted-foreground' : 'numeric'}>
          {remaining === null ? 'Not read' : count(remaining)}
        </span>
      </p>
      <p className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={
            remaining === null
              ? 'text-muted-foreground'
              : after === null
                ? 'numeric text-destructive-foreground'
                : 'numeric'
          }
        >
          {remaining === null ? 'Not read' : after === null ? 'Not enough' : count(after)}
        </span>
      </p>
    </div>
  )
}
