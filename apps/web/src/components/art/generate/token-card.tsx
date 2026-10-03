'use client'

import { CheckIcon, TriangleAlertIcon } from 'lucide-react'
import { memo } from 'react'
import { cn } from '@cobweb/ui/lib/utils'
import type { GeneratedToken } from '@/lib/demo'
import { Composite } from '../composite'
import { compositeUrls, type TraitIndex } from '../lib/trait-index'
import { RankBadge } from './rarity'

/** One token in the gallery: its composite, rank and id. Opens the detail, or toggles in select mode. */
export const TokenCard = memo(function TokenCard({
  token,
  total,
  index,
  selectMode,
  selected,
  breaksRule,
  onOpen,
  onToggle,
}: {
  token: GeneratedToken
  total: number
  index: TraitIndex
  selectMode: boolean
  selected: boolean
  breaksRule: boolean
  onOpen: (id: number) => void
  onToggle: (id: number) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => (selectMode ? onToggle(token.id) : onOpen(token.id))}
        aria-pressed={selectMode ? selected : undefined}
        aria-label={`Token ${token.id}, rank ${token.rank} of ${total}${breaksRule ? ', breaks a rule' : ''}`}
        className={cn(
          'group/token bg-surface-2 focus-visible:ring-ring focus-visible:ring-offset-background block w-full overflow-hidden rounded-lg border text-left shadow-raised outline-none',
          'transition-[transform,box-shadow,border-color] duration-150 ease-out',
          'hover:border-border-strong hover:shadow-lifted hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-offset-2',
          selected && 'border-primary hover:border-primary',
        )}
      >
        <Composite urls={compositeUrls(token.dna, index)} alt="" seed={`token-${token.id}`}>
          <RankBadge rank={token.rank} total={total} onArt className="absolute top-2 left-2" />
          {selectMode && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-2 right-2 flex size-5 items-center justify-center rounded-xs border shadow-raised transition-colors',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background/80 backdrop-blur-sm',
              )}
            >
              {selected && <CheckIcon className="size-3.5" strokeWidth={3} />}
            </span>
          )}
          {selected && <span aria-hidden="true" className="bg-primary-soft absolute inset-0" />}
        </Composite>
        <span className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="numeric text-sm font-medium">#{token.id.toLocaleString('en-US')}</span>
          {breaksRule && (
            <TriangleAlertIcon aria-hidden="true" className="text-warning-foreground size-3.5 shrink-0" />
          )}
        </span>
      </button>
    </li>
  )
})
