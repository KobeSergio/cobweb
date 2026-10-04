import { TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
import { Stat, StatGroup } from '@cobweb/ui/components/stat'
import { cn } from '@cobweb/ui/lib/utils'
import { cappedShortfalls } from '@/lib/demo/art'
import type { Collection, GeneratedToken, Layer, TraitCounts } from '@/lib/demo'
import { Composite } from '../composite'
import { expectedCount, formatCount } from '../lib/trait-index'

/** Off by more than this share of the expected count, and by at least 3 tokens, reads as a deviation. */
const TOLERANCE = 0.25

/**
 * The metadata view: how each layer's traits came out against what the weights asked for. Each
 * layer is measured against its own collection's tokens.
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
  const total = tokens.length
  const used = layers.reduce(
    (n, layer) => n + layer.traits.filter((trait) => (counts[trait.id] ?? 0) > 0).length,
    0,
  )
  const all = layers.reduce((n, layer) => n + layer.traits.length, 0)
  // A maximum count is a cap (MASTER_PLAN, Art: maximum counts); say so when a capped trait came out below it.
  const short = total > 0 ? cappedShortfalls(layers, counts) : []
  const shortIds = new Set(short.map((entry) => entry.trait.id))
  const several = collections.length > 1
  const nameOf = (id: string) => collections.find((c) => c.id === id)?.name ?? ''

  return (
    <div className="space-y-6">
      <section className="bg-card rounded-xl border p-6 shadow-raised" aria-label="Summary">
        <StatGroup>
          <Stat label="Tokens" value={total.toLocaleString('en-US')} />
          <Stat
            label="Traits in use"
            value={used.toLocaleString('en-US')}
            suffix={`/ ${all.toLocaleString('en-US')}`}
          />
          <Stat label="Layers" value={layers.length.toLocaleString('en-US')} />
          <Stat
            label="Rules applied"
            value={(ruleCount - skippedRules).toLocaleString('en-US')}
            suffix={`/ ${ruleCount.toLocaleString('en-US')}`}
            hint={skippedRules ? `${skippedRules} skipped for a conflict` : undefined}
          />
        </StatGroup>
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
        {layers.map((layer) => {
          const own = perCollection.get(layer.collectionId) ?? 0
          const title = several ? `${nameOf(layer.collectionId)}: ${layer.name}` : layer.name
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
              <h3 id={`stats-${layer.id}`} className="text-heading border-b px-5 py-3.5">
                {title}
              </h3>
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
      <p className="text-muted-foreground text-xs">
        The tick marks the expected count from the weights, or the maximum for a capped trait. Rules and
        maximum counts pull some traits away from it; large gaps are marked.
      </p>
    </div>
  )
}
