'use client'

import { useMemo, useState } from 'react'
import { ImagesIcon, PlusIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import { Label } from '@cobweb/ui/components/label'
import { Switch } from '@cobweb/ui/components/switch'
import { AssetFilters } from './asset-filters'
import { AssetGrid } from './asset-grid'
import { BulkAttributeDialog, BulkEditionsDialog, BulkRemoveButton } from './bulk-actions'
import { DropZone, FilePickerButton } from './drop-zone'
import {
  buildOneOfOneTokens,
  formatIds,
  idsByItem,
  rankItems,
  summarizeTraits,
  visibleItems,
  type AssetSort,
  type TokenDetails,
} from './token-list'
import { type AssetItem, type Attribute } from './types'

export const ASSET_RULES_COPY =
  'PNG, JPG or WebP, up to 20 MB each. Any shape; images do not need to be square. Hidden files are skipped.'

export type OneOfOneHandlers = {
  onAdd: (files: File[], options: { nameAttribute: boolean }) => void
  onQuantity: (key: string, quantity: number) => void
  onQuantityMany: (keys: string[], quantity: number) => void
  onAttributes: (key: string, attributes: Attribute[]) => void
  onApplyAttribute: (keys: string[], attribute: Attribute) => void
  onClearTraitType: (keys: string[], traitType: string) => void
  onRemove: (key: string) => void
  onRemoveMany: (keys: string[]) => void
}

function NameAttributeSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center gap-2.5">
      <Switch id="name-attribute" size="sm" checked={on} onCheckedChange={onChange} />
      <Label htmlFor="name-attribute" className="text-[0.8125rem] font-normal text-muted-foreground">
        Add each file name as a <span className="text-foreground">Name</span> attribute
      </Label>
    </div>
  )
}

/**
 * 1/1s, as legacy's preview screen for a 1/1 project: a sidebar to search, sort and filter by
 * trait (with each value's count and share), and a grid of artworks with their token ids, rarity
 * rank, editions and attributes. Tick files for bulk editions, attributes or removal.
 */
export function OneOfOneView({
  items,
  readOnly,
  details,
  handlers,
}: {
  items: AssetItem[]
  readOnly: boolean
  details: TokenDetails
  handlers: OneOfOneHandlers
}) {
  const [nameAttribute, setNameAttribute] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<AssetSort>('upload')
  const [filters, setFilters] = useState<ReadonlySet<string>>(new Set())
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  const ids = useMemo(() => idsByItem(buildOneOfOneTokens(items, details)), [items, details])
  const ranks = useMemo(() => rankItems(items), [items])
  const traits = useMemo(() => summarizeTraits(items), [items])
  const visible = useMemo(
    () => visibleItems(items, { search, filters, sort, ranks }),
    [items, search, filters, sort, ranks],
  )
  // Removed files drop out of the selection.
  const selected = useMemo(() => {
    const present = new Set(items.map((item) => item.key))
    return new Set([...picked].filter((key) => present.has(key)))
  }, [items, picked])
  const keys = [...selected]

  const add = (files: File[]) => handlers.onAdd(files, { nameAttribute })
  const toggle = (key: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  const toggleFilter = (key: string) =>
    setFilters((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  if (items.length === 0) {
    return (
      <Empty className="border bg-card shadow-raised">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImagesIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No artwork yet</EmptyTitle>
          <EmptyDescription>
            {readOnly
              ? 'No artwork was added before the art was locked.'
              : 'Add the finished images for your collection. Each file can have several editions and its own attributes.'}
          </EmptyDescription>
        </EmptyHeader>
        {!readOnly && (
          <EmptyContent className="max-w-xl">
            <DropZone
              className="w-full"
              onFiles={add}
              title="Drop images here or choose files"
              hint={ASSET_RULES_COPY}
            />
            <FilePickerButton onFiles={add} variant="default">
              <PlusIcon aria-hidden="true" />
              Choose images
            </FilePickerButton>
            <NameAttributeSwitch on={nameAttribute} onChange={setNameAttribute} />
          </EmptyContent>
        )}
      </Empty>
    )
  }

  return (
    <div className="space-y-6">
      {!readOnly && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <DropZone
              compact
              className="min-w-0 flex-1 basis-80"
              onFiles={add}
              title="Drop more images or choose files"
              hint={ASSET_RULES_COPY}
            />
            <FilePickerButton onFiles={add} variant="secondary">
              <PlusIcon aria-hidden="true" />
              Add images
            </FilePickerButton>
          </div>
          <NameAttributeSwitch on={nameAttribute} onChange={setNameAttribute} />
        </div>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <AssetFilters
          traits={traits}
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={setSort}
          filters={filters}
          onToggleFilter={toggleFilter}
          onClear={() => setFilters(new Set())}
        />
        <div className="min-w-0 space-y-4">
          {!readOnly && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-raised">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {selected.size > 0 ? (
                  <>
                    <span className="numeric text-foreground">{selected.size.toLocaleString('en-US')}</span>{' '}
                    selected
                  </>
                ) : (
                  <>
                    <span className="numeric text-foreground">{visible.length.toLocaleString('en-US')}</span>{' '}
                    of <span className="numeric">{items.length.toLocaleString('en-US')}</span> files match
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={visible.length === 0}
                  onClick={() => setPicked(new Set(visible.map((item) => item.key)))}
                >
                  Select all <span className="numeric">{visible.length.toLocaleString('en-US')}</span>
                </Button>
                {selected.size > 0 && (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
                      Clear selection
                    </Button>
                    <BulkEditionsDialog
                      count={selected.size}
                      onApply={(quantity) => handlers.onQuantityMany(keys, quantity)}
                    />
                    <BulkAttributeDialog
                      count={selected.size}
                      onSet={(attribute) => handlers.onApplyAttribute(keys, attribute)}
                      onClear={(traitType) => handlers.onClearTraitType(keys, traitType)}
                    />
                    <BulkRemoveButton count={selected.size} onConfirm={() => handlers.onRemoveMany(keys)} />
                  </>
                )}
              </div>
            </div>
          )}
          {visible.length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-raised">
              No artwork matches. Clear the search or the trait filters.
            </p>
          ) : (
            <AssetGrid
              key={`${search}|${sort}|${[...filters].join(',')}`}
              items={visible}
              selected={selected}
              meta={(item) => ({ ids: formatIds(ids.get(item.key) ?? []), rarity: ranks.get(item.key) })}
              actions={{
                editions: true,
                readOnly,
                editable: true,
                onQuantity: handlers.onQuantity,
                onAttributes: handlers.onAttributes,
                onRemove: handlers.onRemove,
                onSelect: toggle,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
