'use client'

import { CheckIcon, ImageUpIcon, ScaleIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@cobweb/ui/components/button'
import { Switch } from '@cobweb/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cobweb/ui/components/tooltip'
import { cn } from '@cobweb/ui/lib/utils'
import type { Layer, TraitCounts } from '@/lib/demo'
import { constantTotal, expectedCount, formatPercent, weightTotal } from '../lib/trait-index'
import { DropZone, UploadRules } from './add-traits-dialog'
import { TraitCard } from './trait-card'
import type { LayersEditor } from './use-layers-editor'

type Props = {
  layer: Layer
  position: number
  layerCount: number
  supply: number
  counts: TraitCounts
  generated: number
  previewTraitId: string | undefined
  onPreview: (traitId: string) => void
  onAddFiles: (files: File[]) => void
  editor: LayersEditor
  readOnly: boolean
}

/** The running total of a layer's weights against 100, with what to do about it. */
function WeightTotal({ layer, supply }: { layer: Layer; supply: number }) {
  const total = weightTotal(layer)
  const weighted = layer.traits.filter((trait) => !trait.constant)
  const fixed = constantTotal(layer)
  const diff = Math.round((100 - total) * 100) / 100
  const ok = weighted.length === 0 || Math.abs(diff) < 0.01
  const over = diff < 0

  return (
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium">
          Weights <span className="numeric">{formatPercent(total)}</span>
          <span className="text-muted-foreground font-normal"> of 100%</span>
        </p>
        <p
          aria-live="polite"
          className={cn(
            'flex items-center gap-1.5 text-[0.8125rem]',
            ok ? 'text-success-foreground' : over ? 'text-destructive-foreground' : 'text-warning-foreground',
          )}
        >
          {ok ? (
            <CheckIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
          )}
          {weighted.length === 0
            ? 'Every trait has a maximum count'
            : ok
              ? 'Adds up to 100%'
              : over
                ? `${formatPercent(-diff)} over. Lower a weight.`
                : `${formatPercent(diff)} left to assign`}
        </p>
      </div>
      {/* Each trait's share as one segment of a single colour, split by hairlines; hover names it.
          The bar repeats what the trait cards say, so it stays out of the accessibility tree. */}
      <div
        aria-hidden="true"
        className={cn(
          'bg-well flex h-2 overflow-hidden rounded-full shadow-inset',
          over && 'ring-destructive/60 ring-1',
        )}
      >
        {weighted.map((trait) => (
          <Tooltip key={trait.id}>
            <TooltipTrigger asChild>
              <span
                style={{ width: `${(trait.weight / Math.max(100, total)) * 100}%` }}
                className="bg-primary hover:bg-primary-hover border-background h-full border-l transition-[width] duration-300 first:border-l-0"
              />
            </TooltipTrigger>
            <TooltipContent>
              {trait.name}, <span className="numeric">{formatPercent(trait.weight)}</span>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      {fixed > 0 && (
        <p className="text-muted-foreground text-xs leading-snug">
          Up to <span className="numeric">{fixed.toLocaleString('en-US')}</span> of{' '}
          <span className="numeric">{supply.toLocaleString('en-US')}</span> tokens go to traits with a maximum
          count; weights share the rest. A maximum is a cap, not a promise: rules and unique combinations can
          keep a trait below it, and Generate shows when that happens.
        </p>
      )}
    </div>
  )
}

/** The selected layer's traits: rarity, constants, blank, and adding new ones. */
export function TraitPanel({
  layer,
  position,
  layerCount,
  supply,
  counts,
  generated,
  previewTraitId,
  onPreview,
  onAddFiles,
  editor,
  readOnly,
}: Props) {
  const blank = layer.traits.find((trait) => trait.blank)
  const hasWeighted = layer.traits.some((trait) => !trait.constant)

  return (
    <section aria-labelledby="traits-heading" className="bg-card rounded-xl border shadow-raised">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-4">
        <div className="min-w-0">
          <h3 id="traits-heading" className="text-heading truncate">
            {layer.name}
          </h3>
          <p className="text-muted-foreground text-[0.8125rem]">
            <span className="numeric">{layer.traits.length}</span>{' '}
            {layer.traits.length === 1 ? 'trait' : 'traits'} · layer{' '}
            <span className="numeric">{position + 1}</span> of <span className="numeric">{layerCount}</span>{' '}
            from the bottom
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => editor.evenOut(layer.id)}
              disabled={!hasWeighted}
            >
              <ScaleIcon />
              Even out
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onAddFiles([])}>
              <ImageUpIcon />
              Add traits
            </Button>
          </div>
        )}
      </header>

      {layer.traits.length > 0 && (
        <div className="flex flex-col gap-5 border-b px-6 py-4 md:flex-row md:items-start md:gap-8">
          <WeightTotal layer={layer} supply={supply} />
          <label className="flex shrink-0 cursor-pointer items-start gap-3 md:w-56">
            <Switch
              checked={!!blank}
              disabled={readOnly}
              onCheckedChange={(on) => editor.setBlank(layer, on)}
              className="mt-0.5"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">Blank trait</span>
              <span className="text-muted-foreground block text-xs leading-snug">
                Lets some tokens leave {layer.name} out. It takes a share like any trait.
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="p-6">
        {layer.traits.length === 0 ? (
          <div className="mx-auto max-w-md space-y-4 py-6 text-center">
            <div className="space-y-1">
              <p className="text-heading">No traits in {layer.name} yet</p>
              <p className="text-muted-foreground text-sm">
                Each image you add becomes one trait of this layer. Name them after what they show.
              </p>
            </div>
            {!readOnly && (
              <>
                <DropZone onFiles={onAddFiles} label={`Add traits to ${layer.name}`} />
                <UploadRules canvas={editor.canvas} />
              </>
            )}
          </div>
        ) : (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-4"
            aria-label={`${layer.name} traits`}
          >
            {layer.traits.map((trait) => (
              <TraitCard
                key={trait.id}
                trait={trait}
                supply={supply}
                expected={expectedCount(layer, trait, supply)}
                actual={generated > 0 ? (counts[trait.id] ?? 0) : null}
                inPreview={previewTraitId === trait.id}
                onPreview={() => onPreview(trait.id)}
                onWeight={(weight) => editor.setWeight(trait.id, weight)}
                onConstant={(count) => editor.setConstant(trait.id, count)}
                onRename={() => editor.askRenameTrait(layer, trait)}
                onDelete={() =>
                  trait.blank ? editor.setBlank(layer, false) : editor.askDeleteTrait(layer, trait)
                }
                readOnly={readOnly}
              />
            ))}
            {!readOnly && (
              <li>
                <DropZone compact onFiles={onAddFiles} label="Add traits" />
              </li>
            )}
          </ul>
        )}
      </div>

      {layer.traits.length > 0 && !readOnly && (
        <UploadRules canvas={editor.canvas} className="border-t px-6 py-3" />
      )}
    </section>
  )
}
