'use client'

import { TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cobweb/ui/components/select'
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import { cn } from '@cobweb/ui/lib/utils'
import { cappedShortfalls } from '@cobweb/dna'
import type { Collection, GeneratedToken, Layer, TraitCounts } from '@/lib/demo'
import { Composite } from '../composite'
import { expectedCount, formatCount } from '../lib/trait-index'

/** Off by more than this share of the expected count, and by at least 3 tokens, reads as a deviation. */
const TOLERANCE = 0.25

/**
 * The Statistics tab: how each layer's traits came out against what the weights asked for, one
 * collection at a time (a dropdown when there are several). Each layer is measured against its own
 * collection's tokens. Opens on a compact summary with the bar legend, then the layers, so the
 * first view shows real rows without scrolling.
 */
export function StatsView({
  collections,
  perCollection,
  layers,
  tokens,
  counts,
  ruleCount,
  skippedRules,
}: {
  collections: Collection[]
  /** Tokens per collection id. */
  perCollection: ReadonlyMap<string, number>
  layers: Layer[]
  tokens: GeneratedToken[]
  counts: TraitCounts
  ruleCount: number
  skippedRules: number
}) {
  const several = collections.length > 1
  // One collection at a time, so the first view is one collection's layers rather than a long page.
  const [picked, setPicked] = useState(collections[0]?.id ?? '')
  const shownId = collections.some((c) => c.id === picked) ? picked : (collections[0]?.id ?? '')
  const shownLayers = several ? layers.filter((layer) => layer.collectionId === shownId) : layers
  const total = several ? (perCollection.get(shownId) ?? 0) : tokens.length
  const used = shownLayers.reduce(
    (n, layer) => n + layer.traits.filter((trait) => (counts[trait.id] ?? 0) > 0).length,
    0,
  )
  const all = shownLayers.reduce((n, layer) => n + layer.traits.length, 0)
  // A maximum count is a cap (MASTER_PLAN, Art: maximum counts); say so when a capped trait came out below it.
  const short = total > 0 ? cappedShortfalls(shownLayers, counts) : []
  const shortIds = new Set(short.map((entry) => entry.trait.id))

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-heading">Trait statistics</h3>
          <p className="text-muted-foreground text-[0.8125rem]">
            How often each trait came out against what its weight predicts, per collection
          </p>
        </div>
        {several && (
          <Select value={shownId} onValueChange={setPicked}>
            <SelectTrigger aria-label="Collection" size="sm" className="min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {collections.map((collection) => (
                <SelectItem key={collection.id} value={collection.id}>
                  {collection.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>

      <section
        aria-label="Summary"
        className="bg-card flex flex-wrap items-center justify-between gap-x-10 gap-y-4 rounded-xl border px-5 py-4 shadow-raised"
      >
        <StatGroup className="gap-x-8">
          <Stat size="sm" label="Tokens" value={total.toLocaleString('en-US')} />
          <Stat
            size="sm"
            label="Traits in use"
            value={used.toLocaleString('en-US')}
            suffix={`/ ${all.toLocaleString('en-US')}`}
          />
          <Stat size="sm" label="Layers" value={shownLayers.length.toLocaleString('en-US')} />
          <Stat
            size="sm"
            label="Rules applied"
            value={(ruleCount - skippedRules).toLocaleString('en-US')}
            suffix={`/ ${ruleCount.toLocaleString('en-US')}`}
          />
        </StatGroup>
        <Legend />
      </section>

      {short.length > 0 && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>
            {short.length === 1
              ? 'A trait came out below its maximum count'
              : `${short.length} traits came out below their maximum count`}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {short.map(({ trait, cap, actual }) => (
                <li key={trait.id}>
                  {trait.name} is on <span className="numeric">{actual.toLocaleString('en-US')}</span> of up
                  to <span className="numeric">{cap.toLocaleString('en-US')}</span> tokens.
                </li>
              ))}
            </ul>
            <p className="mt-2">
              A maximum count is a cap: rules and unique combinations kept these traits below it. You can lock
              the set as it is, or loosen a rule and generate again.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {shownLayers.map((layer) => {
          const own = perCollection.get(layer.collectionId) ?? 0
          const title = layer.name
          const rows = layer.traits.map((trait) => ({
            trait,
            expected: expectedCount(layer, trait, own),
            actual: counts[trait.id] ?? 0,
          }))
          const scale = Math.max(1, ...rows.map((row) => Math.max(row.expected, row.actual)))
          return (
            <section
              key={layer.id}
              aria-labelledby={`stats-${layer.id}`}
              className="bg-card rounded-xl border shadow-raised"
            >
              <h4 id={`stats-${layer.id}`} className="text-heading border-b px-5 py-3.5">
                {title}
              </h4>
              <table className="w-full text-sm">
                <caption className="sr-only">{title}: expected and generated count of each trait</caption>
                <thead>
                  <tr className="text-muted-foreground text-xs">
                    <th scope="col" className="py-2 pl-5 text-left font-medium">
                      Trait
                    </th>
                    <th scope="col" className="hidden w-[38%] py-2 text-left font-medium sm:table-cell">
                      <span className="sr-only">Distribution</span>
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Expected
                    </th>
                    <th scope="col" className="py-2 pr-5 text-right font-medium">
                      Generated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ trait, expected, actual }) => {
                    const below = shortIds.has(trait.id)
                    const off =
                      below ||
                      (Math.abs(actual - expected) >= 3 && Math.abs(actual - expected) > expected * TOLERANCE)
                    return (
                      <tr key={trait.id} className="border-t">
                        <th scope="row" className="py-2 pl-5 text-left font-normal">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Composite
                              urls={trait.imageUrl ? [trait.imageUrl] : []}
                              alt=""
                              seed={trait.id}
                              className="size-7 shrink-0 rounded-sm border"
                            />
                            <span className="truncate">{trait.name}</span>
                            {trait.constant && (
                              <span
                                className={cn(
                                  'shrink-0 text-xs',
                                  below ? 'text-warning-foreground' : 'text-muted-foreground',
                                )}
                              >
                                {below ? 'below its cap' : 'capped'}
                              </span>
                            )}
                          </span>
                        </th>
                        <td className="hidden py-2 pr-4 sm:table-cell">
                          <span
                            aria-hidden="true"
                            className="bg-well relative block h-2 rounded-full shadow-inset"
                          >
                            <span
                              className={cn(
                                'absolute inset-y-0 left-0 rounded-full',
                                off ? 'bg-warning/80' : 'bg-muted-foreground/70',
                              )}
                              style={{ width: `${(actual / scale) * 100}%` }}
                            />
                            {/* The expected count, as a tick. */}
                            <span
                              className="bg-foreground absolute -inset-y-1 w-0.5 rounded-full"
                              style={{ left: `calc(${(expected / scale) * 100}% - 1px)` }}
                            />
                          </span>
                        </td>
                        <td className="text-muted-foreground py-2 text-right">
                          {trait.constant && 'up to '}
                          <span className="numeric">{formatCount(expected)}</span>
                        </td>
                        <td className={cn('numeric py-2 pr-5 text-right', off && 'text-warning-foreground')}>
                          {formatCount(actual)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** How to read a row's bar: the fill is what came out, the tick what the weight predicts. */
function Legend() {
  return (
    <ul className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="bg-muted-foreground/70 h-2 w-5 rounded-full" />
        Generated
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="bg-foreground h-3.5 w-0.5 rounded-full" />
        Expected, or the cap
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="bg-warning/80 h-2 w-5 rounded-full" />
        Far from expected
      </li>
    </ul>
  )
}
