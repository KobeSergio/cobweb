'use client'

import { SearchIcon, SearchXIcon } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@cobweb/ui/components/input-group'
import { Stagger, StaggerItem } from '@cobweb/ui/components/motion'
import { ToggleGroup, ToggleGroupItem } from '@cobweb/ui/components/toggle-group'
import { CollectionCard } from '@/components/collections/collection-card'
import type { Tables } from '@/lib/database.types'
import { PROJECT_TYPES, type ProjectType } from '@/lib/collections'

type TypeFilter = 'all' | ProjectType

/** Why nothing is shown, and what to try. */
function emptyMessage(query: string, type: TypeFilter): string {
  const typeName = PROJECT_TYPES.find((entry) => entry.value === type)?.name
  if (!query) return `You have no ${typeName} collections yet. Show every type to see the rest.`
  const among = typeName ? ` among your ${typeName} collections` : ''
  return `No name or symbol contains "${query}"${among}. Try another search.`
}

/**
 * The creator's collections with a search (name or symbol) and a filter by project type, both
 * over the collections already loaded. The type filter follows `PROJECT_TYPES`.
 */
export function CollectionsBrowser({ collections }: { collections: Tables<'collections'>[] }) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const deferredQuery = useDeferredValue(query)

  const shown = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase()
    return collections.filter(
      (collection) =>
        (type === 'all' || collection.project_type === type) &&
        (!needle ||
          collection.name.toLowerCase().includes(needle) ||
          collection.symbol.toLowerCase().includes(needle)),
    )
  }, [collections, deferredQuery, type])

  const filtering = query.trim() !== '' || type !== 'all'
  const clear = () => {
    setQuery('')
    setType('all')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InputGroup className="w-full max-w-xs">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or symbol"
            aria-label="Search collections by name or symbol"
            autoComplete="off"
          />
        </InputGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={type}
          onValueChange={(value) => value && setType(value as TypeFilter)}
          aria-label="Show collections of a type"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          {PROJECT_TYPES.map((entry) => (
            <ToggleGroupItem key={entry.value} value={entry.value}>
              {entry.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <p aria-live="polite" className="sr-only">
        {filtering ? `${shown.length} of ${collections.length} collections shown.` : ''}
      </p>

      {shown.length === 0 ? (
        <Empty className="bg-card rounded-xl border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>No collections match</EmptyTitle>
            <EmptyDescription>{emptyMessage(deferredQuery.trim(), type)}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="secondary" onClick={clear}>
              Clear search and filter
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        // Keyed by the filter so the grid arrives again when the set changes, not on every keystroke.
        <Stagger key={type} className="3xl:grid-cols-4 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((collection) => (
            <StaggerItem key={collection.id}>
              <CollectionCard collection={collection} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  )
}
