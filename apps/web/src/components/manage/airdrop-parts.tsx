'use client'

import { ExternalLinkIcon, FlameIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Badge } from '@cobweb/ui/components/badge'
import { Field, FieldDescription, FieldError, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import {
  DEAD_ADDRESS,
  explorerTxUrl,
  formatNative,
  mulWei,
  shortAddress,
  type AirdropRecord,
  type Hex,
  type SupportedChain,
} from '@/lib/demo'
import { Row } from './bits'
import { count, relativeTo, shortUtc } from './format'
import { TransactionDialog } from './transaction-dialog'

/** Past airdrops and burns, newest first. */
export function AirdropHistory({
  airdrops,
  chain,
  readAt,
}: {
  airdrops: AirdropRecord[]
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
  const sorted = [...airdrops].sort((a, b) => b.at - a.at)
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-6">When</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead className="text-right">Recipients</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Fee paid</TableHead>
          <TableHead className="pr-6 text-right">Transaction</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((airdrop) => (
          <TableRow key={airdrop.txHash}>
            <TableCell className="pl-6">
              <span className="numeric text-sm">{shortUtc(airdrop.at)}</span>
              <span className="text-muted-foreground block text-[0.8125rem]">
                {relativeTo(airdrop.at, readAt)}
              </span>
            </TableCell>
            <TableCell>
              {airdrop.burn ? (
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
            <TableCell className="numeric text-right">
              {formatNative(airdrop.feePaidWei, chain.nativeSymbol)}
            </TableCell>
            <TableCell className="pr-6 text-right">
              <a
                href={explorerTxUrl(chain, airdrop.txHash)}
                target="_blank"
                rel="noreferrer"
                className="numeric text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-[0.8125rem] outline-none focus-visible:ring-2"
              >
                {shortAddress(airdrop.txHash, 6)}
                <ExternalLinkIcon aria-hidden="true" className="size-3" />
                <span className="sr-only">, view on explorer</span>
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Why a burn quantity cannot be sent, or null. */
export function burnError(quantity: string, remaining: number): string | null {
  const amount = Number(quantity)
  if (!/^\d+$/.test(quantity) || amount < 1) return 'Enter a whole number of 1 or more.'
  if (amount > remaining) return `Only ${count(remaining)} tokens are left to mint.`
  return null
}

/**
 * Burn mode's input, in place of the recipients: how many tokens to mint straight to the dead
 * address (MASTER_PLAN, Contracts: burn), where nobody can ever use them.
 */
export function BurnQuantity({
  quantity,
  onChange,
  error,
  remaining,
}: {
  quantity: string
  onChange: (value: string) => void
  error: string | null
  remaining: number
}) {
  const id = useId()
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Burning mints tokens to the dead address,{' '}
        <span className="numeric">{shortAddress(DEAD_ADDRESS, 6)}</span>, where nobody can ever use them. Use
        it to shrink a drop that will not sell out. It cannot be undone, and it costs the airdrop fee per
        token.
      </p>
      <Field data-invalid={!!error} className="max-w-56">
        <FieldLabel htmlFor={`${id}-quantity`}>Tokens to burn</FieldLabel>
        <Input
          id={`${id}-quantity`}
          type="number"
          min={1}
          max={remaining}
          value={quantity}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={!!error}
          aria-describedby={`${id}-quantity-help`}
        />
        {error ? (
          <FieldError id={`${id}-quantity-help`}>{error}</FieldError>
        ) : (
          <FieldDescription id={`${id}-quantity-help`}>
            Up to <span className="numeric">{count(remaining)}</span>, the tokens left to mint.
          </FieldDescription>
        )}
      </Field>
    </div>
  )
}

/** The burn's confirmation: what it leaves, its fee, and typing "burn N" to enable the send. */
export function BurnDialog({
  open,
  onOpenChange,
  chain,
  amount,
  remaining,
  feePerTokenWei,
  onBurned,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: SupportedChain
  amount: number
  remaining: number
  feePerTokenWei: string
  onBurned: (hash: Hex) => void
}) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const fee = mulWei(feePerTokenWei, amount)
  const phrase = `burn ${amount}`
  const confirmed = typed.trim().toLowerCase() === phrase
  const noun = amount === 1 ? 'token' : 'tokens'

  return (
    <TransactionDialog
      open={open}
      onOpenChange={onOpenChange}
      chain={chain}
      destructive
      title={`Burn ${count(amount)} ${noun}`}
      description="The tokens are minted to the dead address and counted against supply for good. This cannot be undone."
      actionLabel={`Burn ${count(amount)} ${noun}`}
      successMessage={`${count(amount)} ${noun} burned`}
      request={
        confirmed
          ? {
              contract: 'Collection',
              functionName: 'airdropNFTs',
              args: [
                { name: 'recipients', value: `[${shortAddress(DEAD_ADDRESS, 6)}]` },
                { name: 'amounts', value: `[${amount}]` },
              ],
              valueWei: fee,
              check: () => (amount > remaining ? 'ExceedsMaxSupply' : null),
            }
          : null
      }
      onConfirmed={onBurned}
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
