'use client'

import { PencilIcon, SearchIcon, Trash2Icon, Undo2Icon } from 'lucide-react'
import { useDeferredValue, useId, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Input } from '@cobweb/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@cobweb/ui/components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@cobweb/ui/components/popover'
import { StatusBadge } from '@cobweb/ui/components/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cobweb/ui/components/table'
import { ToggleGroup, ToggleGroupItem } from '@cobweb/ui/components/toggle-group'
import { cn } from '@cobweb/ui/lib/utils'
import { CopyButton, Pager } from './bits'
import { count } from './format'
import type { ListEntry } from './whitelist-model'

const PAGE_SIZE = 25

/**
 * A whitelist's addresses: search, a filter for what is not on chain yet, paging, and per-row
 * quota edit and remove. Edits are staged; they reach the chain with the next chunk.
 */
export function WhitelistTable({
  entries,
  onQuota,
  onRemove,
  onRestore,
  toolbar,
}: {
  entries: ListEntry[]
  onQuota: (address: string, quota: number) => void
  onRemove: (address: string) => void
  /** Puts back an address marked for removal, as it was. */
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
      (filter === 'all' || entry.state !== 'onchain') &&
      (!deferredQuery || entry.address.toLowerCase().includes(deferredQuery)),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const rows = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const waiting = entries.filter((entry) => entry.state !== 'onchain').length

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
            {rows.map((entry) => (
              <TableRow
                key={entry.address}
                className={cn(entry.state === 'removing' && 'text-muted-foreground')}
              >
                <TableCell className="pl-5 lg:pl-6">
                  <span className="inline-flex items-center gap-1">
                    <span className={cn('numeric', entry.state === 'removing' && 'line-through')}>
                      {entry.address}
                    </span>
                    <CopyButton value={entry.address} label="Copy address" />
                  </span>
                </TableCell>
                <TableCell className="numeric text-right">
                  {entry.state === 'removing' ? 0 : count(entry.quota)}
                </TableCell>
                <TableCell className="numeric text-muted-foreground text-right">
                  {count(entry.minted)}
                </TableCell>
                <TableCell className="numeric text-right">
                  {entry.state === 'removing' ? 0 : count(Math.max(0, entry.quota - entry.minted))}
                </TableCell>
                <TableCell>
                  {entry.state === 'onchain' ? (
                    <span className="text-muted-foreground text-[0.8125rem]">Written</span>
                  ) : (
                    <StatusBadge status="pending">
                      {entry.state === 'removing' ? 'Removal not written' : 'Not written'}
                    </StatusBadge>
                  )}
                </TableCell>
                <TableCell className="pr-5 text-right lg:pr-6">
                  {entry.state === 'removing' ? (
                    <Button variant="ghost" size="xs" onClick={() => onRestore(entry)}>
                      <Undo2Icon aria-hidden="true" />
                      Keep
                    </Button>
                  ) : (
                    <span className="inline-flex gap-1">
                      <QuotaEditor entry={entry} onSave={(quota) => onQuota(entry.address, quota)} />
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
            ))}
          </TableBody>
        </Table>
      )}

      <div className="border-t px-5 py-3 lg:px-6">
        <Pager
          page={current}
          pages={pages}
          total={filtered.length}
          pageSize={PAGE_SIZE}
          onPage={setPage}
          noun="addresses"
        />
      </div>
    </div>
  )
}

function QuotaEditor({ entry, onSave }: { entry: ListEntry; onSave: (quota: number) => void }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(String(entry.quota))
  const quota = Number(value)
  const valid = /^\d+$/.test(value) && quota >= 1 && quota <= 10_000
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
            max={10_000}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={!valid}
            aria-describedby={`${id}-quota-help`}
            autoFocus
          />
          <p id={`${id}-quota-help`} className="text-muted-foreground text-[0.8125rem]">
            {entry.minted > 0 && quota < entry.minted
              ? `Below the ${entry.minted} already minted: this wallet will have nothing left.`
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
