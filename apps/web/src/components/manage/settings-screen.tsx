'use client'

import { RefreshCwIcon, TriangleAlertIcon, UserXIcon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Address, Hex } from 'viem'
import { useConfig } from 'wagmi'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Switch } from '@cobweb/ui/components/switch'
import { useChainClock } from '@/components/mint/use-chain-clock'
import { NOT_OWNER, THROWN, type ActionResult } from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import type { Tables } from '@/lib/database.types'
import { formatBps, formatNative, formatUtc } from '@/lib/demo'
import { settingsCalls, type ManageCall } from '@/lib/manage/phase-calls'
import type { SettingsView } from '@/lib/manage/settings-types'
import { AddressLine, Row } from './bits'
import { relativeTo } from './format'
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
import { sampleManageActions, samplePhasesView } from './manage-sim'
import { UNREADABLE_REASON } from './phase-row'
import { PayoutDialog, RevealDialog, RoyaltyDialog, settingsRequest } from './settings-dialogs'
import { Setting, SettingsGroup as Group } from './settings-parts'
import { settingsServer, type SettingsServer } from './settings-server'
import { sampleSettingsServer } from './settings-sim'
import { TradabilitySettings } from './tradability'
import { TransactionDialog } from './transaction-dialog'

export type SettingsScreenProps = {
  collection: Tables<'collections'>
  /** The contract's settings and balances read on the server (or the copies, or the sample). */
  view: SettingsView
  /** The sign-in wallet: every change is sent from it, and the owner check compares it with the contract's owner. */
  wallet: Address
  sample: boolean
}

type DialogKey = 'withdraw' | 'payout' | 'royalty' | 'reveal' | 'onBehalf'

/** A server answer, or "Try again" when the action itself threw. */
async function settled<T>(call: Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call
  } catch {
    return { ok: false, error: THROWN }
  }
}

/**
 * Manage drop, Settings (docs/specs/2026-10-15-airdrop-settings.md, section 7.4): Money (withdraw, payout address,
 * royalties), Metadata (reveal), and Advanced at the bottom (the transfer validator, the transfer level, mint on
 * behalf), all read from the contract at one block. Each change runs the manage machine from the sign-in wallet
 * and answers the fresh view, which replaces this one. Sample mode runs the same code on the sample actions and
 * server.
 */
export function SettingsScreen({ collection, view: initial, wallet, sample }: SettingsScreenProps) {
  const config = useConfig()
  const [view, setView] = useState(initial)
  const viewRef = useRef(view)
  viewRef.current = view
  const [reading, setReading] = useState(false)
  // One dialog at a time; it stays mounted after closing so a confirming transaction can finish.
  const [dialog, setDialog] = useState<{ key: DialogKey; id: number; at: SettingsView } | null>(null)
  const [open, setOpen] = useState(false)
  // The id of the dialog on screen, if any: a failure that reaches a closed or replaced dialog is toasted.
  const shownId = useRef<number | null>(null)
  shownId.current = dialog && open ? dialog.id : null
  const failedFor = (id: number | undefined) => (message: string) => {
    if (shownId.current !== id) toast.error(message)
  }
  // By dialog id: the Withdraw dialog with a run in flight, and the one holding a withdrawal it sent that is
  // neither confirmed nor refused yet. While either is the dialog on screen, Withdraw opens it again rather than a
  // new one, as Airdrop's send does: no second withdrawal is sent from here while one is in flight, and one not
  // confirmed in time can still be checked again.
  const [withdrawRunning, setWithdrawRunning] = useState<number | null>(null)
  const [withdrawHeld, setWithdrawHeld] = useState<number | null>(null)
  // Sample mode: what the simulated wallet sent, by hash.
  const [sampleSent] = useState(() => new Map<Hex, ManageCall>())
  const chain = chainView(view.chainId)
  const now = useChainClock(view.blockTimestamp)
  const reachable = view.chainReachable
  const maxSupply = collection.max_supply

  const server = useMemo<SettingsServer>(
    () => (sample ? sampleSettingsServer(() => viewRef.current) : settingsServer(collection.id)),
    [sample, collection.id],
  )
  const target = useMemo<ManageTarget>(
    () => ({
      actions: sample
        ? sampleManageActions(
            () => samplePhasesView({ max_supply: maxSupply }),
            sampleSent,
            () => viewRef.current,
          )
        : realManageActions(config, { chainId: view.chainId, contract: view.contract, wallet }),
      chainId: view.chainId,
      wallet,
    }),
    [sample, sampleSent, maxSupply, config, view.chainId, view.contract, wallet],
  )

  const show = (key: DialogKey) => {
    // `at` freezes the view the dialog was opened with, so its text does not flip once it lands.
    setDialog({ key, id: Date.now(), at: view })
    setOpen(true)
  }

  async function readAgain() {
    setReading(true)
    const answer = await settled(server.read())
    setReading(false)
    if (answer.ok) setView(answer.data)
    else toast.error(answer.error)
  }

  const symbol = chain.nativeSymbol
  const owner = view.owner
  const blocked = owner !== null && owner.toLowerCase() !== wallet.toLowerCase() ? NOT_OWNER(owner) : null
  const off = reachable ? null : UNREADABLE_REASON
  const balance = view.creatorBalanceWei
  const pending = view.pendingBalanceWei
  const confirm = (hash: Hex, call: ManageCall) => server.confirm(hash, call)
  const base = {
    open,
    onOpenChange: setOpen,
    chain,
    blocked,
    confirm,
    onConfirmed: setView,
    onFailed: failedFor(dialog?.id),
  }
  const reopenWithdraw =
    dialog?.key === 'withdraw' && (withdrawRunning === dialog.id || withdrawHeld === dialog.id)
  /** What a Withdraw dialog's runs tell of their hash: held once sent, let go once confirmed or refused for good. */
  const withdrawPending = (id: number) => ({
    remember: () => setWithdrawHeld(id),
    forget: () => setWithdrawHeld((held) => (held === id ? null : held)),
  })

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
                  These are the payout address, royalties, metadata and transfer validator Cobweb last read,
                  on {formatUtc(view.readAt)}. Balances and the transfer level are not shown, and changes on
                  chain wait until it can be read.
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
        </div>

        <Group title="Money">
          <Setting
            title="Withdraw proceeds"
            description="Sends your balance to the payout address. Platform fees are held apart and are not part of it."
          >
            <div className="grid gap-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-muted-foreground text-xs font-medium">Your balance</p>
                  <p className="numeric text-[2rem] leading-tight">
                    {balance === null ? 'Not read' : formatNative(balance, symbol)}
                  </p>
                </div>
                <Button
                  onClick={() => (reopenWithdraw ? setOpen(true) : show('withdraw'))}
                  disabled={!reopenWithdraw && (!!off || balance === null || BigInt(balance) === 0n)}
                  title={reopenWithdraw ? undefined : (off ?? undefined)}
                >
                  Withdraw
                </Button>
              </div>
              <dl className="divide-y border-t">
                <Row label="Withdrawn so far">{formatNative(view.withdrawnWei, symbol)}</Row>
                <Row label="Platform fees, paid to Cobweb">
                  {view.platformBalanceWei === null
                    ? 'Not read'
                    : formatNative(view.platformBalanceWei, symbol)}
                </Row>
                <Row label="Platform fees per token">
                  {view.fees === null
                    ? 'Not read'
                    : `${formatNative(view.fees.mintFeeFlatWei, symbol)} + ${formatBps(view.fees.mintFeeBps)} per mint, ${formatNative(view.fees.airdropFeePerTokenWei, symbol)} per airdrop`}
                </Row>
                {pending !== null && BigInt(pending) > 0n && (
                  <Row label="Refunds held for this wallet">{formatNative(pending, symbol)}</Row>
                )}
              </dl>
              {pending !== null && BigInt(pending) > 0n && (
                <p className="text-muted-foreground text-[0.8125rem]">
                  The contract could not send these back. This wallet can claim them from the contract.
                </p>
              )}
            </div>
          </Setting>

          <Setting
            title="Payout address"
            description="Where withdrawals are paid. Royalties have their own recipient below."
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <AddressLine address={view.payout} chain={chain} full className="max-w-full" />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => show('payout')}
                disabled={!!off}
                title={off ?? undefined}
              >
                Change
              </Button>
            </div>
          </Setting>

          <Setting
            title="Royalties"
            description="Enforced on secondary sales through the transfer validator: a resale goes through only where the royalty is paid to the recipient."
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1">
                <p className="numeric text-2xl">{formatBps(view.royaltyBps)}</p>
                <p className="text-muted-foreground flex flex-wrap items-center gap-1 text-[0.8125rem]">
                  to <AddressLine address={view.royaltyReceiver} chain={chain} />
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => show('royalty')}
                disabled={!!off}
                title={off ?? undefined}
              >
                Edit
              </Button>
            </div>
          </Setting>
        </Group>

        <Group title="Metadata">
          <Setting
            title="Reveal"
            description="Before the reveal every token shows the placeholder. Revealing points the collection at the rendered metadata, so each token shows its own art and traits."
          >
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {view.pointer === 'revealed' ? (
                  <StatusBadge status="done">Revealed</StatusBadge>
                ) : view.pointer === 'placeholder' ? (
                  <StatusBadge status="draft">Placeholder</StatusBadge>
                ) : (
                  <Badge variant="warning">Custom</Badge>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => show('reveal')}
                  disabled={!view.realArtRendered || !!off}
                  title={off ?? undefined}
                >
                  {view.pointer === 'placeholder' ? 'Reveal' : 'Change metadata'}
                </Button>
              </div>
              {!view.realArtRendered && (
                <p className="text-muted-foreground text-[0.8125rem]">
                  The real art is not rendered yet. Finish it in Art, then lock and upload it; Reveal opens
                  once it is on IPFS.
                </p>
              )}
              <p className="text-muted-foreground text-[0.8125rem]">
                Base URI <span className="numeric text-foreground break-all">{view.baseUri}</span>
              </p>
            </div>
          </Setting>
        </Group>

        <Group title="Advanced" id="advanced">
          <TradabilitySettings
            view={view}
            chain={chain}
            off={off}
            blocked={blocked}
            confirm={confirm}
            onConfirmed={setView}
          />
          <Setting
            title="Mint on behalf"
            description="Lets anyone pay to mint for another wallet, using that wallet's limit or quota; the tokens go to that wallet. Useful for card checkouts. Leave it off otherwise."
          >
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="mint-on-behalf" className="text-sm">
                {view.mintOnBehalf ? 'On' : 'Off'}
              </label>
              <Switch
                id="mint-on-behalf"
                aria-label="Mint on behalf"
                checked={view.mintOnBehalf}
                onCheckedChange={() => show('onBehalf')}
                disabled={!!off}
                title={off ?? undefined}
              />
            </div>
          </Setting>
        </Group>

        {dialog?.key === 'withdraw' && (
          <TransactionDialog
            key={dialog.id}
            open={open}
            onOpenChange={(next) => {
              // Closed with no run in flight, the dialog starts over, so the withdrawal it held is not offered.
              if (!next && withdrawRunning !== dialog.id)
                setWithdrawHeld((held) => (held === dialog.id ? null : held))
              setOpen(next)
            }}
            chain={chain}
            blocked={blocked}
            title="Withdraw proceeds"
            description="The whole balance goes to the payout address in one transaction."
            actionLabel="Withdraw"
            successMessage="Proceeds withdrawn"
            request={settingsRequest(settingsCalls.withdraw(), chain, confirm, withdrawPending(dialog.id))}
            onConfirmed={setView}
            onFailed={failedFor(dialog.id)}
            onRunningChange={(running) =>
              setWithdrawRunning((current) => (running ? dialog.id : current === dialog.id ? null : current))
            }
          >
            <dl className="divide-y rounded-lg border px-4">
              <Row label="Amount" strong>
                {formatNative(dialog.at.creatorBalanceWei ?? '0', symbol)}
              </Row>
              <Row label="To">
                <span className="break-all">{dialog.at.payout}</span>
              </Row>
            </dl>
          </TransactionDialog>
        )}
        {dialog?.key === 'payout' && <PayoutDialog key={dialog.id} {...base} current={dialog.at.payout} />}
        {dialog?.key === 'royalty' && (
          <RoyaltyDialog
            key={dialog.id}
            {...base}
            receiver={dialog.at.royaltyReceiver}
            bps={dialog.at.royaltyBps}
          />
        )}
        {dialog?.key === 'reveal' && (
          <RevealDialog
            key={dialog.id}
            {...base}
            current={dialog.at.baseUri}
            targets={dialog.at.targets}
            pointer={dialog.at.pointer}
          />
        )}
        {dialog?.key === 'onBehalf' && (
          <TransactionDialog
            key={dialog.id}
            open={open}
            onOpenChange={setOpen}
            chain={chain}
            blocked={blocked}
            title={dialog.at.mintOnBehalf ? 'Turn off mint on behalf' : 'Turn on mint on behalf'}
            description={
              dialog.at.mintOnBehalf
                ? 'Only wallets minting for themselves (or through a delegation) can mint.'
                : "Anyone can pay to mint for any wallet, which uses up that wallet's limit or quota. The wallet receives the tokens."
            }
            actionLabel={dialog.at.mintOnBehalf ? 'Turn off' : 'Turn on'}
            successMessage={dialog.at.mintOnBehalf ? 'Mint on behalf is off' : 'Mint on behalf is on'}
            request={settingsRequest(settingsCalls.mintOnBehalf(!dialog.at.mintOnBehalf), chain, confirm)}
            onConfirmed={setView}
            onFailed={failedFor(dialog.id)}
          />
        )}
      </div>
    </ManageActionsProvider>
  )
}
