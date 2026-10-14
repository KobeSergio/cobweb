'use client'

import { InfoIcon, LayersIcon, PlusIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Address, Hex } from 'viem'
import { useConfig } from 'wagmi'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Button } from '@cobweb/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import { Panel } from '@cobweb/ui/components/panel'
import { Spinner } from '@cobweb/ui/components/spinner'
import { cn } from '@cobweb/ui/lib/utils'
import { browserStore } from '@/components/deploy/deploy-machine'
import { useChainClock } from '@/components/mint/use-chain-clock'
import { THROWN, type ActionResult } from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import type { Tables } from '@/lib/database.types'
import { formatUtc, type MintGroup } from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { PhasesView } from '@/lib/manage/phases-types'
import { moveGroup } from '@/lib/manage/phases-view'
import { relativeTo } from './format'
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
import { forgetAdd, pendingAdd, rememberAdd, type PendingAdd } from './manage-machine'
import { sampleManageActions, samplePendingAdd, samplePhasesServer } from './manage-sim'
import {
  ClearScheduleDialog,
  CloseAllDialog,
  PriceDialog,
  PublicCapDialog,
  StatusDialog,
  SupplyDialog,
  type PhaseContext,
} from './phase-dialogs'
import { PhaseDetailsDialog } from './phase-details'
import { PHASE_COLUMNS, PhaseRow, UNREADABLE_REASON, type PhaseAction } from './phase-row'
import { AddPhaseDialog, PendingAddPanel, ScheduleDialog } from './phase-schedule'
import { phasesServer } from './phases-server'
import { SupplyMap } from './supply-map'

export type PhasesScreenProps = {
  collection: Tables<'collections'>
  /** The contract's groups joined with Cobweb's rows, read on the server (or the copy, or the sample). */
  view: PhasesView
  /** The sign-in wallet, which every change must be sent from. */
  wallet: Address
  sample: boolean
  /** Sample mode only (`?pending=add`): an add waiting to be recorded. */
  samplePending?: boolean
}

type DialogAction = Exclude<PhaseAction, 'up' | 'down' | 'hide' | 'show'> | 'add' | 'closeAll'
type OpenDialog = { action: DialogAction; groupId: number; key: number }

/** An off-chain edit's answer, or "Try again" when the action itself threw. */
async function settled(edit: Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await edit
  } catch {
    return { ok: false, error: THROWN }
  }
}

/**
 * Manage drop, Phases (docs/specs/2026-10-15-phases.md, section 7.4), on the contract's state: the server
 * reads `collectionState()` and joins each group with its row; status comes only from `active`. Every
 * change on chain runs the manage machine from the sign-in wallet and answers the fresh view, which
 * replaces this one; names, visibility and order are saved by Cobweb. Sample mode runs the same code on the
 * sample actions and server.
 */
export function PhasesScreen({
  collection,
  view: initial,
  wallet,
  sample,
  samplePending = false,
}: PhasesScreenProps) {
  const config = useConfig()
  const [view, setView] = useState(initial)
  const viewRef = useRef(view)
  viewRef.current = view
  // The dialog stays mounted after it closes, so a transaction still confirming can finish.
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const [open, setOpen] = useState(false)
  // The key of the dialog on screen, if any: a failure that reaches a closed or replaced dialog is toasted.
  const shownKey = useRef<number | null>(null)
  shownKey.current = dialog && open ? dialog.key : null
  const [pending, setPending] = useState<PendingAdd | null>(null)
  const [reading, setReading] = useState(false)
  // Sample mode: what the simulated wallet sent, by hash, so the sample server applies exactly that call.
  const [sampleSent] = useState(() => new Map<Hex, ManageCall>())
  const chain = chainView(view.chainId)
  const now = useChainClock(view.blockTimestamp)
  const reachable = view.chainReachable

  const server = useMemo(
    () => (sample ? samplePhasesServer(() => viewRef.current, sampleSent) : phasesServer(collection.id)),
    [sample, sampleSent, collection.id],
  )
  const target = useMemo<ManageTarget>(
    () => ({
      actions: sample
        ? sampleManageActions(() => viewRef.current, sampleSent)
        : realManageActions(config, { chainId: view.chainId, contract: view.contract, wallet }),
      chainId: view.chainId,
      wallet,
    }),
    [sample, sampleSent, config, view.chainId, view.contract, wallet],
  )

  // An add sent before a reload waits to be recorded: it is checked, never sent again.
  useEffect(() => {
    setPending(
      sample
        ? samplePending
          ? samplePendingAdd(viewRef.current)
          : null
        : pendingAdd(browserStore(), collection.id),
    )
  }, [sample, samplePending, collection.id])

  const live = view.groups.filter((group) => group.active)
  const named = view.groups.filter((group) => group.named !== false)
  const airdropped = Math.max(0, view.totalMinted - view.groups.reduce((sum, group) => sum + group.minted, 0))
  const addOpen = dialog?.action === 'add' && open

  function rememberPending(entry: PendingAdd) {
    if (!sample) rememberAdd(browserStore(), collection.id, entry)
    setPending(entry)
  }

  function forgetPending() {
    if (!sample) forgetAdd(browserStore(), collection.id)
    setPending(null)
  }

  function act(action: PhaseAction | 'add' | 'closeAll', groupId = -1) {
    if (action === 'up' || action === 'down') return void move(groupId, action)
    if (action === 'hide' || action === 'show') return void setVisible(groupId, action === 'show')
    setDialog({ action, groupId, key: Date.now() })
    setOpen(true)
  }

  async function readAgain() {
    setReading(true)
    let result: ActionResult<PhasesView>
    try {
      result = await server.read()
    } catch {
      result = { ok: false, error: THROWN }
    }
    setReading(false)
    if (result.ok) setView(result.data)
    else toast.error(result.error)
  }

  /** Moves a phase one place among the named ones; saved by Cobweb, no transaction. */
  async function move(groupId: number, direction: 'up' | 'down') {
    setView((current) => ({ ...current, groups: moveGroup(current.groups, groupId, direction) }))
    const result = await settled(server.move(groupId, direction))
    if (result.ok) {
      toast.success('Order saved. The mint page lists the phases in this order.')
      return
    }
    setView((current) => ({
      ...current,
      groups: moveGroup(current.groups, groupId, direction === 'up' ? 'down' : 'up'),
    }))
    toast.error(result.error)
  }

  async function setVisible(groupId: number, visible: boolean) {
    const result = await settled(server.setVisibility(groupId, visible))
    if (!result.ok) return void toast.error(result.error)
    setView((current) => ({
      ...current,
      groups: current.groups.map((group) => (group.id === groupId ? { ...group, visible } : group)),
    }))
    toast.success(visible ? 'Shown on the mint page' : 'Hidden from the mint page')
  }

  /** Edit details saved: a named phase changes in place; a newly named one takes a position, so read again. */
  function saved(target: MintGroup, details: { name: string; description: string }) {
    if (target.named === false) return void readAgain()
    setView((current) => ({
      ...current,
      groups: current.groups.map((group) => (group.id === target.id ? { ...group, ...details } : group)),
    }))
  }

  const ctx: PhaseContext = {
    chain,
    groups: view.groups,
    maxSupply: view.maxSupply,
    airdropped,
    blockTimestamp: view.blockTimestamp,
    now,
    open,
    onOpenChange: setOpen,
    // The dialog on screen shows its own failure; one closed or replaced since says it in a toast.
    onFailed: (message) => {
      if (shownKey.current !== dialog?.key) toast.error(message)
    },
    server,
  }
  const dialogTarget = dialog ? view.groups.find((group) => group.id === dialog.groupId) : undefined

  return (
    <ManageActionsProvider value={target}>
      <div className="grid gap-8">
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
                These are the prices, allocations and starts Cobweb last read, on {formatUtc(view.readAt)}.
                Status and minted counts are not shown, and changes on chain wait until it can be read.
              </p>
              <Button variant="secondary" size="sm" onClick={() => void readAgain()} disabled={reading}>
                {reading ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
                Read again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Panel
          title="Supply"
          description="How the collection's supply is split between phases. Select a phase to change its allocation."
          bodyClassName="p-5 lg:p-6"
        >
          <SupplyMap
            groups={view.groups}
            maxSupply={view.maxSupply}
            totalMinted={view.totalMinted}
            reachable={reachable}
            onEdit={reachable ? (groupId) => act('supply', groupId) : undefined}
          />
        </Panel>

        <section aria-labelledby="phases-heading" className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <h2 id="phases-heading" className="text-heading">
                Phases
              </h2>
              <p className="text-muted-foreground max-w-2xl text-sm">
                {live.length > 1
                  ? `${live.length} phases are live at once. Each stays open until you close it.`
                  : 'Phases do not end by themselves. Each stays open until you close it, and several can be open at the same time.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {live.length > 0 && (
                <Button variant="outline" onClick={() => act('closeAll')} disabled={!reachable}>
                  Close all
                </Button>
              )}
              {!pending && (
                <Button
                  onClick={() => act('add')}
                  disabled={!reachable}
                  title={reachable ? undefined : UNREADABLE_REASON}
                >
                  <PlusIcon aria-hidden="true" />
                  Add phase
                </Button>
              )}
            </div>
          </div>

          {pending && !addOpen && (
            <PendingAddPanel
              pending={pending}
              chain={chain}
              server={server}
              onView={setView}
              onForget={forgetPending}
            />
          )}

          {view.groups.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LayersIcon />
                </EmptyMedia>
                <EmptyTitle>No phases yet</EmptyTitle>
                <EmptyDescription>
                  Add a phase to set a price and an allocation, then open or schedule it.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="secondary" onClick={() => act('add')} disabled={!reachable || !!pending}>
                  Add phase
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="bg-card shadow-raised @container overflow-hidden rounded-xl border">
              <div
                aria-hidden="true"
                className={cn(
                  'text-muted-foreground hidden gap-x-4 border-b px-6 py-2.5 text-xs font-medium @4xl:grid',
                  PHASE_COLUMNS,
                )}
              >
                <span>Phase</span>
                <span>Price</span>
                <span>Minted of allocation</span>
                <span>Per wallet</span>
                <span>Status</span>
                <span />
              </div>
              <ul className="divide-y" aria-label="Phases">
                {view.groups.map((group) => (
                  <PhaseRow
                    key={group.id}
                    group={group}
                    chain={chain}
                    now={now}
                    publicCap={view.publicMaxPerWallet}
                    reachable={reachable}
                    first={named[0]?.id === group.id}
                    last={named[named.length - 1]?.id === group.id}
                    onAction={(action) => act(action, group.id)}
                  />
                ))}
              </ul>
            </div>
          )}

          <p className="text-muted-foreground flex gap-2 text-[0.8125rem]">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Live means the contract says the phase is open right now. A scheduled phase turns live on its own
            at its start time, as soon as the chain reports it.
          </p>
        </section>

        {dialog && (
          <PhaseDialog
            key={dialog.key}
            dialog={dialog}
            target={dialogTarget}
            ctx={ctx}
            publicCap={view.publicMaxPerWallet}
            onView={setView}
            onSaved={saved}
            onRemember={rememberPending}
            onForget={forgetPending}
          />
        )}
      </div>
    </ManageActionsProvider>
  )
}

function PhaseDialog({
  dialog,
  target,
  ctx,
  publicCap,
  onView,
  onSaved,
  onRemember,
  onForget,
}: {
  dialog: OpenDialog
  target: MintGroup | undefined
  ctx: PhaseContext
  publicCap: number
  onView: (view: PhasesView) => void
  onSaved: (target: MintGroup, details: { name: string; description: string }) => void
  onRemember: (pending: PendingAdd) => void
  onForget: () => void
}) {
  if (dialog.action === 'add')
    return <AddPhaseDialog {...ctx} onView={onView} onRemember={onRemember} onForget={onForget} />
  if (dialog.action === 'closeAll') return <CloseAllDialog {...ctx} onView={onView} />
  if (!target) return null
  switch (dialog.action) {
    case 'open':
    case 'close':
      return <StatusDialog {...ctx} group={target} nextStatus={dialog.action === 'open'} onView={onView} />
    case 'schedule':
      return <ScheduleDialog {...ctx} group={target} onView={onView} />
    case 'clear':
      return <ClearScheduleDialog {...ctx} group={target} onView={onView} />
    case 'price':
      return <PriceDialog {...ctx} group={target} onView={onView} />
    case 'supply':
      return <SupplyDialog {...ctx} group={target} onView={onView} />
    case 'cap':
      return <PublicCapDialog {...ctx} cap={publicCap} onView={onView} />
    case 'details':
      return (
        <PhaseDetailsDialog
          open={ctx.open}
          onOpenChange={ctx.onOpenChange}
          group={target}
          others={ctx.groups
            .filter((group) => group.id !== target.id && group.named !== false)
            .map((group) => group.name)}
          server={ctx.server}
          onSaved={(details) => onSaved(target, details)}
        />
      )
  }
}
