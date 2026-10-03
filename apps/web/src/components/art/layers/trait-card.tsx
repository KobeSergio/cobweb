'use client'

import { EyeIcon, HashIcon, MoreHorizontalIcon, PencilIcon, PercentIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@cobweb/ui/components/dropdown-menu'
import { Input } from '@cobweb/ui/components/input'
import { Slider } from '@cobweb/ui/components/slider'
import { cn } from '@cobweb/ui/lib/utils'
import type { Trait } from '@/lib/demo'
import { Composite } from '../composite'
import { formatCount } from '../lib/trait-index'

type Props = {
  trait: Trait
  expected: number
  /** Tokens in the generated set that carry it, or null when nothing is generated. */
  actual: number | null
  supply: number
  inPreview: boolean
  onPreview: () => void
  onWeight: (weight: number) => void
  onConstant: (count: number | null) => void
  onRename: () => void
  onDelete: () => void
  readOnly: boolean
}

/** A number field that lets the creator clear it while typing, and commits valid values as they go. */
function NumberField({
  value,
  onCommit,
  min,
  max,
  step,
  label,
  disabled,
  className,
}: {
  value: number
  onCommit: (value: number) => void
  min: number
  max: number
  step: number
  label: string
  disabled?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      aria-label={label}
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(event) => {
        setDraft(event.target.value)
        const next = Number(event.target.value)
        if (event.target.value !== '' && Number.isFinite(next)) onCommit(Math.min(max, Math.max(min, next)))
      }}
      onBlur={() => setDraft(null)}
      className={cn('h-8 px-2 text-right text-[0.8125rem]', className)}
    />
  )
}

export function TraitCard({
  trait,
  expected,
  actual,
  supply,
  inPreview,
  onPreview,
  onWeight,
  onConstant,
  onRename,
  onDelete,
  readOnly,
}: Props) {
  const weightLabel = `${trait.name} weight in percent`
  const off = !trait.constant && trait.weight === 0

  return (
    <li
      className={cn(
        'bg-surface-2 group/trait flex flex-col overflow-hidden rounded-lg border shadow-raised transition-[border-color,box-shadow] duration-150',
        inPreview ? 'border-primary-line' : 'hover:border-border-strong',
      )}
    >
      <button
        type="button"
        onClick={onPreview}
        aria-pressed={inPreview}
        aria-label={`Show ${trait.name} in the preview`}
        className="focus-visible:ring-ring relative block outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <Composite
          urls={trait.imageUrl ? [trait.imageUrl] : []}
          alt={trait.blank ? 'Blank: this layer is left out' : trait.name}
          seed={trait.id}
          label={trait.blank ? 'Blank' : undefined}
          className={cn('transition-opacity', off && 'opacity-55')}
        />
        {inPreview && (
          <span className="bg-background/80 border-primary-line text-primary absolute top-2 left-2 inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium backdrop-blur-sm">
            <EyeIcon aria-hidden="true" className="size-3" />
            In preview
          </span>
        )}
        {trait.constant && (
          <span className="bg-background/80 text-foreground absolute top-2 right-2 inline-flex h-6 items-center rounded-full border border-border-strong px-2 text-xs font-medium backdrop-blur-sm">
            Up to <span className="numeric ml-1">{trait.constant.toLocaleString('en-US')}</span>
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-3 border-t p-3">
        <div className="flex items-start justify-between gap-1">
          <h4 className="min-w-0 truncate pt-0.5 text-sm font-medium" title={trait.name}>
            {trait.name}
          </h4>
          {!readOnly && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="-mt-0.5 -mr-1"
                  aria-label={`More actions for ${trait.name}`}
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!trait.blank && (
                  <DropdownMenuItem onSelect={onRename}>
                    <PencilIcon />
                    Rename
                  </DropdownMenuItem>
                )}
                {!trait.blank &&
                  (trait.constant ? (
                    <DropdownMenuItem onSelect={() => onConstant(null)}>
                      <PercentIcon />
                      Use a weight instead
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => onConstant(Math.max(1, Math.round(expected)))}>
                      <HashIcon />
                      Use a maximum count
                    </DropdownMenuItem>
                  ))}
                {!trait.blank && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2Icon />
                  {trait.blank ? 'Turn off blank' : 'Delete trait'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {trait.constant ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs" aria-hidden="true">
              Maximum count
            </p>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Up to</span>
              <NumberField
                value={trait.constant}
                min={1}
                max={supply}
                step={1}
                label={`${trait.name} maximum count, in tokens`}
                disabled={readOnly}
                onCommit={(value) => onConstant(Math.round(value))}
                className="w-20"
              />
              <span className="text-muted-foreground text-xs">tokens</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <Slider
              value={[trait.weight]}
              min={0}
              max={100}
              step={0.5}
              disabled={readOnly}
              aria-label={weightLabel}
              onValueChange={([value]) => onWeight(value ?? 0)}
              className="flex-1"
            />
            <div className="relative w-[4.25rem] shrink-0">
              <NumberField
                value={trait.weight}
                min={0}
                max={100}
                step={0.5}
                label={weightLabel}
                disabled={readOnly}
                onCommit={onWeight}
                className="pr-5"
              />
              <span
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs"
              >
                %
              </span>
            </div>
          </div>
        )}

        <dl className="mt-auto grid grid-cols-2 gap-x-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Expected</dt>
            <dd className="text-foreground">
              {trait.constant && <span className="text-muted-foreground">up to </span>}
              <span className="numeric">{formatCount(expected)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Generated</dt>
            <dd className={cn('numeric', actual === null ? 'text-muted-foreground' : 'text-foreground')}>
              {actual === null ? 'None yet' : formatCount(actual)}
            </dd>
          </div>
        </dl>
      </div>
    </li>
  )
}
