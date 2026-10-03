'use client'

import { SendIcon } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import type { Tables } from '@/lib/database.types'
import {
  formatNative,
  mulWei,
  type AirdropRecord,
  type Deployment,
  type Hex,
  type SupportedChain,
} from '@/lib/demo'
import { AirdropHistory, BurnSection } from './airdrop-parts'
import { Row } from './bits'
import { count } from './format'
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

/** Manage drop, airdrop: send tokens to a list of wallets for the airdrop fee, burn by airdrop to the dead address, and history. */
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

  const symbol = chain.nativeSymbol
  const feePerToken = deployment.fees.airdropFeePerTokenWei
  const remaining = Math.max(0, collection.max_supply - minted)
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

  /** A send landed: count its tokens against supply and add it to the history. */
  function record(entry: Omit<AirdropRecord, 'at' | 'feePaidWei'>) {
    setMinted((current) => current + entry.tokens)
    setHistory((current) => [
      ...current,
      { ...entry, at: SAMPLE.readAt, feePaidWei: mulWei(feePerToken, entry.tokens) },
    ])
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
          description="Who gets tokens, and how many each."
          bodyClassName="grid gap-5 p-5 lg:p-6"
        >
          {job ? (
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
              <RecipientsInput text={text} onTextChange={setText} options={PARSE} template={TEMPLATE} />
              <ParsePreview result={result} amountName="tokens" />
            </>
          )}
        </Panel>

        <aside
          aria-label="Quote"
          className="bg-card shadow-raised grid gap-4 rounded-xl border p-5 lg:sticky lg:top-6"
        >
          <h2 className="text-heading">Quote</h2>
          <dl className="divide-y">
            <Row label="Recipients">{count(rows.length)}</Row>
            <Row label="Tokens">{count(tokens)}</Row>
            <Row label="Fee per token">{formatNative(feePerToken, symbol)}</Row>
            <Row label="Transactions">{count(batchCount)}</Row>
            <Row label="Total fee" strong>
              {formatNative(mulWei(feePerToken, tokens), symbol)}
            </Row>
          </dl>
          <div className="bg-well shadow-inset rounded-lg px-3 py-2.5 text-[0.8125rem]">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Left to mint</span>
              <span className="numeric">{count(remaining)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">After this airdrop</span>
              <span className={tooMany ? 'numeric text-destructive-foreground' : 'numeric'}>
                {tooMany ? 'Not enough' : count(remaining - unsentTokens)}
              </span>
            </p>
          </div>
          <p className="text-muted-foreground text-[0.8125rem]">
            Airdrops use collection supply but no phase&apos;s allocation, so they can leave the phases less
            to sell.
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
              {count(unsentTokens)} tokens is more than the {count(remaining)} left. Remove some recipients.
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
        </aside>
      </div>

      <Panel title="History" bodyClassName="p-0 pb-2">
        <AirdropHistory airdrops={history} chain={chain} readAt={SAMPLE.readAt} />
      </Panel>

      <BurnSection
        chain={chain}
        deployment={deployment}
        remaining={remaining}
        onBurned={(burned) =>
          record({ txHash: burned.txHash, recipients: 1, tokens: burned.tokens, burn: true })
        }
      />

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
