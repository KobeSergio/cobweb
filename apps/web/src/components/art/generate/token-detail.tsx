'use client'

import {
  ArrowLeftRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { Input } from '@cobweb/ui/components/input'
import { Label } from '@cobweb/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cobweb/ui/components/select'
import { Separator } from '@cobweb/ui/components/separator'
import type { GeneratedToken } from '@/lib/demo'
import { Composite } from '../composite'
import { compositeUrls, formatPercent } from '../lib/trait-index'
import { rarityTier } from '../state/token-logic'
import { RankBadge } from './rarity'
import type { Generator } from './use-generator'

export type TokenDetailProps = {
  token: GeneratedToken
  /** Ids in the gallery's current order, for previous and next. */
  order: number[]
  onOpen: (id: number | null) => void
  onDelete: (token: GeneratedToken) => void
  generator: Generator
  readOnly: boolean
  /** The heading element: a sheet title in the bottom sheet, a plain heading in the docked panel. */
  Heading: React.ElementType<{ id?: string; className?: string; children?: React.ReactNode }>
}

/**
 * One token up close: its traits and their rarity, and the edits a creator can make to it (trait
 * changes checked against the rules and uniqueness, swap, regenerate, delete). Laid out in one
 * column for the side panel and the bottom sheet.
 */
export function TokenDetail({
  token,
  order,
  onOpen,
  onDelete,
  generator,
  readOnly,
  Heading,
}: TokenDetailProps) {
  const { index, counts, tokens, collections } = generator
  const layers = generator.layersOf(token.collectionId)
  const total = tokens?.length ?? 0
  const [refusals, setRefusals] = useState<Record<number, string>>({})
  const [swapWith, setSwapWith] = useState('')
  const [swapError, setSwapError] = useState<string | null>(null)
  const at = order.indexOf(token.id)
  const prev = at > 0 ? order[at - 1] : undefined
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined
  const tier = rarityTier(token.rank, total)
  const collectionName =
    collections.length > 1 ? collections.find((c) => c.id === token.collectionId)?.name : undefined

  const swap = () => {
    const other = Number(swapWith)
    if (!Number.isInteger(other) || other < 1 || other > total) {
      setSwapError(`Enter a token id from 1 to ${total.toLocaleString('en-US')}.`)
      return
    }
    if (other === token.id) {
      setSwapError('Choose a different token.')
      return
    }
    generator.swap(token.id, other)
    toast(`Token #${token.id} is now #${other}`)
    onOpen(other)
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="space-y-1.5 pr-10">
        <Heading id="token-detail-title" className="text-title">
          {token.name}
        </Heading>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <RankBadge rank={token.rank} total={total} />
          <span>
            {collectionName && `${collectionName}, `}
            {tier.label}, rank <span className="numeric">{token.rank.toLocaleString('en-US')}</span> of{' '}
            <span className="numeric">{total.toLocaleString('en-US')}</span>
          </span>
        </p>
      </div>

      <div className="space-y-2">
        <Composite
          urls={compositeUrls(token.dna, index)}
          alt={`${token.name}: ${token.dna
            .map((id) => index.get(id)?.trait.name)
            .filter(Boolean)
            .join(', ')}`}
          seed={`token-${token.id}`}
          eager
          className="mx-auto w-full max-w-sm rounded-xl border"
        />
        <nav aria-label="Walk the tokens" className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={prev === undefined}
            onClick={() => prev !== undefined && onOpen(prev)}
          >
            <ChevronLeftIcon />
            Previous
          </Button>
          <span className="text-muted-foreground text-xs">
            <span className="numeric">{(at + 1).toLocaleString('en-US')}</span> of{' '}
            <span className="numeric">{order.length.toLocaleString('en-US')}</span> shown
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={next === undefined}
            onClick={() => next !== undefined && onOpen(next)}
          >
            Next
            <ChevronRightIcon />
          </Button>
        </nav>
      </div>

      <section aria-label="Traits" className="space-y-3">
        {layers.map((layer, layerIndex) => {
          const traitId = token.dna[layerIndex] ?? ''
          const trait = index.get(traitId)?.trait
          const share = total ? ((counts[traitId] ?? 0) / total) * 100 : 0
          const id = `token-trait-${layer.id}`
          return (
            <div key={layer.id} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={id} className="text-muted-foreground text-xs font-medium">
                  {layer.name}
                </Label>
                <span
                  className="numeric text-muted-foreground text-xs"
                  title="Tokens in the set with this trait"
                >
                  {formatPercent(Math.round(share * 10) / 10)}
                </span>
              </div>
              {readOnly ? (
                <p id={id} className="text-sm font-medium">
                  {trait?.name ?? 'Removed trait'}
                </p>
              ) : (
                <Select
                  value={traitId}
                  onValueChange={(value) => {
                    const outcome = generator.change(token.id, layerIndex, value)
                    setRefusals((current) => {
                      const nextRefusals = { ...current }
                      if (outcome.ok) delete nextRefusals[layerIndex]
                      else nextRefusals[layerIndex] = outcome.reason
                      return nextRefusals
                    })
                  }}
                >
                  <SelectTrigger
                    id={id}
                    className="h-9 w-full"
                    aria-describedby={refusals[layerIndex] ? `${id}-error` : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {layer.traits.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                        {option.constant ? ` (up to ${option.constant.toLocaleString('en-US')})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {refusals[layerIndex] && (
                <p
                  id={`${id}-error`}
                  role="alert"
                  className="text-destructive-foreground flex items-start gap-1.5 text-xs"
                >
                  <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                  {refusals[layerIndex]}
                </p>
              )}
            </div>
          )
        })}
      </section>

      {!readOnly && (
        <>
          <Separator />
          <section aria-label="Edit this token" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="swap-with">Swap position with</Label>
              <div className="flex gap-2">
                <Input
                  id="swap-with"
                  type="number"
                  min={1}
                  max={total}
                  placeholder="Token id"
                  value={swapWith}
                  onChange={(event) => {
                    setSwapWith(event.target.value)
                    setSwapError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      swap()
                    }
                  }}
                  aria-invalid={!!swapError}
                  aria-describedby={swapError ? 'swap-error' : 'swap-help'}
                  className="h-9"
                />
                <Button variant="secondary" className="h-9" onClick={swap}>
                  <ArrowLeftRightIcon />
                  Swap
                </Button>
              </div>
              {swapError ? (
                <p id="swap-error" role="alert" className="text-destructive-foreground text-xs">
                  {swapError}
                </p>
              ) : (
                <p id="swap-help" className="text-muted-foreground text-xs">
                  The two tokens trade ids. Their traits stay the same.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const ok = generator.regenerate(new Set([token.id]))
                  setRefusals({})
                  toast(
                    ok
                      ? `Token #${token.id} regenerated`
                      : 'No new unique combination fits the rules. Nothing changed.',
                  )
                }}
              >
                <RefreshCwIcon />
                Regenerate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive-foreground hover:text-destructive-foreground"
                onClick={() => onDelete(token)}
              >
                <Trash2Icon />
                Delete token
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
