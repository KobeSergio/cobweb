'use client'

import { sampleSupply, DEMO_COLLECTION } from '@/lib/demo'
import { InfoIcon, LayersIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
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
import { cn } from '@cobweb/ui/lib/utils'
import type { Tables } from '@/lib/database.types'
import type { Deployment, MintGroup, SupportedChain } from '@/lib/demo'
import {
  ClearScheduleDialog,
  CloseAllDialog,
  PriceDialog,
  PublicCapDialog,
  StatusDialog,
  SupplyDialog,
  type PhaseContext,
} from './phase-dialogs'
import { PHASE_COLUMNS, PhaseRow, type PhaseAction } from './phase-row'
import { AddPhaseDialog, ScheduleDialog } from './phase-schedule'
import { chainReadGroup, SAMPLE } from './simulate'
import { SupplyMap } from './supply-map'

export type PhasesScreenProps = {
  collection: Tables<'collections'>
  deployment: Deployment
  chain: SupportedChain
  /** Mint groups shaped like `collectionState()`. Group 0 is public. */
  groups: MintGroup[]
  publicMaxMintPerWallet: number
  /** The chain's block timestamp at the read, for "starts in" text. Never the browser clock. */
  blockTimestamp: number
}

type DialogAction = PhaseAction | 'add' | 'closeAll'
type OpenDialog = { action: DialogAction; groupId: number; key: number }

/**
 * Manage drop, phases: create and edit mint groups (price, supply, start), and Open now, Close
 * and Schedule for each. Liveness shown is the contract's `mintGroupActive`.
 */
export function PhasesScreen({
  collection,
  chain,
  groups: initial,
  publicMaxMintPerWallet,
  blockTimestamp,
}: PhasesScreenProps) {
  const [groups, setGroups] = useState(initial)
  const [publicCap, setPublicCap] = useState(publicMaxMintPerWallet)
  // The dialog stays mounted after it closes, so a transaction still confirming can finish.
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const [open, setOpen] = useState(false)

  const live = groups.filter((group) => group.active)
  const ordered = [...groups].sort((a, b) => Number(b.active) - Number(a.active) || a.id - b.id)

  function act(action: DialogAction, groupId = -1) {
    setDialog({ action, groupId, key: Date.now() })
    setOpen(true)
  }

  /** A write landed: apply it, then take liveness from the (simulated) chain re-read. */
  function apply(groupId: number, patch: Partial<MintGroup>) {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId ? chainReadGroup({ ...group, ...patch }, blockTimestamp) : group,
      ),
    )
  }

  const ctx: PhaseContext = {
    chain,
    groups,
    // A deployed collection always has its supply; it is fixed at deploy.
    maxSupply: sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply),
    blockTimestamp,
    open,
    onOpenChange: setOpen,
  }
  const target = dialog ? groups.find((group) => group.id === dialog.groupId) : undefined

  return (
    <div className="grid gap-8">
      <Panel
        title="Supply"
        description="How the collection's supply is split between phases."
        bodyClassName="p-5 lg:p-6"
      >
        <SupplyMap
          groups={ordered}
          maxSupply={sampleSupply(collection.max_supply, DEMO_COLLECTION.maxSupply)}
          totalMinted={SAMPLE.totalMinted}
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
              <Button variant="outline" onClick={() => act('closeAll')}>
                Close all
              </Button>
            )}
            <Button onClick={() => act('add')}>
              <PlusIcon aria-hidden="true" />
              Add phase
            </Button>
          </div>
        </div>

        {groups.length === 0 ? (
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
              <Button variant="secondary" onClick={() => act('add')}>
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
              {ordered.map((group) => (
                <PhaseRow
                  key={group.id}
                  group={group}
                  chain={chain}
                  blockTimestamp={blockTimestamp}
                  publicCap={publicCap}
                  onAction={(action) => act(action, group.id)}
                />
              ))}
            </ul>
          </div>
        )}

        <p className="text-muted-foreground flex gap-2 text-[0.8125rem]">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Live means the contract says the phase is open right now. A scheduled phase turns live on its own at
          its start time, as soon as the chain reports it.
        </p>
      </section>

      {dialog && (
        <PhaseDialog
          key={dialog.key}
          dialog={dialog}
          target={target}
          ctx={ctx}
          publicCap={publicCap}
          onApply={(patch) => target && apply(target.id, patch)}
          onAdd={(group) => setGroups((current) => [...current, chainReadGroup(group, blockTimestamp)])}
          onCap={setPublicCap}
          onCloseAll={() =>
            setGroups((current) =>
              current.map((group) =>
                chainReadGroup({ ...group, flag: false, scheduledStart: 0 }, blockTimestamp),
              ),
            )
          }
        />
      )}
    </div>
  )
}

function PhaseDialog({
  dialog,
  target,
  ctx,
  publicCap,
  onApply,
  onAdd,
  onCap,
  onCloseAll,
}: {
  dialog: OpenDialog
  target: MintGroup | undefined
  ctx: PhaseContext
  publicCap: number
  onApply: (patch: Partial<MintGroup>) => void
  onAdd: (group: Omit<MintGroup, 'active'>) => void
  onCap: (cap: number) => void
  onCloseAll: () => void
}) {
  if (dialog.action === 'add') return <AddPhaseDialog {...ctx} onAdd={onAdd} />
  if (dialog.action === 'closeAll') return <CloseAllDialog {...ctx} onApply={onCloseAll} />
  if (!target) return null
  switch (dialog.action) {
    case 'open':
    case 'close':
      return <StatusDialog {...ctx} group={target} nextStatus={dialog.action === 'open'} onApply={onApply} />
    case 'schedule':
      return <ScheduleDialog {...ctx} group={target} onApply={onApply} />
    case 'clear':
      return <ClearScheduleDialog {...ctx} group={target} onApply={onApply} />
    case 'price':
      return <PriceDialog {...ctx} group={target} onApply={onApply} />
    case 'supply':
      return <SupplyDialog {...ctx} group={target} onApply={onApply} />
    case 'cap':
      return <PublicCapDialog {...ctx} cap={publicCap} onApply={onCap} />
  }
}
