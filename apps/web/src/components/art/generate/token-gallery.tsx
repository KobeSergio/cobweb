'use client'

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ListChecksIcon,
  RefreshCwIcon,
  ShuffleIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { cn } from '@cobweb/ui/lib/utils'
import type { GeneratedToken } from '@/lib/demo'
import { ConfirmDialog, type ConfirmRequest } from '../confirm-dialog'
import { FilterSidebar, type Sort } from './filter-sidebar'
import { TierLegend } from './rarity'
import { TokenCard } from './token-card'
import { TokenPanel } from './token-panel'
import type { Generator } from './use-generator'

const PAGE_SIZE = 48

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

/**
 * The set as a paged grid with search, sort, a collection filter, trait filters, select mode and
 * the token detail, docked beside the grid while a token is open.
 */
export function TokenGallery({ generator, readOnly }: { generator: Generator; readOnly: boolean }) {
  const tokens = generator.tokens ?? []
  const { counts, index, collections } = generator
  const [collectionFilter, setCollectionFilter] = useState<string>('all')
  const filteredCollection = collections.some((c) => c.id === collectionFilter) ? collectionFilter : 'all'
  const layers = filteredCollection === 'all' ? generator.layers : generator.layersOf(filteredCollection)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('id')
  const [filters, setFilters] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [openId, setOpenId] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const breaking = useMemo(() => new Set(generator.breaking), [generator.breaking])

  const shown = useMemo(() => {
    // Within a layer any ticked trait matches; every layer with ticks must match. Trait ids are
    // unique in the project, so a ticked trait only ever matches tokens of its own collection.
    const byLayer = layers
      .map((layer) => layer.traits.filter((trait) => filters.has(trait.id)).map((trait) => trait.id))
      .filter((ids) => ids.length > 0)
    const list = tokens.filter(
      (token) =>
        (filteredCollection === 'all' || token.collectionId === filteredCollection) &&
        (!search || String(token.id).startsWith(search)) &&
        byLayer.every((ids) => ids.some((id) => token.dna.includes(id))),
    )
    if (sort === 'rank') list.sort((a, b) => a.rank - b.rank)
    else if (sort === 'rank-desc') list.sort((a, b) => b.rank - a.rank)
    else list.sort((a, b) => a.id - b.id)
    return list
  }, [tokens, layers, filters, search, sort, filteredCollection])

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const pageTokens = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const order = useMemo(() => shown.map((token) => token.id), [shown])
  const openToken = tokens.find((token) => token.id === openId) ?? null

  const toggle = useCallback(
    (id: number) =>
      setSelected((set) => {
        const next = new Set(set)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    [],
  )
  const open = useCallback((id: number) => setOpenId(id), [])
  const resetView = () => setPage(0)
  const goTo = (target: number) => {
    setPage(target)
    document.getElementById('token-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const finishBulk = () => {
    setSelected(new Set())
    setSelectMode(false)
  }

  const askDelete = (ids: Set<number>, after?: () => void) =>
    setConfirm({
      title: ids.size === 1 ? `Delete token #${[...ids][0]}?` : `Delete ${plural(ids.size, 'token')}?`,
      body: [
        'Later tokens move up to close the gap, so ids stay 1 to N. You can fill the set back up to the supply afterwards.',
      ],
      confirmLabel: ids.size === 1 ? 'Delete token' : `Delete ${plural(ids.size, 'token')}`,
      destructive: true,
      onConfirm: () => {
        generator.remove(ids)
        toast(`${plural(ids.size, 'token')} deleted`)
        after?.()
      },
    })

  return (
    <div
      className={cn(
        'grid items-start gap-6',
        // The open token docks in a third column from 1024px (`DOCKED_QUERY`); below it is a bottom sheet.
        openToken
          ? 'lg:grid-cols-[13rem_minmax(0,1fr)_20rem] xl:grid-cols-[15rem_minmax(0,1fr)_23rem]'
          : 'lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16.5rem_minmax(0,1fr)]',
      )}
    >
      <FilterSidebar
        collections={collections}
        collectionFilter={filteredCollection}
        onCollectionFilter={(value) => {
          setCollectionFilter(value)
          setFilters(new Set())
          resetView()
        }}
        layers={layers}
        counts={counts}
        search={search}
        onSearch={(value) => {
          setSearch(value)
          resetView()
        }}
        sort={sort}
        onSort={(value) => {
          setSort(value)
          resetView()
        }}
        filters={filters}
        onToggleFilter={(id) => {
          setFilters((set) => {
            const next = new Set(set)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
          resetView()
        }}
        onClear={() => {
          setFilters(new Set())
          resetView()
        }}
      />

      <div id="token-results" className="min-w-0 scroll-mt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1.5">
            <p className="text-sm" aria-live="polite">
              {shown.length === tokens.length ? (
                <>
                  All <span className="numeric">{tokens.length.toLocaleString('en-US')}</span> tokens
                </>
              ) : (
                <>
                  <span className="numeric">{shown.length.toLocaleString('en-US')}</span> of{' '}
                  <span className="numeric">{tokens.length.toLocaleString('en-US')}</span> tokens match
                </>
              )}
            </p>
            <TierLegend />
          </div>
          {!readOnly && (
            <Button
              variant={selectMode ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={selectMode}
              onClick={() => (selectMode ? finishBulk() : setSelectMode(true))}
            >
              {selectMode ? <XIcon /> : <ListChecksIcon />}
              {selectMode ? 'Done selecting' : 'Select'}
            </Button>
          )}
        </div>

        {selectMode && (
          <div
            role="toolbar"
            aria-label="Selected tokens"
            className="bg-surface-2 border-border-strong sticky top-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 shadow-lifted"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span aria-live="polite">
                <span className="numeric">{selected.size.toLocaleString('en-US')}</span> selected
              </span>
              <Button
                variant="link"
                size="sm"
                className="text-foreground underline"
                onClick={() => setSelected(new Set([...selected, ...pageTokens.map((t) => t.id)]))}
              >
                Select page
              </Button>
              <Button
                variant="link"
                size="sm"
                className="text-foreground underline"
                onClick={() => setSelected(new Set(order))}
              >
                Select all <span className="numeric">{order.length.toLocaleString('en-US')}</span> shown
              </Button>
              {selected.size > 0 && (
                <Button
                  variant="link"
                  size="sm"
                  className="text-muted-foreground underline"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={selected.size === 0}
                onClick={() => {
                  const ok = generator.regenerate(selected)
                  toast(
                    ok
                      ? `${plural(selected.size, 'token')} regenerated`
                      : 'Not every selected token could get a new unique combination within the rules. Nothing changed.',
                  )
                  if (ok) finishBulk()
                }}
              >
                <RefreshCwIcon />
                Regenerate
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={selected.size < 2}
                onClick={() => {
                  generator.shuffle(selected)
                  toast(`Shuffled the order of ${plural(selected.size, 'token')}`)
                  finishBulk()
                }}
              >
                <ShuffleIcon />
                Shuffle order
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive-foreground hover:text-destructive-foreground"
                disabled={selected.size === 0}
                onClick={() => askDelete(new Set(selected), finishBulk)}
              >
                <Trash2Icon />
                Delete
              </Button>
            </div>
          </div>
        )}

        {shown.length === 0 ? (
          <div className="bg-card text-muted-foreground rounded-xl border border-dashed px-6 py-16 text-center text-sm">
            {search ? `No token id starts with ${search}.` : 'No token has this mix of traits.'}{' '}
            <button
              type="button"
              className="text-foreground underline underline-offset-2 hover:no-underline"
              onClick={() => {
                setSearch('')
                setFilters(new Set())
              }}
            >
              Clear search and filters
            </button>
          </div>
        ) : (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-4 xl:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]"
            aria-label="Tokens"
          >
            {pageTokens.map((token: GeneratedToken) => (
              <TokenCard
                key={token.id}
                token={token}
                total={tokens.length}
                index={index}
                selectMode={selectMode}
                selected={selected.has(token.id)}
                current={token.id === openId}
                breaksRule={breaking.has(token.id)}
                onOpen={open}
                onToggle={toggle}
              />
            ))}
          </ul>
        )}

        {pageCount > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 pt-2">
            <Button variant="outline" size="sm" disabled={current === 0} onClick={() => goTo(current - 1)}>
              <ChevronLeftIcon />
              Previous
            </Button>
            <p className="text-muted-foreground text-sm">
              Page <span className="numeric text-foreground">{current + 1}</span> of{' '}
              <span className="numeric">{pageCount}</span>
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={current >= pageCount - 1}
              onClick={() => goTo(current + 1)}
            >
              Next
              <ChevronRightIcon />
            </Button>
          </nav>
        )}
      </div>

      <TokenPanel
        token={openToken}
        order={order}
        onOpen={setOpenId}
        onDelete={(token) => askDelete(new Set([token.id]), () => setOpenId(null))}
        generator={generator}
        readOnly={readOnly}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
