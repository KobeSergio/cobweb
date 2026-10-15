'use client'

import { DownloadIcon, FlameIcon, RefreshCwIcon, SendIcon, TriangleAlertIcon, UserXIcon } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Address, Hex } from 'viem'
import { useConfig } from 'wagmi'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import { Panel } from '@cobweb/ui/components/panel'
import { Spinner } from '@cobweb/ui/components/spinner'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Switch } from '@cobweb/ui/components/switch'
import { browserStore } from '@/components/deploy/deploy-machine'
import { useChainClock } from '@/components/mint/use-chain-clock'
import { NOT_OWNER, THROWN, type ActionResult } from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import type { Tables } from '@/lib/database.types'
import { formatNative, mulWei, shortAddress } from '@/lib/demo'
import type { AirdropJob, AirdropView, BatchEntry } from '@/lib/manage/airdrop-types'
import { AIRDROP_MAX_PER_ADDRESS, batchesOf, BURN_ADDRESS, tokensOf } from '@/lib/manage/airdrop-view'
import type { ManageCall } from '@/lib/manage/phase-calls'
import { batchRequest, PendingBatchPanel, tokensLabel, walletsLabel } from './airdrop-dialogs'
import { burnJob, frozenJob, unsentTokens, withConfirmed, withPending } from './airdrop-job'
import {
  AirdropHistory,
  airdropHistoryCsv,
  BurnDialog,
  burnError,
  BurnQuantity,
  SupplyNote,
} from './airdrop-parts'
import { airdropServer, type AirdropServer } from './airdrop-server'
import { sampleAirdropJob, sampleAirdropServer } from './airdrop-sim'
import { Row } from './bits'
import { count, downloadText, relativeTo } from './format'
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
import { airdropJob, forgetAirdropJob, rememberAirdropJob } from './manage-machine'
import { sampleManageActions, samplePhasesView } from './manage-sim'
import { UNREADABLE_REASON } from './phase-row'
import { parseRecipients, type ParseOptions } from './recipients'
import { ParsePreview, RecipientsInput } from './recipients-input'
import { snapshotSource } from './snapshot-source'
import { TransactionDialog } from './transaction-dialog'

export type AirdropScreenProps = {
  collection: Tables<'collections'>
  /** The contract's fee, supply and owner with Cobweb's records, read on the server (or the record alone, or the sample). */
  view: AirdropView
  /** The sign-in wallet: every batch is sent from it, and the owner check compares it with the contract's owner. */
  wallet: Address
  sample: boolean
  /** Sample mode only (`?batch=pending`): a batch waiting to be confirmed. */
  samplePending?: boolean
  /** The chains the holder snapshot can read (the server's `snapshotChains()`, every sample chain in sample mode). */
  snapshotChainIds: number[]
}

const PARSE: ParseOptions = {
  defaultAmount: 1,
  maxAmount: AIRDROP_MAX_PER_ADDRESS,
  onDuplicate: 'sum',
  amountName: 'quantity',
}
const TEMPLATE = {
  fileName: 'airdrop-template.csv',
  text: 'address,quantity\n0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291,2\n0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0,1\n',
}
const PENDING_REASON = 'Confirm or discard the waiting transaction first.'
const DISCARDED = 'Discarded before it was confirmed.'

/** A server answer, or "Try again" when the action itself threw. */
async function settled<T>(call: Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call
  } catch {
    return { ok: false, error: THROWN }
  }
}

/**
 * Manage drop, Airdrop (docs/specs/2026-10-15-airdrop-settings.md, section 7.3): send tokens to a list of wallets
 * for the contract's airdrop fee or, with "Burn instead of sending" on, burn a quantity by airdrop to the dead
 * address; and History, Cobweb's record of the batches it confirmed. The list freezes into batches of at most 500
 * wallets and 1,000 tokens at the first send, and the job is kept in this browser until every batch is confirmed.
 * Each batch runs the manage machine from the sign-in wallet and answers the fresh view. Sample mode runs the same
 * code on the sample actions and server.
 */
export function AirdropScreen({
  collection,
  view: initial,
  wallet,
  sample,
  samplePending = false,
  snapshotChainIds,
}: AirdropScreenProps) {
  const config = useConfig()
  const [view, setView] = useState(initial)
  const viewRef = useRef(view)
  viewRef.current = view
  const [text, setText] = useState('')
  const deferred = useDeferredValue(text)
  const result = useMemo(() => parseRecipients(deferred, PARSE), [deferred])
  const [job, setJob] = useState<AirdropJob | null>(null)
  // The job as the last change left it, so the machine's forget and the confirm in one run see each other.
  const jobRef = useRef<AirdropJob | null>(null)
  /** The current batch's failure in this visit, until a batch is confirmed. */
  const [failure, setFailure] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  // The dialogs stay mounted after they close, so a batch still confirming can finish.
  const [dialog, setDialog] = useState<{
    entries: BatchEntry[]
    index: number
    total: number
    fee: string
    key: number
  } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [burn, setBurn] = useState(false)
  const [burnQuantity, setBurnQuantity] = useState('1')
  const [burnDialog, setBurnDialog] = useState<{
    key: number
    amount: number
    fee: string
    /** Its burn confirmed: the next burn gets a dialog of its own. */
    done?: boolean
  } | null>(null)
  const [burnOpen, setBurnOpen] = useState(false)
  // Whether the burn dialog is on screen when a run ends: a failure that reaches a closed dialog is toasted.
  const burnShown = useRef(false)
  burnShown.current = burnOpen
  // Runs in flight in the two dialogs, on screen or closed (`onRunningChange`): until each has ended, nothing is
  // sent and neither the list nor the burn switch changes, so a run still waiting on the wallet can neither send
  // its batch twice nor lose its hash.
  const [runs, setRuns] = useState(0)
  // Sample mode: what the simulated wallet sent, by hash, so the sample server applies exactly that call.
  const [sampleSent] = useState(() => new Map<Hex, ManageCall>())
  const chain = chainView(view.chainId)
  const now = useChainClock(view.blockTimestamp)
  const reachable = view.chainReachable
  const maxSupply = collection.max_supply

  const server = useMemo<AirdropServer>(
    () => (sample ? sampleAirdropServer(() => viewRef.current, sampleSent) : airdropServer(collection.id)),
    [sample, sampleSent, collection.id],
  )
  const target = useMemo<ManageTarget>(
    () => ({
      actions: sample
        ? sampleManageActions(
            () => ({
              ...samplePhasesView({ max_supply: maxSupply }),
              maxSupply: viewRef.current.maxSupply,
              totalMinted: viewRef.current.totalMinted ?? 0,
            }),
            sampleSent,
          )
        : realManageActions(config, { chainId: view.chainId, contract: view.contract, wallet }),
      chainId: view.chainId,
      wallet,
    }),
    [sample, sampleSent, maxSupply, config, view.chainId, view.contract, wallet],
  )
  const snapshot = useMemo(
    () =>
      snapshotSource({
        collectionId: collection.id,
        sample,
        chainIds: snapshotChainIds,
        preferred: view.chainId,
      }),
    [collection.id, sample, snapshotChainIds, view.chainId],
  )

  // A job from before a reload: its unsent batches stay frozen, and a pending hash is checked, never sent again.
  useEffect(() => {
    const stored = sample
      ? samplePending
        ? sampleAirdropJob()
        : null
      : airdropJob(browserStore(), collection.id)
    jobRef.current = stored
    setJob(stored)
  }, [sample, samplePending, collection.id])

  /** The job in progress, in state and, outside sample mode, in the browser's store. */
  function commit(next: AirdropJob | null) {
    jobRef.current = next
    setJob(next)
    if (sample) return
    if (next) rememberAirdropJob(browserStore(), collection.id, next)
    else forgetAirdropJob(browserStore(), collection.id)
  }

  /**
   * What the runs of one batch write, `batch` being its entries in the job: its sent hash, kept until the server
   * confirms it or forgotten; its failure; and, once it is confirmed, the job moved on (`withConfirmed`; after the
   * last batch the job and the text go). Each applies only while the job still waits on that batch. The dialog,
   * closed mid-run, and "Check again" can both confirm one hash: the second finds the job past its batch and writes
   * nothing, so it never marks the next batch sent or clears the next batch's hash.
   */
  function batchWrites(batch: BatchEntry[] | undefined) {
    const waiting = () => {
      const current = jobRef.current
      return current && batch && current.batches[current.sent] === batch ? current : null
    }
    return {
      remember: (hash: Hex) => {
        const current = waiting()
        if (current) commit(withPending(current, hash))
      },
      forget: () => {
        const current = waiting()
        if (current) commit(withPending(current, null))
      },
      failed: (message: string) => {
        if (waiting()) setFailure(message)
      },
      confirmed: () => {
        const current = waiting()
        if (!current) return
        setFailure(null)
        const after = withConfirmed(current)
        commit(after)
        // After the last batch the list goes too: its batches are on chain, and keeping them would send them twice.
        if (!after) setText('')
      },
    }
  }

  /**
   * A burn's writes: its job starts with its hash and goes with it (`burnJob`, `withPending`), and only its own run
   * ends it. A burn whose run outlived it (discarded, then confirmed late) never ends the next burn or touches an
   * airdrop's job, and a hash that comes back while another job exists stays with its run.
   */
  function burnWrites(amount: number) {
    // A burn waiting while its dialog is open is the dialog's own, checked again from its failure.
    let mine = job?.kind === 'burn' ? job.batches[0] : undefined
    return {
      remember: (hash: Hex) => {
        if (jobRef.current) return
        const next = burnJob(amount, hash)
        mine = next.batches[0]
        commit(next)
      },
      forget: () => batchWrites(mine).forget(),
    }
  }

  /** A burn confirmed: its job went with its hash, so only the quantity starts again. */
  function burned() {
    setBurnQuantity('1')
  }

  /** A dialog's run started (true) or ended (false), told even after the dialog closed or unmounted. */
  function runChanged(running: boolean) {
    setRuns((current) => current + (running ? 1 : -1))
  }

  async function readAgain() {
    setReading(true)
    const answer = await settled(server.read())
    setReading(false)
    if (answer.ok) setView(answer.data)
    else toast.error(answer.error)
  }

  const symbol = chain.nativeSymbol
  const fee = view.feePerTokenWei
  const left = view.left
  const owner = view.owner
  const blocked = owner !== null && owner.toLowerCase() !== wallet.toLowerCase() ? NOT_OWNER(owner) : null
  const inFlight = runs > 0
  // The first reason that applies: the chain unread, then the owner check (the dialogs open, their action off),
  // then a hash waiting to be confirmed or a dialog's run in flight, which may still send.
  const off = !reachable ? UNREADABLE_REASON : !blocked && (job?.pending || inFlight) ? PENDING_REASON : null
  const sending = job?.kind === 'airdrop' ? job : null
  const rows = sending ? sending.batches.flat() : result.rows
  const tokens = tokensOf(rows)
  const batches = sending ? sending.batches : batchesOf(rows)
  const unsent = sending ? unsentTokens(sending) : tokens
  const tooMany = left !== null && unsent > left
  const stale = deferred !== text
  const burnInvalid = left === null ? null : burnError(burnQuantity, left)
  const burnAmount = burnInvalid || left === null ? 0 : Number(burnQuantity)
  const burnLabel = `Burn ${tokensLabel(burnAmount)}`

  /**
   * "Send airdrop" or "Send batch": freezes the list at the first send (not under the owner check) and opens batch
   * `sent`. A batch whose dialog exists opens that dialog again, with the fee as read now: closed before the wallet
   * answered, its run may still send, so a batch never gets a second dialog.
   */
  function sendNext() {
    if (fee === null) return
    let active = sending
    if (!active) {
      active = frozenJob(result.rows)
      // A failure belongs to the batch it happened to: a new list starts without one.
      setFailure(null)
      if (!blocked) commit(active)
    }
    const entries = active.batches[active.sent] ?? []
    setDialog(
      dialog?.entries === entries
        ? { ...dialog, fee }
        : { entries, index: active.sent, total: active.batches.length, fee, key: Date.now() },
    )
    setDialogOpen(true)
  }

  const dialogTokens = dialog ? tokensOf(dialog.entries) : 0
  // The writes of the batch waiting on its hash (the panel's runs) and of the batch the dialog was opened on (its runs).
  const waitingWrites = job ? batchWrites(job.batches[job.sent]) : null
  const dialogWrites = dialog ? batchWrites(dialog.entries) : null
  // The dialogs follow the screen's order: the owner check, then a hash waiting, which no dialog sends past.
  const dialogBlocked = blocked ?? (job?.pending ? PENDING_REASON : null)

  return (
    <ManageActionsProvider value={target}>
      <div className="grid gap-10">
        <div className="grid gap-4">
          {reachable ? (
            <div className="text-muted-foreground -mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span>Read from the chain {relativeTo(view.readAt, now)}</span>
              <Button variant="ghost" size="sm" onClick={() => void readAgain()} disabled={reading}>
                {reading ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
                Read again
              </Button>
            </div>
          ) : (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>The contract could not be read</AlertTitle>
              <AlertDescription>
                <p>
                  The history below is Cobweb&apos;s record of the batches it confirmed. The fee and the
                  tokens left to mint are not shown, and sending waits until the contract can be read.
                </p>
                <Button variant="secondary" size="sm" onClick={() => void readAgain()} disabled={reading}>
                  {reading ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
                  Read again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {blocked && owner && (
            <Alert>
              <UserXIcon aria-hidden="true" />
              <AlertTitle>This wallet is not the contract&apos;s owner</AlertTitle>
              <AlertDescription>
                <p>
                  Changes on chain need <span className="numeric break-all">{owner}</span>.
                </p>
              </AlertDescription>
            </Alert>
          )}
          {job?.pending && waitingWrites && !dialogOpen && !burnOpen && (
            <PendingBatchPanel
              job={job}
              chain={chain}
              server={server}
              onView={setView}
              onConfirmed={job.kind === 'burn' ? burned : waitingWrites.confirmed}
              onForget={waitingWrites.forget}
              onDiscard={() => {
                waitingWrites.forget()
                // Only a batch is marked failed: a burn's job went with its hash.
                if (job.kind === 'airdrop') setFailure(DISCARDED)
              }}
            />
          )}
        </div>

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
                  {job?.kind === 'burn'
                    ? 'Confirm or discard the waiting burn first.'
                    : job
                      ? 'Finish or stop the airdrop in progress first.'
                      : inFlight
                        ? PENDING_REASON
                        : 'Mints a quantity to the dead address, shrinking what is left to sell.'}
                </p>
              </div>
              <Switch
                id="airdrop-burn"
                checked={burn}
                onCheckedChange={setBurn}
                disabled={!!job || inFlight}
                aria-describedby="airdrop-burn-help"
              />
            </div>

            {burn ? (
              <BurnQuantity
                quantity={burnQuantity}
                onChange={setBurnQuantity}
                error={burnInvalid}
                remaining={left}
              />
            ) : sending ? (
              <div className="grid gap-2 text-sm">
                <p>
                  Sending to <span className="numeric">{count(rows.length)}</span> wallets in{' '}
                  <span className="numeric">{count(sending.batches.length)}</span>{' '}
                  {sending.batches.length === 1 ? 'transaction' : 'transactions'}. The list is locked until
                  every batch is sent.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  disabled={!!sending.pending || inFlight}
                  title={sending.pending || inFlight ? PENDING_REASON : undefined}
                  onClick={() => {
                    // Batches already sent are on chain; keeping them in the list would send them twice.
                    if (sending.sent > 0) setText('')
                    commit(null)
                    setFailure(null)
                  }}
                >
                  {sending.sent > 0 ? 'Stop and drop the unsent batches' : 'Edit the list'}
                </Button>
              </div>
            ) : (
              <>
                <RecipientsInput
                  text={text}
                  onTextChange={setText}
                  options={PARSE}
                  template={TEMPLATE}
                  snapshot={snapshot}
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
                  {burnLabel} to <span className="numeric">{shortAddress(BURN_ADDRESS, 6)}</span>
                </p>
                <dl className="divide-y">
                  <Row label="Tokens">{count(burnAmount)}</Row>
                  <Row label="Fee per token">{fee === null ? 'Not read' : formatNative(fee, symbol)}</Row>
                  <Row label="Transactions">1</Row>
                  <Row label="Total fee" strong>
                    {fee === null ? 'Not read' : formatNative(mulWei(fee, burnAmount), symbol)}
                  </Row>
                </dl>
                <SupplyNote
                  remaining={left}
                  after={left === null ? null : left - burnAmount}
                  label="After the burn"
                />
                <p className="text-muted-foreground text-[0.8125rem]">
                  Burned tokens use collection supply for good. This cannot be undone.
                </p>
                <Button
                  variant="destructive"
                  disabled={!!burnInvalid || !!off || fee === null || left === null}
                  title={off ?? undefined}
                  onClick={() => {
                    if (fee === null) return
                    // The same burn opens its dialog again until it is confirmed: closed before the wallet
                    // answered, its run may still send, so a burn never gets a second dialog.
                    setBurnDialog(
                      burnDialog && !burnDialog.done && burnDialog.amount === burnAmount
                        ? { ...burnDialog, fee }
                        : { key: Date.now(), amount: burnAmount, fee },
                    )
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
                  <Row label="Fee per token">{fee === null ? 'Not read' : formatNative(fee, symbol)}</Row>
                  <Row label="Transactions">{count(batches.length)}</Row>
                  <Row label="Total fee" strong>
                    {fee === null ? 'Not read' : formatNative(mulWei(fee, tokens), symbol)}
                  </Row>
                </dl>
                <p className="text-muted-foreground text-[0.8125rem]">
                  Exact: the fee is a flat {symbol} amount held by the contract, so nothing is added for price
                  movement. If Cobweb changes it before you send, the check step shows the new fee.
                </p>
                <p className="text-muted-foreground text-[0.8125rem]">
                  Up to 500 wallets and 1,000 tokens go in each transaction.
                </p>
                <SupplyNote
                  remaining={left}
                  after={left === null || tooMany ? null : left - unsent}
                  label="After this airdrop"
                />
                <p className="text-muted-foreground text-[0.8125rem]">
                  Airdrops use collection supply but no phase&apos;s allocation, so they can leave the phases
                  less to sell.
                </p>
                {sending && (
                  <ol className="grid gap-1.5" aria-label="Batches">
                    {sending.batches.map((items, index) => {
                      const current = index === sending.sent
                      return (
                        <li key={index} className="grid gap-0.5 text-sm">
                          <div className="flex items-center justify-between">
                            <span>
                              Batch {index + 1}{' '}
                              <span className="numeric text-muted-foreground">({count(items.length)})</span>
                            </span>
                            {index < sending.sent ? (
                              <StatusBadge status="done">Sent</StatusBadge>
                            ) : current && sending.pending ? (
                              <StatusBadge status="pending">Confirming</StatusBadge>
                            ) : current && failure ? (
                              <StatusBadge status="error">Failed</StatusBadge>
                            ) : (
                              <StatusBadge status="draft">{current ? 'Next' : 'Waiting'}</StatusBadge>
                            )}
                          </div>
                          {current && !sending.pending && failure && (
                            <p className="text-destructive-foreground text-[0.8125rem]">{failure}</p>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                )}
                {tooMany && left !== null && (
                  <p role="alert" className="text-destructive-foreground text-sm">
                    {count(unsent)} tokens is more than the {count(left)} left. Remove some recipients.
                  </p>
                )}
                <Button
                  onClick={sendNext}
                  disabled={rows.length === 0 || tooMany || stale || !!off || fee === null}
                  title={off ?? undefined}
                >
                  <SendIcon aria-hidden="true" />
                  {sending
                    ? failure
                      ? `Retry batch ${sending.sent + 1}`
                      : `Send batch ${sending.sent + 1} of ${sending.batches.length}`
                    : batches.length > 1
                      ? `Send batch 1 of ${batches.length}`
                      : 'Send airdrop'}
                </Button>
              </>
            )}
          </aside>
        </div>

        <Panel
          title="History"
          description="Batches Cobweb confirmed. Airdrops sent from outside Cobweb are not listed."
          bodyClassName="p-0 pb-2"
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={view.history.length === 0}
              onClick={() => downloadText('airdrop-history.csv', airdropHistoryCsv(view.history, chain))}
            >
              <DownloadIcon aria-hidden="true" />
              Export CSV
            </Button>
          }
        >
          <AirdropHistory airdrops={view.history} chain={chain} readAt={view.readAt} />
        </Panel>

        {burnDialog && left !== null && (
          <BurnDialog
            key={burnDialog.key}
            open={burnOpen}
            onOpenChange={setBurnOpen}
            chain={chain}
            amount={burnDialog.amount}
            remaining={left}
            feePerTokenWei={burnDialog.fee}
            blocked={dialogBlocked}
            confirm={(hash) => server.confirm(hash)}
            pending={burnWrites(burnDialog.amount)}
            onBurned={(next) => {
              setView(next)
              burned()
              setBurnDialog((current) => current && { ...current, done: true })
            }}
            onFailed={(message) => {
              // The dialog on screen shows its own failure; one closed since says it in a toast.
              if (!burnShown.current) toast.error(message)
            }}
            onRunningChange={runChanged}
          />
        )}

        {dialog && dialogWrites && (
          <TransactionDialog
            key={dialog.key}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            chain={chain}
            blocked={dialogBlocked}
            title={dialog.total > 1 ? `Send batch ${dialog.index + 1} of ${dialog.total}` : 'Send airdrop'}
            description={`${tokensLabel(dialogTokens)} to ${walletsLabel(dialog.entries.length)}. ${dialogTokens === 1 ? 'It arrives' : 'They arrive'} as soon as the transaction confirms.`}
            actionLabel="Send airdrop"
            successMessage={`${tokensLabel(dialogTokens)} airdropped`}
            request={batchRequest(
              dialog.entries,
              dialog.fee,
              chain,
              (hash) => server.confirm(hash),
              dialogWrites,
            )}
            onConfirmed={(next) => {
              setView(next)
              dialogWrites.confirmed()
            }}
            onFailed={dialogWrites.failed}
            onRunningChange={runChanged}
          />
        )}
      </div>
    </ManageActionsProvider>
  )
}
