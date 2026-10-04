'use client'

import { DownloadIcon, FlameIcon, SendIcon } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Switch } from '@cobweb/ui/components/switch'
import type { Tables } from '@/lib/database.types'
import {
  DEAD_ADDRESS,
  formatNative,
  mulWei,
  shortAddress,
  type AirdropRecord,
  type Deployment,
  type Hex,
  type SupportedChain,
  sampleSupply,
  DEMO_COLLECTION,
  // Seam: the launch chains come from `packages/shared` chain config in Phase 5.
  SUPPORTED_CHAINS,
} from '@/lib/demo'
import {
  AirdropHistory,
  airdropHistoryCsv,
  BurnDialog,
  burnError,
  BurnQuantity,
  SupplyNote,
} from './airdrop-parts'
import { Row } from './bits'
import { count, downloadText } from './format'
import { parseRecipients, type ParseOptions, type Recipient } from './recipients'
import { ParsePreview, RecipientsInput } from './recipients-input'
import { SAMPLE } from './simulate'
import { TransactionDialog } from './transaction-dialog'

export type AirdropScreenProps = {
  collection: Tables<'collections'>
  deployment: Deployment
  chain: SupportedChain
  /** Past airdrops; `burn` marks one to the dead address (MASTER_PLAN, Contracts: burn). */
  airdrops: AirdropRecord[]
  totalMinted: number
}

/** Recipients per `airdropNFTs` transaction. The contract loops over them, so lists are split. */
const BATCH_SIZE = 500

const PARSE: ParseOptions = { defaultAmount: 1, maxAmount: 1000, onDuplicate: 'sum', amountName: 'quantity' }
const TEMPLATE = {
  fileName: 'airdrop-template.csv',
  text: 'address,quantity\n0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291,2\n0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0,1\n',
}

/** A list being sent: frozen once the first batch goes, so every batch matches the quote. */
type Job = { batches: Recipient[][]; sent: number; failure: string | null }

/**
 * Manage drop, airdrop: send tokens to a list of wallets for the airdrop fee or, with "Burn instead
 * of sending" on, burn a quantity by airdrop to the dead address; and the history of both.
 */
export function AirdropScreen({
  deployment,
  airdrops: initialAirdrops,
  totalMinted,
  collection,
  chain,
}: AirdropScreenProps) {
  const [text, setText] = useState('')
  const deferred = useDeferredValue(text)
  const result = useMemo(() => parseRecipients(deferred, PARSE), [deferred])
  const [minted, setMinted] = useState(totalMinted)
  const [history, setHistory] = useState(initialAirdrops)
  const [job, setJob] = useState<Job | null>(null)
  const [dialog, setDialog] = useState<{
    batch: Recipient[]
    index: number
    total: number
    key: number
  } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [burn, setBurn] = useState(false)
  const [burnQuantity, setBurnQuantity] = useState('1')
  const [burnDialog, setBurnDialog] = useState<{ key: number; amount: number } | null>(null)
  const [burnOpen, setBurnOpen] = useState(false)

  const symbol = chain.nativeSymbol
  const feePerToken = deployment.fees.airdropFeePerTokenWei
  const remaining = Math.max(0, sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply) - minted)
  const rows = job ? job.batches.flat() : result.rows
  const tokens = rows.reduce((sum, row) => sum + row.amount, 0)
  const batchCount = job ? job.batches.length : Math.ceil(rows.length / BATCH_SIZE)
  const unsentTokens = job
    ? job.batches
        .slice(job.sent)
        .flat()
        .reduce((sum, row) => sum + row.amount, 0)
    : tokens
  const tooMany = unsentTokens > remaining
  const stale = deferred !== text
  const burnInvalid = burnError(burnQuantity, remaining)
  const burnAmount = burnInvalid ? 0 : Number(burnQuantity)
  const burnLabel = `Burn ${count(burnAmount)} ${burnAmount === 1 ? 'token' : 'tokens'}`

  /**
   * A send landed: count its tokens against supply and add it to the history. Ids are sequential,
   * so the batch starts after everything minted so far.
   * Seam: the ids come from the receipt's `Transfer` logs; nothing else can mint in between here.
   */
  function record(entry: Omit<AirdropRecord, 'at' | 'feePaidWei' | 'firstTokenId'>) {
    setHistory((current) => [
      ...current,
      {
        ...entry,
        at: SAMPLE.readAt,
        feePaidWei: mulWei(feePerToken, entry.tokens),
        firstTokenId: minted + 1,
      },
    ])
    setMinted((current) => current + entry.tokens)
  }

  function sendNext() {
    const active =
      job ??
      ({
        batches: Array.from({ length: batchCount }, (_, index) =>
          rows.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE),
        ),
        sent: 0,
        failure: null,
      } satisfies Job)
    if (!job) setJob(active)
    setDialog({
      batch: active.batches[active.sent] ?? [],
      index: active.sent,
      total: active.batches.length,
      key: Date.now(),
    })
    setDialogOpen(true)
  }

  const batchTokens = dialog?.batch.reduce((sum, row) => sum + row.amount, 0) ?? 0

  return (
    <div className="grid gap-10">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel
          title="Recipients"
          description={
            burn
              ? 'How many tokens to burn. They go to the dead address.'
              : 'Who gets tokens, and how many each.'
          }
          bodyClassName="grid gap-5 p-5 lg:p-6"
        >
          <div className="bg-surface-2/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div className="grid gap-0.5">
              <label htmlFor="airdrop-burn" className="flex items-center gap-2 text-sm font-medium">
                <FlameIcon aria-hidden="true" className="text-destructive-foreground size-4" />
                Burn instead of sending
              </label>
              <p id="airdrop-burn-help" className="text-muted-foreground text-[0.8125rem]">
                {job
                  ? 'Finish or stop the airdrop in progress first.'
                  : 'Mints a quantity to the dead address, shrinking what is left to sell.'}
              </p>
            </div>
            <Switch
              id="airdrop-burn"
              checked={burn}
              onCheckedChange={setBurn}
              disabled={!!job}
              aria-describedby="airdrop-burn-help"
            />
          </div>

          {burn ? (
            <BurnQuantity
              quantity={burnQuantity}
              onChange={setBurnQuantity}
              error={burnInvalid}
              remaining={remaining}
            />
          ) : job ? (
            <div className="grid gap-2 text-sm">
              <p>
                Sending to <span className="numeric">{count(rows.length)}</span> wallets in{' '}
                <span className="numeric">{job.batches.length}</span>{' '}
                {job.batches.length === 1 ? 'transaction' : 'transactions'}. The list is locked until every
                batch is sent.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => {
                  // Batches already sent are on chain; keeping them in the list would send them twice.
                  if (job.sent > 0) setText('')
                  setJob(null)
                }}
              >
                {job.sent > 0 ? 'Stop and drop the unsent batches' : 'Edit the list'}
              </Button>
            </div>
          ) : (
            <>
              <RecipientsInput
                text={text}
                onTextChange={setText}
                options={PARSE}
                template={TEMPLATE}
                snapshot={{ chains: SUPPORTED_CHAINS, chainId: chain.id }}
              />
              <ParsePreview result={result} amountName="tokens" />
            </>
          )}
        </Panel>

        <aside
          aria-label="Quote"
          className="bg-card shadow-raised grid gap-4 rounded-xl border p-5 lg:sticky lg:top-6"
        >
          <h2 className="text-heading">Quote</h2>
          {burn ? (
            <>
              <p className="text-sm">
                {burnLabel} to <span className="numeric">{shortAddress(DEAD_ADDRESS, 6)}</span>
              </p>
              <dl className="divide-y">
                <Row label="Tokens">{count(burnAmount)}</Row>
                <Row label="Fee per token">{formatNative(feePerToken, symbol)}</Row>
                <Row label="Transactions">1</Row>
                <Row label="Total fee" strong>
                  {formatNative(mulWei(feePerToken, burnAmount), symbol)}
                </Row>
              </dl>
              <SupplyNote remaining={remaining} after={remaining - burnAmount} label="After the burn" />
              <p className="text-muted-foreground text-[0.8125rem]">
                Burned tokens use collection supply for good. This cannot be undone.
              </p>
              <Button
                variant="destructive"
                disabled={!!burnInvalid}
                onClick={() => {
                  setBurnDialog({ key: Date.now(), amount: burnAmount })
                  setBurnOpen(true)
                }}
              >
                <FlameIcon aria-hidden="true" />
                {burnLabel}
              </Button>
            </>
          ) : (
            <>
              <dl className="divide-y">
                <Row label="Recipients">{count(rows.length)}</Row>
                <Row label="Tokens">{count(tokens)}</Row>
                <Row label="Fee per token">{formatNative(feePerToken, symbol)}</Row>
                <Row label="Transactions">{count(batchCount)}</Row>
                <Row label="Total fee" strong>
                  {formatNative(mulWei(feePerToken, tokens), symbol)}
                </Row>
              </dl>
              <p className="text-muted-foreground text-[0.8125rem]">
                Exact: the fee is a flat {symbol} amount held by the contract, so nothing is added for price
                movement. If Cobweb changes it before you send, the check step shows the new fee.
              </p>
              <SupplyNote
                remaining={remaining}
                after={tooMany ? null : remaining - unsentTokens}
                label="After this airdrop"
              />
              <p className="text-muted-foreground text-[0.8125rem]">
                Airdrops use collection supply but no phase&apos;s allocation, so they can leave the phases
                less to sell.
              </p>
              {job && (
                <ol className="grid gap-1.5" aria-label="Batches">
                  {job.batches.map((items, index) => (
                    <li key={index} className="flex items-center justify-between text-sm">
                      <span>
                        Batch {index + 1}{' '}
                        <span className="numeric text-muted-foreground">({count(items.length)})</span>
                      </span>
                      {index < job.sent ? (
                        <StatusBadge status="done">Sent</StatusBadge>
                      ) : index === job.sent && job.failure ? (
                        <StatusBadge status="error">Failed</StatusBadge>
                      ) : (
                        <StatusBadge status="draft">{index === job.sent ? 'Next' : 'Waiting'}</StatusBadge>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {tooMany && (
                <p role="alert" className="text-destructive-foreground text-sm">
                  {count(unsentTokens)} tokens is more than the {count(remaining)} left. Remove some
                  recipients.
                </p>
              )}
              <Button
                onClick={sendNext}
                disabled={rows.length === 0 || tooMany || stale || (!!job && job.sent >= job.batches.length)}
              >
                <SendIcon aria-hidden="true" />
                {job
                  ? job.failure
                    ? `Retry batch ${job.sent + 1}`
                    : `Send batch ${job.sent + 1} of ${job.batches.length}`
                  : batchCount > 1
                    ? `Send batch 1 of ${batchCount}`
                    : 'Send airdrop'}
              </Button>
            </>
          )}
        </aside>
      </div>

      <Panel
        title="History"
        bodyClassName="p-0 pb-2"
        action={
          <Button
            variant="ghost"
            size="sm"
            disabled={history.length === 0}
            onClick={() => downloadText('airdrop-history.csv', airdropHistoryCsv(history, chain))}
          >
            <DownloadIcon aria-hidden="true" />
            Export CSV
          </Button>
        }
      >
        <AirdropHistory airdrops={history} chain={chain} readAt={SAMPLE.readAt} />
      </Panel>

      {burnDialog && (
        <BurnDialog
          key={burnDialog.key}
          open={burnOpen}
          onOpenChange={setBurnOpen}
          chain={chain}
          amount={burnDialog.amount}
          remaining={remaining}
          feePerTokenWei={feePerToken}
          onBurned={(hash: Hex) => {
            record({ txHash: hash, recipients: 1, tokens: burnDialog.amount, burn: true })
            setBurnQuantity('1')
          }}
        />
      )}

      {dialog && (
        <TransactionDialog
          key={dialog.key}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          chain={chain}
          title={dialog.total > 1 ? `Send batch ${dialog.index + 1} of ${dialog.total}` : 'Send airdrop'}
          description={`${count(batchTokens)} tokens to ${count(dialog.batch.length)} wallets. They arrive as soon as the transaction confirms.`}
          actionLabel="Send airdrop"
          successMessage={`${count(batchTokens)} tokens airdropped`}
          request={{
            contract: 'Collection',
            functionName: 'airdropNFTs',
            args: [
              { name: 'recipients', value: `${count(dialog.batch.length)} addresses` },
              {
                name: 'amounts',
                value: `${count(dialog.batch.length)} values, ${count(batchTokens)} in total`,
              },
            ],
            valueWei: mulWei(feePerToken, batchTokens),
            check: () => (batchTokens > remaining ? 'ExceedsMaxSupply' : null),
          }}
          onConfirmed={(hash: Hex) => {
            record({ txHash: hash, recipients: dialog.batch.length, tokens: batchTokens, burn: false })
            const sent = dialog.index + 1
            if (sent >= dialog.total) {
              setJob(null)
              setText('')
            } else setJob((current) => current && { ...current, sent, failure: null })
          }}
          onFailed={(message) => setJob((current) => current && { ...current, failure: message })}
        />
      )}
    </div>
  )
}
