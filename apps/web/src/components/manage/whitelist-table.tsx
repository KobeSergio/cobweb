'use client'

import { useQuery } from '@tanstack/react-query'
import { PencilIcon, SearchIcon, Trash2Icon, Undo2Icon } from 'lucide-react'
import { useDeferredValue, useId, useState } from 'react'
import type { Address } from 'viem'
import { Button } from '@cobweb/ui/components/button'
import { Input } from '@cobweb/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@cobweb/ui/components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@cobweb/ui/components/popover'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import { ToggleGroup, ToggleGroupItem } from '@cobweb/ui/components/toggle-group'
import { cn } from '@cobweb/ui/lib/utils'
import type { ListEntry } from '@/lib/manage/whitelist-types'
import { QUOTA_MAX, USAGE_PAGE } from '@/lib/manage/whitelist-view'
import { CopyButton, Pager } from './bits'
import { count } from './format'
import { entryState } from './whitelist-model'

/** How long a page's minted counts stay fresh before the table asks the chain again. */
const USAGE_STALE_MS = 30_000

/**
 * A whitelist's addresses (docs/specs/2026-10-15-whitelist.md, section 7.3): search, All or Not written, 25 a
 * page, and per row the quota edit, the removal and Keep for a staged removal. Minted and Left are read from the
 * chain for the page on screen; until that read answers, Minted reads "Not read" and Left is blank.
 */
export function WhitelistTable({
  entries,
  usage,
  onQuota,
  onRemove,
  onRestore,
  toolbar,
}: {
  entries: ListEntry[]
  /** The page's minted counts: the query key's start, whether to read them (off while the chain cannot be read), and the read. */
  usage: { key: readonly unknown[]; on: boolean; read(addresses: Address[]): Promise<(number | null)[]> }
  onQuota: (address: Address, quota: number) => void
  onRemove: (address: Address) => void
  /** Keep: a staged removal goes back to the quota the chain holds. */
  onRestore: (entry: ListEntry) => void
  /** Actions shown at the right of the search row. */
  toolbar?: React.ReactNode
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'waiting'>('all')
  const [page, setPage] = useState(0)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())

  const filtered = entries.filter(
    (entry) =>
      (filter === 'all' || entryState(entry) !== 'written') &&
      (!deferredQuery || entry.address.toLowerCase().includes(deferredQuery)),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / USAGE_PAGE))
  const current = Math.min(page, pages - 1)
  const rows = filtered.slice(current * USAGE_PAGE, (current + 1) * USAGE_PAGE)
  const waiting = entries.filter((entry) => entryState(entry) !== 'written').length
  const addresses = rows.map((entry) => entry.address)
  const minted = useQuery({
    queryKey: [...usage.key, ...addresses],
    queryFn: () => usage.read(addresses),
    enabled: usage.on && addresses.length > 0,
    staleTime: USAGE_STALE_MS,
    // Kept for the visit, so the export has Minted for every page read, not only the one on screen.
    gcTime: Infinity,
    retry: false,
  })

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-5 lg:px-6">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            id={`${id}-search`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(0)
            }}
            placeholder="Search addresses"
            aria-label="Search addresses"
            className="numeric"
            spellCheck={false}
          />
        </InputGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as 'all' | 'waiting')
            setPage(0)
          }}
          aria-label="Show"
        >
          <ToggleGroupItem value="all" className="px-3">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="waiting" className="px-3">
            Not written <span className="numeric text-muted-foreground ml-1">{count(waiting)}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground px-6 py-12 text-center text-sm">
          {entries.length === 0
            ? 'No addresses yet. Add them from a CSV, by pasting, or one at a time.'
            : deferredQuery
              ? 'No address matches that search.'
              : 'Every address is on chain.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5 lg:pl-6">Address</TableHead>
              <TableHead className="text-right">Quota</TableHead>
              <TableHead className="text-right">Minted</TableHead>
              <TableHead className="text-right">Left</TableHead>
              <TableHead>On chain</TableHead>
              <TableHead className="pr-5 text-right lg:pr-6">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((entry, index) => {
              const state = entryState(entry)
              // A disabled read keeps its cache: while the chain cannot be read, Minted says "Not read".
              const used = usage.on ? minted.data?.[index] : undefined
              const known = typeof used === 'number'
              return (
                <TableRow key={entry.address} className={cn(state === 'removing' && 'text-muted-foreground')}>
                  <TableCell className="pl-5 lg:pl-6">
                    <span className="inline-flex items-center gap-1">
                      <span className={cn('numeric', state === 'removing' && 'line-through')}>
                        {entry.address}
                      </span>
                      <CopyButton value={entry.address} label="Copy address" />
                    </span>
                  </TableCell>
                  <TableCell className="numeric text-right">{count(entry.quota)}</TableCell>
                  <TableCell className="numeric text-muted-foreground text-right">
                    {known ? count(used) : 'Not read'}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {known ? count(Math.max(0, entry.quota - used)) : ''}
                  </TableCell>
                  <TableCell>
                    {state === 'written' ? (
                      <span className="text-muted-foreground text-[0.8125rem]">Written</span>
                    ) : (
                      <span className="grid justify-items-start gap-0.5">
                        <StatusBadge status="pending">
                          {state === 'removing' ? 'Removal not written' : 'Not written'}
                        </StatusBadge>
                        {state === 'pending' && entry.writtenQuota !== null && (
                          <span className="numeric text-muted-foreground text-xs">
                            {count(entry.writtenQuota)} on chain
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right lg:pr-6">
                    {state === 'removing' ? (
                      <Button variant="ghost" size="xs" onClick={() => onRestore(entry)}>
                        <Undo2Icon aria-hidden="true" />
                        Keep
                      </Button>
                    ) : (
                      <span className="inline-flex gap-1">
                        <QuotaEditor
                          entry={entry}
                          minted={known ? used : null}
                          onSave={(quota) => onQuota(entry.address, quota)}
                        />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => onRemove(entry.address)}
                          aria-label={`Remove ${entry.address}`}
                        >
                          <Trash2Icon />
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <div className="border-t px-5 py-3 lg:px-6">
        <Pager
          page={current}
          pages={pages}
          total={filtered.length}
          pageSize={USAGE_PAGE}
          onPage={setPage}
          noun="addresses"
        />
      </div>
    </div>
  )
}

function QuotaEditor({
  entry,
  minted,
  onSave,
}: {
  entry: ListEntry
  /** Quota used, as the chain answered for this page, or null when it was not read. */
  minted: number | null
  onSave: (quota: number) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(String(entry.quota))
  const quota = Number(value)
  const valid = /^\d+$/.test(value) && quota >= 1 && quota <= QUOTA_MAX
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setValue(String(entry.quota))
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Edit quota for ${entry.address}`}>
          <PencilIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!valid) return
            onSave(quota)
            setOpen(false)
          }}
        >
          <label htmlFor={`${id}-quota`} className="text-sm font-medium">
            Quota
          </label>
          <Input
            id={`${id}-quota`}
            type="number"
            min={1}
            max={QUOTA_MAX}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={!valid}
            aria-describedby={`${id}-quota-help`}
            autoFocus
          />
          <p id={`${id}-quota-help`} className="text-muted-foreground text-[0.8125rem]">
            {minted !== null && minted > 0 && quota < minted
              ? `Below the ${count(minted)} already minted: this wallet will have nothing left.`
              : 'Total this wallet may mint in the phase.'}
          </p>
          <Button type="submit" size="sm" variant="secondary" disabled={!valid}>
            Save quota
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
