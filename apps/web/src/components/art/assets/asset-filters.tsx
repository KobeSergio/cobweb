'use client'

import { SearchIcon, XIcon } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cobweb/ui/components/accordion'
import { Button } from '@cobweb/ui/components/button'
import { Checkbox } from '@cobweb/ui/components/checkbox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@cobweb/ui/components/input-group'
import { Label } from '@cobweb/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cobweb/ui/components/select'
import type { AssetSort, TraitTypeSummary } from './token-list'

const percent = (share: number) =>
  `${(share * 100).toLocaleString('en-US', { maximumFractionDigits: share < 0.01 ? 2 : 1 })}%`

/**
 * Find artworks, and the metadata view for 1/1s (legacy `Sidebar` and `MetadataView`): search by
 * file name, sort by upload order, rarity or name, and every trait type with each value's token
 * count and share. Ticking values filters the grid: any value within a trait type, every trait
 * type at once.
 */
export function AssetFilters({
  traits,
  search,
  onSearch,
  sort,
  onSort,
  filters,
  onToggleFilter,
  onClear,
}: {
  traits: TraitTypeSummary[]
  search: string
  onSearch: (value: string) => void
  sort: AssetSort
  onSort: (sort: AssetSort) => void
  filters: ReadonlySet<string>
  onToggleFilter: (key: string) => void
  onClear: () => void
}) {
  return (
    <aside aria-label="Find artworks" className="rounded-xl border bg-card shadow-raised">
      <div className="space-y-4 border-b p-4">
        <div className="space-y-2">
          <Label htmlFor="asset-search">File name</Label>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id="asset-search"
              placeholder="Search files"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </InputGroup>
        </div>
        <div className="space-y-2">
          <Label htmlFor="asset-sort">Sort by</Label>
          <Select value={sort} onValueChange={(value) => onSort(value as AssetSort)}>
            <SelectTrigger id="asset-sort" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upload">Token id</SelectItem>
              <SelectItem value="rarity">Rarest first</SelectItem>
              <SelectItem value="name">File name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <p className="text-sm font-medium">Traits</p>
        {filters.size > 0 && (
          <Button variant="ghost" size="xs" onClick={onClear}>
            <XIcon aria-hidden="true" />
            Clear <span className="numeric">{filters.size}</span>
          </Button>
        )}
      </div>
      {traits.length === 0 ? (
        <p className="px-4 pt-1 pb-4 text-[0.8125rem] text-muted-foreground">
          No attributes yet. Add them to an artwork, or to several at once from the selection bar.
        </p>
      ) : (
        <Accordion type="multiple" className="px-4 pb-2">
          {traits.map((type) => {
            const active = type.values.filter((value) => filters.has(value.key)).length
            return (
              <AccordionItem key={type.traitType.toLowerCase()} value={type.traitType.toLowerCase()}>
                <AccordionTrigger className="py-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{type.traitType}</span>
                    <span className="numeric text-xs font-normal text-muted-foreground">
                      {type.values.length.toLocaleString('en-US')}
                    </span>
                    {active > 0 && (
                      <span className="numeric rounded-full bg-primary-soft px-1.5 text-xs text-primary">
                        {active}
                      </span>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <ul className="max-h-72 space-y-0.5 overflow-y-auto">
                    {type.values.map((value) => {
                      const id = `asset-filter-${encodeURIComponent(value.key)}`
                      return (
                        <li
                          key={value.key}
                          className="flex items-center gap-2.5 rounded-sm px-1.5 py-1 hover:bg-surface-2"
                        >
                          <Checkbox
                            id={id}
                            checked={filters.has(value.key)}
                            onCheckedChange={() => onToggleFilter(value.key)}
                          />
                          <label
                            htmlFor={id}
                            title={value.value}
                            className="min-w-0 flex-1 cursor-pointer truncate text-[0.8125rem] text-foreground"
                          >
                            {value.value}
                          </label>
                          <span className="numeric text-xs text-muted-foreground">
                            {value.count.toLocaleString('en-US')}
                            <span className="sr-only"> tokens,</span>{' '}
                            <span className="text-muted-foreground/80">{percent(value.share)}</span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
    </aside>
  )
}
