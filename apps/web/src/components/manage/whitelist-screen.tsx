'use client'

import { DownloadIcon, ListChecksIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Tabs, TabsList, TabsTrigger } from '@cobweb/ui/components/tabs'
import type { Tables } from '@/lib/database.types'
// Seam: the launch chains come from `packages/shared` chain config in Phase 5.
import {
  SUPPORTED_CHAINS,
  type GroupWhitelist,
  type Hex,
  type MintGroup,
  type SupportedChain,
} from '@/lib/demo'
import { manageTabHref } from '@/lib/steps'
import { count, downloadText } from './format'
import { toCsv } from './recipients'
import { AddAddressesDialog, QuotaForAllDialog, WriteChunkDialog } from './whitelist-dialogs'
import { WhitelistChunks } from './whitelist-chunks'
import {
  addEntries,
  emptyList,
  fromGroupWhitelist,
  markFailed,
  markWritten,
  pendingChunks,
  removeEntry,
  setQuota,
  setQuotaForAll,
  type ListEntry,
  type ListState,
  type PendingChunk,
} from './whitelist-model'
import { WhitelistTable } from './whitelist-table'

export type WhitelistScreenProps = {
  collection: Tables<'collections'>
  chain: SupportedChain
  /** The whitelist groups (id 1 and up). */
  groups: MintGroup[]
  /** Entries and on-chain write progress per group. */
  whitelists: GroupWhitelist[]
}

/**
 * Manage drop, whitelist: upload a CSV of addresses and quotas per group, validate it, and write
 * it on-chain in chunks of 500 addresses with `setMintQuota`, resumable per chunk.
 */
export function WhitelistScreen({ collection, chain, groups, whitelists }: WhitelistScreenProps) {
  const [lists, setLists] = useState<Record<number, ListState>>(() =>
    Object.fromEntries(
      groups.map((group) => {
        const source = whitelists.find((list) => list.groupId === group.id)
        return [group.id, source ? fromGroupWhitelist(source) : emptyList(group.id)]
      }),
    ),
  )
  const [selected, setSelected] = useState(String(groups[0]?.id ?? ''))

  if (groups.length === 0) {
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

  const group = groups.find((candidate) => String(candidate.id) === selected) ?? groups[0]!
  const list = lists[group.id] ?? emptyList(group.id)
  const update = (next: (current: ListState) => ListState) =>
    setLists((current) => ({ ...current, [group.id]: next(current[group.id] ?? emptyList(group.id)) }))

  return (
    <div className="grid gap-6">
      {groups.length > 1 && (
        <Tabs value={selected} onValueChange={setSelected}>
          <TabsList aria-label="Whitelist phase">
            {groups.map((candidate) => {
              const waiting = pendingChunks(lists[candidate.id] ?? emptyList(candidate.id)).length
              return (
                <TabsTrigger key={candidate.id} value={String(candidate.id)} className="gap-2 px-4">
                  {candidate.name}
                  {waiting > 0 && (
                    <span
                      className="bg-warning size-1.5 rounded-full"
                      aria-label={`${waiting} chunks not written`}
                    />
                  )}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
      )}
      <GroupWhitelistView key={group.id} group={group} list={list} chain={chain} update={update} />
    </div>
  )
}

function GroupWhitelistView({
  group,
  list,
  chain,
  update,
}: {
  group: MintGroup
  list: ListState
  chain: SupportedChain
  update: (next: (current: ListState) => ListState) => void
}) {
  const [adding, setAdding] = useState(false)
  const [settingAll, setSettingAll] = useState(false)
  const [writing, setWriting] = useState<{ chunk: PendingChunk; total: number; key: number } | null>(null)
  const [writeOpen, setWriteOpen] = useState(false)

  const pending = pendingChunks(list)
  const active = list.entries.filter((entry) => entry.state !== 'removing')
  const quotaTotal = active.reduce((sum, entry) => sum + entry.quota, 0)
  const used = list.entries.reduce((sum, entry) => sum + entry.minted, 0)

  function remove(address: string) {
    const before = list.entries.find((entry) => entry.address === address)
    update((current) => removeEntry(current, address))
    toast(before?.everWritten ? 'Removal staged. Write the next chunk to apply it.' : 'Address removed.', {
      action: before
        ? { label: 'Undo', onClick: () => update((current) => restore(current, before)) }
        : undefined,
    })
  }

  function exportCsv() {
    downloadText(
      `${group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-whitelist.csv`,
      toCsv([
        ['address', 'quota', 'minted', 'on_chain'],
        ...list.entries.map((entry) => [
          entry.address,
          entry.quota,
          entry.minted,
          entry.state === 'onchain' ? 'yes' : 'no',
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
            <StatusBadge status={group.active ? 'live' : group.scheduledStart > 0 ? 'scheduled' : 'closed'} />
          </div>
          <StatGroup>
            <Stat label="Addresses" value={count(active.length)} />
            <Stat label="Total quota" value={count(quotaTotal)} />
            <Stat label="Quota used" value={count(used)} />
            <Stat
              label="Phase supply"
              value={count(group.maxSupply)}
              hint={
                quotaTotal > group.maxSupply
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
          list={list}
          pending={pending}
          chain={chain}
          onWrite={(chunk) => {
            setWriting({ chunk, total: list.written.length + pending.length, key: Date.now() })
            setWriteOpen(true)
          }}
        />
      </Panel>

      <Panel title="Addresses" bodyClassName="p-0">
        <WhitelistTable
          entries={list.entries}
          onQuota={(address, quota) => update((current) => setQuota(current, address, quota))}
          onRemove={remove}
          onRestore={(entry) => update((current) => restore(current, entry))}
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
                disabled={active.length === 0}
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
        existing={new Set(list.entries.map((entry) => entry.address.toLowerCase()))}
        snapshot={{ chains: SUPPORTED_CHAINS, chainId: chain.id }}
        onAdd={(rows) => {
          // SEAM: the rows are saved to `whitelist_entries` by a server action before the chunk write.
          const result = addEntries(list, rows)
          update(() => result.state)
          toast.success(
            `${count(result.added)} added${result.updated ? `, ${count(result.updated)} updated` : ''}. Write the next chunk to put them on chain.`,
          )
        }}
      />
      <QuotaForAllDialog
        open={settingAll}
        onOpenChange={setSettingAll}
        total={active.length}
        onApply={(quota) => update((current) => setQuotaForAll(current, quota))}
      />
      {writing && (
        <WriteChunkDialog
          key={writing.key}
          open={writeOpen}
          onOpenChange={setWriteOpen}
          chain={chain}
          group={group}
          chunk={writing.chunk}
          totalChunks={writing.total}
          onWritten={(hash: Hex) => update((current) => markWritten(current, writing.chunk, hash))}
          onFailed={(message) => update((current) => markFailed(current, message))}
        />
      )}
    </div>
  )
}

/** Puts an address back as it was before a remove. */
function restore(state: ListState, entry: ListEntry): ListState {
  const exists = state.entries.some((candidate) => candidate.address === entry.address)
  const back: ListEntry = { ...entry, state: entry.state === 'removing' ? 'pending' : entry.state }
  return {
    ...state,
    entries: exists
      ? state.entries.map((candidate) => (candidate.address === entry.address ? back : candidate))
      : [...state.entries, back],
  }
}
