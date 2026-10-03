'use client'

import { PencilIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react'
import { Badge } from '@cobweb/ui/components/badge'
import { Button } from '@cobweb/ui/components/button'
import { cn } from '@cobweb/ui/lib/utils'
import type { ArtRule } from '@/lib/demo'
import type { TraitIndex } from '../lib/trait-index'
import { ruleSentence } from '../state/rule-logic'
import { TraitChip } from './trait-chip'

const DIRECTION: Record<ArtRule['kind'], (source: string) => string> = {
  "doesn't mix with": () => 'Both ways: neither side appears with the other.',
  'always pairs with': (source) =>
    `Both ways: ${source} appears only with these, and they only with ${source}.`,
  'must pair with': (source) => `One way: ${source} needs one of these. They can still appear without it.`,
}

/** A rule read as a sentence, with the traits it names shown as thumbnails. */
export function RuleRow({
  rule,
  index,
  inConflict,
  highlighted,
  onEdit,
  onDelete,
  readOnly,
}: {
  rule: ArtRule
  index: TraitIndex
  inConflict: boolean
  highlighted: boolean
  onEdit: () => void
  onDelete: () => void
  readOnly: boolean
}) {
  const source = index.get(rule.traitId)
  const relatedLayers = [
    ...new Set(rule.relatedTraitIds.map((id) => index.get(id)?.layer.name).filter(Boolean)),
  ]
  const sourceName = source?.trait.name ?? 'This trait'

  return (
    <li
      id={`rule-${rule.id}`}
      tabIndex={-1}
      className={cn(
        'relative flex scroll-mt-24 flex-col gap-3 rounded-lg border p-4 outline-none transition-[box-shadow,background-color] duration-300 sm:flex-row sm:items-center sm:gap-5',
        inConflict ? 'bg-destructive-soft border-transparent' : 'bg-surface-2/50',
        highlighted && 'ring-ring ring-offset-card ring-2 ring-offset-2',
      )}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div
          role="group"
          className="flex flex-wrap items-center gap-2"
          aria-label={ruleSentence(rule, index)}
        >
          <TraitChip entry={source} />
          <span className="text-muted-foreground text-sm">{rule.kind}</span>
          {rule.relatedTraitIds.map((id, i) => (
            <span key={id} className="inline-flex items-center gap-2">
              {i > 0 &&
                (i === rule.relatedTraitIds.length - 1 ? (
                  <span className="text-muted-foreground text-sm">or</span>
                ) : (
                  <span aria-hidden="true" className="text-muted-foreground -ml-1.5 text-sm">
                    ,
                  </span>
                ))}
              <TraitChip entry={index.get(id)} />
            </span>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          {source?.layer.name} to {relatedLayers.join(', ')}. {DIRECTION[rule.kind](sourceName)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 self-end sm:self-center">
        {inConflict && (
          <Badge variant="destructive" className="mr-1">
            <TriangleAlertIcon aria-hidden="true" />
            In conflict
          </Badge>
        )}
        {!readOnly && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onEdit}
              aria-label={`Edit rule: ${ruleSentence(rule, index)}`}
            >
              <PencilIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              aria-label={`Delete rule: ${ruleSentence(rule, index)}`}
            >
              <Trash2Icon />
            </Button>
          </>
        )}
      </div>
    </li>
  )
}
