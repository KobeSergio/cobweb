'use client'

import { useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { AssetCard, type AssetCardActions } from './asset-card'
import type { AssetItem } from './types'

const PAGE = 48

/** The uploaded artworks as a responsive grid. Large sets show 48 at a time. */
export function AssetGrid({ items, actions }: { items: AssetItem[]; actions: AssetCardActions }) {
  const [shown, setShown] = useState(PAGE)
  const visible = items.slice(0, shown)
  return (
    <div className="space-y-5">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-5">
        {visible.map((item) => (
          <AssetCard key={item.key} item={item} actions={actions} />
        ))}
      </ul>
      {items.length > shown && (
        <div className="flex items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            Showing <span className="numeric text-foreground">{shown.toLocaleString('en-US')}</span> of{' '}
            <span className="numeric text-foreground">{items.length.toLocaleString('en-US')}</span>
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setShown((count) => count + PAGE)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  )
}
