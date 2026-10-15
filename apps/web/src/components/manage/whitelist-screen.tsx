'use client'

import { useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, ListChecksIcon, PlusIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
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
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Tabs, TabsList, TabsTrigger } from '@cobweb/ui/components/tabs'
import { browserStore } from '@/components/deploy/deploy-machine'
import { useChainClock } from '@/components/mint/use-chain-clock'
import { THROWN, type ActionResult } from '@/lib/art/result'
import { chainView } from '@/lib/chain/chain-view'
import type { Tables } from '@/lib/database.types'
import type { MintGroup, SupportedChain } from '@/lib/demo'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type {
  ChunkEntry,
  ChunkPlan,
  GroupList,
  ListEntry,
  SentChunk,
  WhitelistView,
} from '@/lib/manage/whitelist-types'
import { manageTabHref } from '@/lib/steps'
import { count, downloadText, relativeTo } from './format'
import { realManageActions } from './manage-actions'
import { ManageActionsProvider, type ManageTarget } from './manage-context'
import { forgetChunk, rememberChunk, sentChunk } from './manage-machine'
import { sampleManageActions, samplePhasesView } from './manage-sim'
import { UNREADABLE_REASON } from './phase-row'
import { toCsv, type Recipient } from './recipients'
import { snapshotSource } from './snapshot-source'
import type { SnapshotSource } from './snapshot-tab'
import { PendingChunkPanel, WhitelistChunks } from './whitelist-chunks'
import { AddAddressesDialog, chunkRequest, QuotaForAllDialog, WriteChunkDialog } from './whitelist-dialogs'
import {
  chunkRows,
  entryState,
  withAdded,
  withQuota,
  withQuotaForAll,
  withRemoved,
  withRestored,
} from './whitelist-model'
import { whitelistServer, type WhitelistServer } from './whitelist-server'
import { sampleSentChunk, sampleWhitelistServer } from './whitelist-sim'
import { WhitelistTable } from './whitelist-table'

export type WhitelistScreenProps = {
  collection: Tables<'collections'>
  /** The whitelist groups and their lists, read on the server (or the copy, or the sample). */
  view: WhitelistView
  /** The sign-in wallet, which every chunk must be sent from. */
  wallet: Address
  sample: boolean
  /** Sample mode only (`?chunk=pending`): a chunk waiting to be confirmed. */
  samplePending?: boolean
  /** The chains the holder snapshot can read. */
  snapshotChainIds: number[]
}

const PENDING_REASON = 'Confirm or discard the waiting chunk first.'

/** A server answer, or "Try again" when the action itself threw. */
async function settled<T>(call: Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call
  } catch {
    return { ok: false, error: THROWN }
  }
}

/**
 * Manage drop, Whitelist (docs/specs/2026-10-15-whitelist.md, section 7.3): one list per whitelist phase, kept
 * by Cobweb, written on chain in chunks of 500 the server builds from the entries not written. Each chunk runs
 * the manage machine from the sign-in wallet and answers the fresh view, which replaces this one; edits are saved
 * by Cobweb and wait for the next chunk. Sample mode runs the same code on the sample actions and server.
 */
export function WhitelistScreen({
  collection,
  view: initial,
  wallet,
  sample,
  samplePending = false,
  snapshotChainIds,
}: WhitelistScreenProps) {
  const config = useConfig()
  const queryClient = useQueryClient()
  const [view, setView] = useState(initial)
  const viewRef = useRef(view)
  viewRef.current = view
  const [selected, setSelected] = useState(String(initial.groups[0]?.id ?? ''))
  const [pending, setPending] = useState<SentChunk | null>(null)
  const [reading, setReading] = useState(false)
  const [asking, setAsking] = useState(false)
  // The dialog stays mounted after it closes, so a chunk still confirming can finish.
  const [writing, setWriting] = useState<{ plan: ChunkPlan; key: number } | null>(null)
  const [writeOpen, setWriteOpen] = useState(false)
  // The key of the dialog on screen, if any: a failure that reaches a closed dialog is toasted.
  const shownKey = useRef<number | null>(null)
  shownKey.current = writing && writeOpen ? writing.key : null
  /** The last failed write of each group in this visit, until a chunk of it is confirmed. */
  const [failures, setFailures] = useState<Record<number, string>>({})
  // Sample mode: what the simulated wallet sent, by hash, so the sample server applies exactly that call.
  const [sampleSent] = useState(() => new Map<Hex, ManageCall>())
  const chain = chainView(view.chainId)
  const now = useChainClock(view.blockTimestamp)
  const reachable = view.chainReachable
  const maxSupply = collection.max_supply

  const server = useMemo<WhitelistServer>(
    () =>
      sample ? sampleWhitelistServer(() => viewRef.current, sampleSent) : whitelistServer(collection.id),
    [sample, sampleSent, collection.id],
  )
  const target = useMemo<ManageTarget>(
    () => ({
      actions: sample
        ? sampleManageActions(() => samplePhasesView({ max_supply: maxSupply }), sampleSent)
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

  // A chunk sent before a reload waits to be confirmed: it is checked, never sent again.
  useEffect(() => {
    setPending(
      sample
        ? samplePending
          ? sampleSentChunk(viewRef.current)
          : null
        : sentChunk(browserStore(), collection.id),
    )
  }, [sample, samplePending, collection.id])

  function rememberPending(sent: SentChunk) {
    if (!sample) rememberChunk(browserStore(), collection.id, sent)
    setPending(sent)
  }

  function forgetPending() {
    if (!sample) forgetChunk(browserStore(), collection.id)
    setPending(null)
  }

  /** A fresh view from the server replaces this one, and the minted counts on screen are read again. */
  function replace(next: WhitelistView) {
    setView(next)
    void queryClient.invalidateQueries({ queryKey: ['whitelist-minted', collection.id] })
  }

  /**
   * A chunk confirmed, by its dialog or by the waiting panel's "Check again": the group's failure goes and
   * the fresh view replaces this one.
   */
  function confirmed(next: WhitelistView, onchainId: number) {
    setFailures((current) => {
      const left = { ...current }
      delete left[onchainId]
      return left
    })
    replace(next)
  }

  async function readAgain() {
    setReading(true)
    const result = await settled(server.read())
    setReading(false)
    if (result.ok) replace(result.data)
    else toast.error(result.error)
  }

  /** A patch to one group's list, applied once the server accepted the edit. */
  function patch(onchainId: number, change: (list: GroupList) => GroupList) {
    setView((current) => ({
      ...current,
      lists: current.lists.map((list) => (list.onchainId === onchainId ? change(list) : list)),
    }))
  }

  /** "Write chunk": the server builds the group's next chunk from what it holds now. */
  async function write(groupId: number) {
    setAsking(true)
    const answer = await settled(server.nextChunk(groupId))
    setAsking(false)
    if (!answer.ok) return void toast.error(answer.error)
    if (!answer.data) {
      toast.success('Every address is on chain.')
      return void readAgain()
    }
    setWriting({ plan: answer.data, key: Date.now() })
    setWriteOpen(true)
  }

  if (view.groups.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListChecksIcon />
          </EmptyMedia>
          <EmptyTitle>No whitelist phases</EmptyTitle>
          <EmptyDescription>
            Add a whitelist phase on the Phases tab, then give its addresses a quota here.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="secondary" asChild>
            <Link href={manageTabHref(collection.id, 'phases')}>Go to phases</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const group = view.groups.find((candidate) => String(candidate.id) === selected) ?? view.groups[0]!
  const list = view.lists.find((candidate) => candidate.onchainId === group.id)
  const writingGroup = writing
    ? view.groups.find((candidate) => candidate.id === writing.plan.onchainId)
    : undefined
  const off = !reachable ? UNREADABLE_REASON : pending ? PENDING_REASON : null

  return (
    <ManageActionsProvider value={target}>
      <div className="grid gap-6">
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
                The lists below are Cobweb&apos;s, with what each chunk wrote. Quota used and minted counts
                are not shown, and chunks wait until the contract can be read.
              </p>
              <Button variant="secondary" size="sm" onClick={() => void readAgain()} disabled={reading}>
                {reading ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
                Read again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {pending && !writeOpen && (
          <PendingChunkPanel
            sent={pending}
            group={view.groups.find((candidate) => candidate.id === pending.onchainId)}
            chain={chain}
            server={server}
            onView={(next) => confirmed(next, pending.onchainId)}
            onForget={forgetPending}
          />
        )}

        {view.groups.length > 1 && (
          <Tabs value={String(group.id)} onValueChange={setSelected}>
            <TabsList aria-label="Whitelist phase">
              {view.groups.map((candidate) => {
                const waiting = view.lists.find((entry) => entry.onchainId === candidate.id)?.unwritten ?? 0
                const chunks = Math.ceil(waiting / view.chunkSize)
                return (
                  <TabsTrigger key={candidate.id} value={String(candidate.id)} className="gap-2 px-4">
                    {candidate.name}
                    {chunks > 0 && (
                      <span
                        className="bg-warning size-1.5 rounded-full"
                        aria-label={`${chunks} ${chunks === 1 ? 'chunk' : 'chunks'} not written`}
                      />
                    )}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        )}

        {list ? (
          <GroupWhitelist
            key={group.id}
            collectionId={collection.id}
            group={group}
            list={list}
            chain={chain}
            reachable={reachable}
            chunkSize={view.chunkSize}
            server={server}
            snapshot={snapshot}
            failure={failures[group.id] ?? null}
            write={{ off, busy: asking, onWrite: () => void write(group.id) }}
            onPatch={(change) => patch(group.id, change)}
            onReadAgain={() => void readAgain()}
          />
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecksIcon />
              </EmptyMedia>
              <EmptyTitle>Not named yet</EmptyTitle>
              <EmptyDescription>
                {group.name} is not named. Name it on the Phases tab to add its whitelist.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="secondary" asChild>
                <Link href={manageTabHref(collection.id, 'phases')}>Go to phases</Link>
              </Button>
            </EmptyContent>
          </Empty>
        )}

        {writing && writingGroup && (
          <WriteChunkDialog
            key={writing.key}
            open={writeOpen}
            onOpenChange={setWriteOpen}
            chain={chain}
            group={writingGroup}
            plan={writing.plan}
            retry={failures[writing.plan.onchainId] !== undefined}
            request={chunkRequest(
              writing.plan,
              chain,
              (hash) => server.confirmChunk(hash, writing.plan.onchainId),
              {
                remember: (hash) => rememberPending({ hash, onchainId: writing.plan.onchainId }),
                forget: forgetPending,
              },
            )}
            onConfirmed={(next) => confirmed(next, writing.plan.onchainId)}
            onFailed={(message) => {
              setFailures((current) => ({ ...current, [writing.plan.onchainId]: message }))
              // The dialog on screen shows its own failure; one closed since says it in a toast.
              if (shownKey.current !== writing.key) toast.error(message)
            }}
          />
        )}
      </div>
    </ManageActionsProvider>
  )
}

/** One whitelist group's stats, its on-chain write panel, its table and its add and quota dialogs. */
function GroupWhitelist({
  collectionId,
  group,
  list,
  chain,
  reachable,
  chunkSize,
  server,
  snapshot,
  failure,
  write,
  onPatch,
  onReadAgain,
}: {
  collectionId: string
  group: MintGroup
  list: GroupList
  chain: SupportedChain
  reachable: boolean
  chunkSize: number
  server: WhitelistServer
  snapshot: SnapshotSource | undefined
  /** The last write's failure in this visit, or null. */
  failure: string | null
  /** Why writing is off (or null), whether the next chunk is being asked for, and the ask. */
  write: { off: string | null; busy: boolean; onWrite: () => void }
  onPatch: (change: (list: GroupList) => GroupList) => void
  onReadAgain: () => void
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [settingAll, setSettingAll] = useState(false)
  const usageKey = useMemo(
    () => ['whitelist-minted', collectionId, group.id] as const,
    [collectionId, group.id],
  )
  const existing = useMemo(
    () => new Set(list.entries.map((entry) => entry.address.toLowerCase())),
    [list.entries],
  )
  const rows = chunkRows(list, chunkSize, failure)
  const next = list.chunks.length + 1
  const of = list.chunks.length + Math.ceil(list.unwritten / chunkSize)

  async function setQuota(address: Address, quota: number) {
    const answer = await settled(server.setEntryQuota(group.id, address, quota))
    if (!answer.ok) return void toast.error(answer.error)
    const writtenQuota = list.entries.find((entry) => entry.address === address)?.writtenQuota
    onPatch((current) => withQuota(current, address, quota))
    toast.success(
      writtenQuota === quota ? 'Quota saved.' : 'Quota saved. Write the next chunk to put it on chain.',
    )
  }

  async function restore(entry: ListEntry) {
    const answer = await settled(server.setEntryQuota(group.id, entry.address, entry.quota))
    if (!answer.ok) return void toast.error(answer.error)
    onPatch((current) => withRestored(current, entry))
  }

  async function remove(address: Address) {
    const before = list.entries.find((entry) => entry.address === address)
    const answer = await settled(server.removeEntry(group.id, address))
    if (!answer.ok) return void toast.error(answer.error)
    onPatch((current) => withRemoved(current, address))
    if (!before) return
    // Undo: a staged removal gets its quota back; a deleted entry comes back as a new row, without copies.
    const back: ListEntry = answer.data.staged ? before : { ...before, writtenQuota: null, writtenTx: null }
    toast(answer.data.staged ? 'Removal staged. Write the next chunk to apply it.' : 'Address removed.', {
      action: { label: 'Undo', onClick: () => void restore(back) },
    })
  }

  async function setAll(quota: number): Promise<string | null> {
    const answer = await settled(server.setQuotaForAll(group.id, quota))
    if (!answer.ok) return answer.error
    onPatch((current) => withQuotaForAll(current, quota))
    const { changed } = answer.data
    toast.success(
      changed === 0
        ? 'Every address already has that quota.'
        : changed === 1
          ? '1 quota changed. Write the next chunk to put it on chain.'
          : `${count(changed)} quotas changed. Write the next chunk to put them on chain.`,
    )
    return null
  }

  async function add(recipients: Recipient[]): Promise<string | null> {
    const entries: ChunkEntry[] = recipients.map((row) => ({ address: row.address, quota: row.amount }))
    const answer = await settled(server.addEntries(group.id, entries))
    if (!answer.ok) {
      // Pages of an add may have landed before a refusal: the list is read again.
      onReadAgain()
      return answer.error
    }
    onPatch((current) => withAdded(current, entries))
    const { added, updated } = answer.data
    toast.success(
      added === 0 && updated === 0
        ? 'Every address was already listed with that quota.'
        : `${count(added)} added${updated > 0 ? `, ${count(updated)} updated` : ''}. Write the next chunk to put them on chain.`,
    )
    return null
  }

  function exportCsv() {
    // Minted as read in this visit: the pages the table asked the chain for.
    const minted = new Map<string, number>()
    for (const [key, data] of queryClient.getQueriesData<(number | null)[]>({ queryKey: usageKey })) {
      key.slice(usageKey.length).forEach((address, index) => {
        const value = data?.[index]
        if (typeof address === 'string' && typeof value === 'number') minted.set(address.toLowerCase(), value)
      })
    }
    downloadText(
      `${group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-whitelist.csv`,
      toCsv([
        ['address', 'quota', 'minted', 'on_chain'],
        ...list.entries.map((entry) => [
          entry.address,
          entry.quota,
          minted.get(entry.address.toLowerCase()) ?? '',
          entryState(entry) === 'written' ? 'yes' : 'no',
        ]),
      ]),
    )
  }

  return (
    <div className="grid gap-6">
      <section
        aria-label={`${group.name} summary`}
        className="flex flex-wrap items-end justify-between gap-6"
      >
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-heading">{group.name}</h2>
            {reachable && (
              <StatusBadge
                status={group.active ? 'live' : group.scheduledStart > 0 ? 'scheduled' : 'closed'}
              />
            )}
          </div>
          <StatGroup>
            <Stat label="Addresses" value={count(list.total)} />
            <Stat label="Total quota" value={count(list.totalQuota)} />
            <Stat label="Quota used" value={reachable ? count(list.quotaUsed) : 'Not read'} />
            <Stat
              label="Phase supply"
              value={count(group.maxSupply)}
              hint={
                list.totalQuota > group.maxSupply
                  ? 'Less than the quota issued: first come, first served.'
                  : undefined
              }
            />
          </StatGroup>
        </div>
      </section>

      <Panel
        title="On-chain write"
        description="Addresses can mint only after their chunk is written."
        bodyClassName="p-5 lg:p-6"
      >
        <WhitelistChunks
          rows={rows}
          list={list}
          chain={chain}
          write={
            list.unwritten === 0
              ? null
              : {
                  label: failure ? `Retry chunk ${next}` : `Write chunk ${next} of ${of}`,
                  off: write.off,
                  busy: write.busy,
                }
          }
          onWrite={write.onWrite}
        />
      </Panel>

      <Panel title="Addresses" bodyClassName="p-0">
        <WhitelistTable
          entries={list.entries}
          usage={{
            key: usageKey,
            on: reachable,
            read: async (addresses) => {
              const answer = await server.quotaUsage(group.id, addresses)
              if (!answer.ok) throw new Error(answer.error)
              return answer.data
            },
          }}
          onQuota={(address, quota) => void setQuota(address, quota)}
          onRemove={(address) => void remove(address)}
          onRestore={(entry) => void restore({ ...entry, quota: entry.writtenQuota ?? entry.quota })}
          toolbar={
            <>
              <Button variant="ghost" size="sm" onClick={exportCsv} disabled={list.entries.length === 0}>
                <DownloadIcon aria-hidden="true" />
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettingAll(true)}
                disabled={list.total === 0}
              >
                Set quota for all
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                <PlusIcon aria-hidden="true" />
                Add addresses
              </Button>
            </>
          }
        />
      </Panel>

      <AddAddressesDialog
        open={adding}
        onOpenChange={setAdding}
        group={group}
        existing={existing}
        snapshot={snapshot}
        onAdd={add}
      />
      <QuotaForAllDialog open={settingAll} onOpenChange={setSettingAll} total={list.total} onApply={setAll} />
    </div>
  )
}
