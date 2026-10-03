'use client'

import { LockIcon, LockOpenIcon } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Switch } from '@cobweb/ui/components/switch'
import { cn } from '@cobweb/ui/lib/utils'
import type { Tables } from '@/lib/database.types'
import {
  formatBps,
  formatNative,
  sumWei,
  type Deployment,
  type DropActivity,
  type SupportedChain,
} from '@/lib/demo'
import { AddressLine, Row } from './bits'
import { PayoutDialog, RevealDialog, RoyaltyDialog } from './settings-dialogs'
import { SAMPLE } from './simulate'
import { TransactionDialog } from './transaction-dialog'

export type SettingsScreenProps = {
  collection: Tables<'collections'>
  deployment: Deployment
  chain: SupportedChain
  /** For the withdraw panel: `proceeds.withdrawableWei` and `platformFeesWei`. */
  activity: DropActivity
  /**
   * Whether the real set is rendered. False while the art is deferred and not yet locked and
   * rendered (MASTER_PLAN, Flow: pre-reveal): there is nothing to reveal to, so Reveal is off.
   */
  realArtRendered?: boolean
}

type DialogKey = 'withdraw' | 'payout' | 'royalty' | 'reveal' | 'onBehalf' | 'lock'

/** Manage drop, settings: reveal, withdraw, royalties, payout address, lock transfers, mint on behalf. */
export function SettingsScreen({
  collection,
  deployment,
  chain,
  activity,
  realArtRendered = true,
}: SettingsScreenProps) {
  const [state, setState] = useState({
    withdrawable: activity.proceeds.withdrawableWei,
    withdrawn: activity.proceeds.withdrawnWei,
    payout: deployment.payoutAddress,
    royaltyReceiver: deployment.royaltyReceiver,
    royaltyBps: deployment.royaltyBps,
    baseUri: deployment.baseUri,
    revealed: deployment.revealed,
    onBehalf: deployment.mintOnBehalfActive,
    locked: deployment.transfersLocked,
  })
  // One dialog at a time; it stays mounted after closing so a confirming transaction can finish.
  const [dialog, setDialog] = useState<{ key: DialogKey; id: number; at: typeof state } | null>(null)
  const [open, setOpen] = useState(false)
  const show = (key: DialogKey) => {
    // `at` freezes the values the dialog was opened with, so its text does not flip once it lands.
    setDialog({ key, id: Date.now(), at: state })
    setOpen(true)
  }
  const patch = (next: Partial<typeof state>) => setState((current) => ({ ...current, ...next }))
  const symbol = chain.nativeSymbol
  const hasBalance = BigInt(state.withdrawable) > 0n
  const base = { open, onOpenChange: setOpen, chain }

  return (
    <div className="grid gap-10">
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
                  {formatNative(state.withdrawable, symbol)}
                </p>
              </div>
              <Button onClick={() => show('withdraw')} disabled={!hasBalance}>
                Withdraw
              </Button>
            </div>
            <dl className="divide-y border-t">
              <Row label="Withdrawn so far">{formatNative(state.withdrawn, symbol)}</Row>
              <Row label="Platform fees, paid to Cobweb">
                {formatNative(activity.proceeds.platformFeesWei, symbol)}
              </Row>
            </dl>
          </div>
        </Setting>

        <Setting
          title="Payout address"
          description="Where withdrawals are paid. Royalties have their own recipient below."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <AddressLine address={state.payout} chain={chain} full className="max-w-full" />
            <Button variant="secondary" size="sm" onClick={() => show('payout')}>
              Change
            </Button>
          </div>
        </Setting>

        <Setting
          title="Royalties"
          description="Paid on resales by marketplaces that honour ERC-2981 royalties."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <p className="numeric text-2xl">{formatBps(state.royaltyBps)}</p>
              <p className="text-muted-foreground flex flex-wrap items-center gap-1 text-[0.8125rem]">
                to <AddressLine address={state.royaltyReceiver} chain={chain} />
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => show('royalty')}>
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
              {state.revealed ? (
                <StatusBadge status="done">Revealed</StatusBadge>
              ) : (
                <StatusBadge status="draft">Not revealed</StatusBadge>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => show('reveal')}
                disabled={!realArtRendered}
              >
                {state.revealed ? 'Change metadata' : 'Reveal'}
              </Button>
            </div>
            {!realArtRendered && (
              <p className="text-muted-foreground text-[0.8125rem]">
                The real art is not rendered yet. Finish it in Art, then lock and upload it; Reveal opens once
                it is on IPFS.
              </p>
            )}
            <p className="text-muted-foreground text-[0.8125rem]">
              Base URI <span className="numeric text-foreground break-all">{state.baseUri}</span>
            </p>
          </div>
        </Setting>
      </Group>

      <Group title="Minting">
        <Setting
          title="Mint on behalf"
          description="Lets anyone pay to mint for another wallet, using that wallet's limit or quota; the tokens go to that wallet. Useful for card checkouts. Leave it off otherwise."
        >
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="mint-on-behalf" className="text-sm">
              {state.onBehalf ? 'On' : 'Off'}
            </label>
            <Switch
              id="mint-on-behalf"
              aria-label="Mint on behalf"
              checked={state.onBehalf}
              onCheckedChange={() => show('onBehalf')}
            />
          </div>
        </Setting>
      </Group>

      <Group title="Transfers">
        <Setting
          title="Lock transfers"
          danger
          description="Makes every token non-transferable until you unlock it. While locked, holders cannot send or sell, and marketplaces cannot list or trade the collection. Mints and airdrops still work."
        >
          {chain.transferLock ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {state.locked ? (
                <Badge variant="destructive">
                  <LockIcon aria-hidden="true" />
                  Locked
                </Badge>
              ) : (
                <StatusBadge status="draft">Transferable</StatusBadge>
              )}
              <Button
                variant={state.locked ? 'secondary' : 'destructive'}
                size="sm"
                onClick={() => show('lock')}
              >
                {state.locked ? <LockOpenIcon aria-hidden="true" /> : <LockIcon aria-hidden="true" />}
                {state.locked ? 'Unlock transfers' : 'Lock transfers'}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {chain.name} has no transfer validator, so transfers cannot be locked there.
            </p>
          )}
        </Setting>
      </Group>

      {dialog?.key === 'withdraw' && (
        <TransactionDialog
          key={dialog.id}
          {...base}
          title="Withdraw proceeds"
          description="The whole balance goes to the payout address in one transaction."
          actionLabel="Withdraw"
          successMessage="Proceeds withdrawn"
          request={{ contract: 'Collection', functionName: 'withdrawMintFunds', args: [] }}
          onConfirmed={() =>
            setState((current) => ({
              ...current,
              withdrawn: sumWei(current.withdrawn, current.withdrawable),
              withdrawable: '0',
            }))
          }
        >
          <dl className="divide-y rounded-lg border px-4">
            <Row label="Amount" strong>
              {formatNative(dialog.at.withdrawable, symbol)}
            </Row>
            <Row label="To">
              <span className="break-all">{dialog.at.payout}</span>
            </Row>
          </dl>
        </TransactionDialog>
      )}
      {dialog?.key === 'payout' && (
        <PayoutDialog
          key={dialog.id}
          {...base}
          current={state.payout}
          onApply={(payout) => patch({ payout })}
        />
      )}
      {dialog?.key === 'royalty' && (
        <RoyaltyDialog
          key={dialog.id}
          {...base}
          receiver={state.royaltyReceiver}
          bps={state.royaltyBps}
          onApply={(royaltyReceiver, royaltyBps) => patch({ royaltyReceiver, royaltyBps })}
        />
      )}
      {dialog?.key === 'reveal' && (
        <RevealDialog
          key={dialog.id}
          {...base}
          currentUri={state.baseUri}
          metadataCid={SAMPLE.metadataCid}
          singleAsset={collection.project_type === 'single_asset'}
          onApply={(baseUri) => patch({ baseUri, revealed: true })}
        />
      )}
      {dialog?.key === 'onBehalf' && (
        <TransactionDialog
          key={dialog.id}
          {...base}
          title={dialog.at.onBehalf ? 'Turn off mint on behalf' : 'Turn on mint on behalf'}
          description={
            dialog.at.onBehalf
              ? 'Only wallets minting for themselves (or through a delegation) can mint.'
              : "Anyone can pay to mint for any wallet, which uses up that wallet's limit or quota. The wallet receives the tokens."
          }
          actionLabel={dialog.at.onBehalf ? 'Turn off' : 'Turn on'}
          successMessage={dialog.at.onBehalf ? 'Mint on behalf is off' : 'Mint on behalf is on'}
          request={{
            contract: 'Collection',
            functionName: 'setMintOnBehalfStatus',
            args: [{ name: 'status', value: String(!dialog.at.onBehalf) }],
          }}
          onConfirmed={() => patch({ onBehalf: !dialog.at.onBehalf })}
        />
      )}
      {dialog?.key === 'lock' && (
        <TransactionDialog
          key={dialog.id}
          {...base}
          destructive={!dialog.at.locked}
          title={dialog.at.locked ? 'Unlock transfers' : 'Lock transfers'}
          description={
            dialog.at.locked
              ? 'Holders can send and sell again, and marketplaces can list the collection.'
              : 'From the moment this confirms, nobody can send, sell or list these tokens until you unlock them. Open listings stop working.'
          }
          actionLabel={dialog.at.locked ? 'Unlock' : 'Lock transfers'}
          successMessage={dialog.at.locked ? 'Transfers unlocked' : 'Transfers locked'}
          request={{
            // SEAM: the validator's exact function and level per chain are confirmed in Phase 1 (MASTER_PLAN, Contracts: lock).
            contract: 'Transfer validator',
            functionName: 'setTransferSecurityLevelOfCollection',
            args: [
              { name: 'collection', value: deployment.contractAddress },
              { name: 'level', value: dialog.at.locked ? 'Default' : 'Non-transferable' },
            ],
          }}
          onConfirmed={() => patch({ locked: !dialog.at.locked })}
        />
      )}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-3">
      <h2 className="text-muted-foreground text-sm font-medium">{title}</h2>
      <div className="bg-card shadow-raised divide-y rounded-xl border">{children}</div>
    </section>
  )
}

/** One setting: what it is on the left, its state and one action on the right. */
function Setting({
  title,
  description,
  danger,
  children,
}: {
  title: string
  description: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'grid gap-4 p-5 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:gap-10 lg:p-6',
        danger && 'bg-destructive-soft/30 rounded-xl',
      )}
    >
      <div className="space-y-1">
        <h3 className={cn('text-heading', danger && 'text-destructive-foreground')}>{title}</h3>
        <p className="text-muted-foreground text-[0.8125rem] leading-relaxed">{description}</p>
      </div>
      <div className="min-w-0 self-center">{children}</div>
    </div>
  )
}
