'use client'

import { Input } from '@cobweb/ui/components/input'
import { Label } from '@cobweb/ui/components/label'
import { cn } from '@cobweb/ui/lib/utils'
import type { Generator } from './use-generator'

const n = (value: number) => value.toLocaleString('en-US')

/**
 * One size per collection, and the supply they add up to. Token ids run on across collections in
 * this order: the first collection is 1 to its size, the next starts after it.
 */
export function CollectionSizes({ generator, readOnly }: { generator: Generator; readOnly: boolean }) {
  const { collections, perCollection, supply, tokens } = generator
  const several = collections.length > 1
  let firstId = 1

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
      {collections.map((collection) => {
        const have = perCollection.get(collection.id) ?? 0
        const from = firstId
        firstId += collection.size
        const id = `collection-size-${collection.id}`
        const off = !!tokens && tokens.length > 0 && have !== collection.size
        return (
          <div key={collection.id} className="space-y-1.5">
            <Label htmlFor={id}>{several ? `${collection.name} size` : 'Size'}</Label>
            {readOnly ? (
              <p id={id} className="numeric text-sm font-medium">
                {n(collection.size)}
              </p>
            ) : (
              <Input
                id={id}
                type="number"
                min={0}
                max={100000}
                step={1}
                value={collection.size}
                onChange={(event) => generator.setSize(collection.id, Number(event.target.value))}
                aria-describedby={`${id}-help`}
                className="h-9 w-32"
              />
            )}
            <p
              id={`${id}-help`}
              className={cn('text-xs', off ? 'text-warning-foreground' : 'text-muted-foreground')}
            >
              {collection.size > 0 ? (
                <>
                  Ids <span className="numeric">{n(from)}</span> to{' '}
                  <span className="numeric">{n(from + collection.size - 1)}</span>
                  {off && (
                    <>
                      , <span className="numeric">{n(have)}</span> generated
                    </>
                  )}
                </>
              ) : (
                'No tokens'
              )}
            </p>
          </div>
        )
      })}
      <p className="text-muted-foreground pb-6 text-sm" aria-live="polite">
        {several ? 'Supply, all collections: ' : 'Supply: '}
        <span className="numeric text-foreground font-medium">{n(supply)}</span> tokens
      </p>
    </div>
  )
}
