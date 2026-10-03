'use client'

import { SearchIcon, XIcon } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cobweb/ui/components/accordion'
import { Button } from '@cobweb/ui/components/button'
import { Checkbox } from '@cobweb/ui/components/checkbox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@cobweb/ui/components/input-group'
import { Label } from '@cobweb/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cobweb/ui/components/select'
import type { Layer, TraitCounts } from '@/lib/demo'

export type Sort = 'id' | 'rank' | 'rank-desc'

/** Search by id, sort, and filter by trait: any of the ticked traits within a layer, all layers at once. */
export function FilterSidebar({
  layers,
  counts,
  search,
  onSearch,
  sort,
  onSort,
  filters,
  onToggleFilter,
  onClear,
}: {
  layers: Layer[]
  counts: TraitCounts
  search: string
  onSearch: (value: string) => void
  sort: Sort
  onSort: (sort: Sort) => void
  filters: ReadonlySet<string>
  onToggleFilter: (traitId: string) => void
  onClear: () => void
}) {
  return (
    <aside aria-label="Find tokens" className="bg-card rounded-xl border shadow-raised">
      <div className="space-y-4 border-b p-4">
        <div className="space-y-2">
          <Label htmlFor="token-search">Token id</Label>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id="token-search"
              inputMode="numeric"
              placeholder="For example 42"
              value={search}
              onChange={(event) => onSearch(event.target.value.replace(/[^0-9]/g, ''))}
              className="numeric"
            />
          </InputGroup>
        </div>
        <div className="space-y-2">
          <Label htmlFor="token-sort">Sort by</Label>
          <Select value={sort} onValueChange={(value) => onSort(value as Sort)}>
            <SelectTrigger id="token-sort" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="id">Token id</SelectItem>
              <SelectItem value="rank">Rarest first</SelectItem>
              <SelectItem value="rank-desc">Most common first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <p className="text-sm font-medium">Traits</p>
        {filters.size > 0 && (
          <Button variant="ghost" size="xs" onClick={onClear}>
            <XIcon />
            Clear <span className="numeric">{filters.size}</span>
          </Button>
        )}
      </div>
      <Accordion type="multiple" className="px-4 pb-2">
        {layers.map((layer) => {
          const active = layer.traits.filter((trait) => filters.has(trait.id)).length
          return (
            <AccordionItem key={layer.id} value={layer.id}>
              <AccordionTrigger className="py-3 text-sm">
                <span className="flex items-center gap-2">
                  {layer.name}
                  {active > 0 && (
                    <span className="bg-primary-soft text-primary numeric rounded-full px-1.5 text-xs">
                      {active}
                    </span>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <ul className="space-y-0.5">
                  {[...layer.traits]
                    .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
                    .map((trait) => {
                      const id = `filter-${trait.id}`
                      return (
                        <li
                          key={trait.id}
                          className="hover:bg-surface-2 flex items-center gap-2.5 rounded-sm px-1.5 py-1"
                        >
                          <Checkbox
                            id={id}
                            checked={filters.has(trait.id)}
                            onCheckedChange={() => onToggleFilter(trait.id)}
                          />
                          <label
                            htmlFor={id}
                            className="text-foreground min-w-0 flex-1 cursor-pointer truncate text-[0.8125rem]"
                          >
                            {trait.name}
                          </label>
                          <span className="numeric text-muted-foreground text-xs">
                            {(counts[trait.id] ?? 0).toLocaleString('en-US')}
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
    </aside>
  )
}
