'use client'

import { ExternalLinkIcon, FlameIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
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
  type Deployment,
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

/**
 * Burn: an airdrop to the dead address (MASTER_PLAN, Contracts: burn). It mints new tokens straight to an
 * address nobody controls, so it uses supply for good. Kept apart from the airdrop and confirmed
 * by typing.
 */
export function BurnSection({
  chain,
  deployment,
  remaining,
  onBurned,
}: {
  chain: SupportedChain
  deployment: Deployment
  remaining: number
  onBurned: (record: AirdropRecord) => void
}) {
  const id = useId()
  const [quantity, setQuantity] = useState('1')
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const amount = Number(quantity)
  const error =
    !/^\d+$/.test(quantity) || amount < 1
      ? 'Enter a whole number of 1 or more.'
      : amount > remaining
        ? `Only ${count(remaining)} tokens are left to mint.`
        : null
  const fee = error ? '0' : mulWei(deployment.fees.airdropFeePerTokenWei, amount)
  const phrase = `burn ${amount}`
  const confirmed = typed.trim().toLowerCase() === phrase

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="border-destructive/40 bg-destructive-soft/40 grid gap-5 rounded-xl border p-5 lg:grid-cols-[1fr_auto] lg:items-end lg:p-6"
    >
      <div className="grid gap-4">
        <div className="space-y-1">
          <h2 id={`${id}-heading`} className="text-heading flex items-center gap-2">
            <FlameIcon aria-hidden="true" className="text-destructive-foreground size-4" />
            Burn supply
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Mints tokens straight to the dead address,{' '}
            <span className="numeric">{shortAddress(DEAD_ADDRESS, 6)}</span>, where nobody can ever use them.
            Use it to shrink a drop that will not sell out. It cannot be undone, and it costs the airdrop fee
            per token.
          </p>
        </div>
        <Field data-invalid={!!error} className="max-w-56">
          <FieldLabel htmlFor={`${id}-quantity`}>Tokens to burn</FieldLabel>
          <Input
            id={`${id}-quantity`}
            type="number"
            min={1}
            max={remaining}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            aria-invalid={!!error}
            aria-describedby={`${id}-quantity-help`}
          />
          {error ? (
            <FieldError id={`${id}-quantity-help`}>{error}</FieldError>
          ) : (
            <FieldDescription id={`${id}-quantity-help`}>
              Fee <span className="numeric">{formatNative(fee, chain.nativeSymbol)}</span>
            </FieldDescription>
          )}
        </Field>
      </div>
      <Button
        variant="destructive"
        disabled={!!error}
        onClick={() => {
          setTyped('')
          setOpen(true)
        }}
      >
        Burn tokens
      </Button>

      <TransactionDialog
        open={open}
        onOpenChange={setOpen}
        chain={chain}
        destructive
        title={`Burn ${count(amount)} ${amount === 1 ? 'token' : 'tokens'}`}
        description="The tokens are minted to the dead address and counted against supply for good. This cannot be undone."
        actionLabel="Burn tokens"
        successMessage={`${count(amount)} ${amount === 1 ? 'token' : 'tokens'} burned`}
        request={
          error || !confirmed
            ? null
            : {
                contract: 'Collection',
                functionName: 'airdropNFTs',
                args: [
                  { name: 'recipients', value: `[${shortAddress(DEAD_ADDRESS, 6)}]` },
                  { name: 'amounts', value: `[${amount}]` },
                ],
                valueWei: fee,
                check: () => (amount > remaining ? 'ExceedsMaxSupply' : null),
              }
        }
        onConfirmed={(hash: Hex) =>
          onBurned({ txHash: hash, at: 0, recipients: 1, tokens: amount, feePaidWei: fee, burn: true })
        }
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
    </section>
  )
}
