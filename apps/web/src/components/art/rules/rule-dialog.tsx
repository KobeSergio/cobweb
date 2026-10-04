'use client'

import { CircleAlertIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { ChoiceCard, ChoiceCards } from '@cobweb/ui/components/choice-cards'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cobweb/ui/components/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cobweb/ui/components/select'
import { cn } from '@cobweb/ui/lib/utils'
import type { ArtRule, Layer, RuleKind, Trait } from '@/lib/demo'
import { Composite } from '../composite'
import { joinOr, traitName, type TraitIndex } from '../lib/trait-index'
import { findDuplicate, RULE_KINDS, ruleSentence } from '../state/rule-logic'
import type { RuleDraft } from './use-rules-editor'

export type RuleDialogState = { mode: 'add' } | { mode: 'edit'; rule: ArtRule }

/** A grid of trait thumbnails to pick one (`single`) or several. */
function TraitPicker({
  traits,
  selected,
  onToggle,
  label,
  single,
}: {
  traits: Trait[]
  selected: string[]
  onToggle: (id: string) => void
  label: string
  single?: boolean
}) {
  return (
    <ul
      aria-label={label}
      className="grid max-h-60 grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2 overflow-y-auto p-0.5"
    >
      {traits.map((trait) => {
        const on = selected.includes(trait.id)
        return (
          <li key={trait.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(trait.id)}
              className={cn(
                'group/pick focus-visible:ring-ring flex w-full flex-col gap-1.5 rounded-lg border p-1.5 text-left outline-none transition-colors focus-visible:ring-2',
                on ? 'border-primary bg-primary-soft' : 'hover:border-border-strong hover:bg-surface-2',
              )}
            >
              <Composite
                urls={trait.imageUrl ? [trait.imageUrl] : []}
                alt=""
                seed={trait.id}
                label={trait.blank ? 'Blank' : undefined}
                className="rounded-md"
              />
              <span className="truncate px-0.5 text-xs font-medium">
                {trait.name}
                <span className="sr-only">{on ? (single ? ', chosen' : ', selected') : ''}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Stands in for a trait grid until a layer is chosen, so the step does not look broken. */
function PickLayerFirst({ children }: { children: string }) {
  return (
    <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-[0.8125rem]">
      {children}
    </p>
  )
}

/** A step: its numbered heading with the layer dropdown on the same row, then its body. */
function Step({
  step,
  title,
  control,
  children,
}: {
  step: number
  title: string
  control?: ReactNode
  children: ReactNode
}) {
  const id = `rule-step-${step}`
  return (
    <div role="group" aria-labelledby={id} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={id} className="text-heading flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="numeric bg-surface-3 text-muted-foreground flex size-6 items-center justify-center rounded-full text-xs"
          >
            {step}
          </span>
          {title}
        </h3>
        {control}
      </div>
      {children}
    </div>
  )
}

function LayerSelect({
  id,
  layers,
  value,
  onChange,
  placeholder,
}: {
  id: string
  layers: Layer[]
  value: string
  onChange: (id: string) => void
  placeholder: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={placeholder} size="sm" className="w-full sm:w-56">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {layers.map((layer) => (
          <SelectItem key={layer.id} value={layer.id}>
            {layer.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Add or edit a rule: the trait, the kind, then the traits it relates to, with a live sentence. */
export function RuleDialog({
  state,
  onClose,
  layers,
  index,
  rules,
  onSave,
}: {
  state: RuleDialogState | null
  onClose: () => void
  layers: Layer[]
  index: TraitIndex
  rules: ArtRule[]
  onSave: (draft: RuleDraft, id?: string) => void
}) {
  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {state && (
          <RuleForm
            key={state.mode === 'edit' ? state.rule.id : 'new'}
            state={state}
            onClose={onClose}
            layers={layers}
            index={index}
            rules={rules}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RuleForm({
  state,
  onClose,
  layers,
  index,
  rules,
  onSave,
}: {
  state: RuleDialogState
  onClose: () => void
  layers: Layer[]
  index: TraitIndex
  rules: ArtRule[]
  onSave: (draft: RuleDraft, id?: string) => void
}) {
  const editing = state.mode === 'edit' ? state.rule : null
  const [sourceLayer, setSourceLayer] = useState(editing ? (index.get(editing.traitId)?.layer.id ?? '') : '')
  const [traitId, setTraitId] = useState(editing?.traitId ?? '')
  const [kind, setKind] = useState<RuleKind>(editing?.kind ?? "doesn't mix with")
  const [relatedLayer, setRelatedLayer] = useState(
    editing ? (index.get(editing.relatedTraitIds[0] ?? '')?.layer.id ?? '') : '',
  )
  const [related, setRelated] = useState<string[]>(editing?.relatedTraitIds ?? [])
  const [tried, setTried] = useState(false)

  const source = layers.find((layer) => layer.id === sourceLayer)
  const target = layers.find((layer) => layer.id === relatedLayer)
  const draft: RuleDraft = { kind, traitId, relatedTraitIds: related }
  const duplicate =
    traitId && related.length
      ? findDuplicate({ ...draft, bidirectional: kind !== 'must pair with' }, rules, editing?.id)
      : undefined
  const missing = !traitId
    ? 'Choose the trait the rule is about.'
    : related.length === 0
      ? 'Choose at least one related trait.'
      : null
  const error =
    missing ?? (duplicate ? `This repeats an existing rule: ${ruleSentence(duplicate, index)}` : null)

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (error) return
        onSave(draft, editing?.id)
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit rule' : 'Add a rule'}</DialogTitle>
        <DialogDescription>
          Rules decide which traits can share a token. They apply when you generate.
        </DialogDescription>
      </DialogHeader>

      <Step
        step={1}
        title="The trait"
        control={
          <LayerSelect
            id="rule-source-layer"
            layers={layers.filter((layer) => layer.traits.length > 0)}
            value={sourceLayer}
            onChange={(id) => {
              setSourceLayer(id)
              setTraitId('')
              if (id === relatedLayer) {
                setRelatedLayer('')
                setRelated([])
              }
            }}
            placeholder="Choose a layer"
          />
        }
      >
        {source ? (
          <TraitPicker
            single
            label={`${source.name} traits`}
            traits={source.traits}
            selected={[traitId]}
            onToggle={setTraitId}
          />
        ) : (
          <PickLayerFirst>Choose a layer to pick the trait this rule is about</PickLayerFirst>
        )}
      </Step>

      <Step step={2} title="The rule">
        <ChoiceCards
          value={kind}
          onValueChange={(value) => setKind(value as RuleKind)}
          className="sm:grid-cols-3"
        >
          {RULE_KINDS.map((option) => (
            <ChoiceCard
              key={option.kind}
              value={option.kind}
              title={option.label}
              description={option.summary}
            />
          ))}
        </ChoiceCards>
      </Step>

      <Step
        step={3}
        title="The related traits"
        control={
          <LayerSelect
            id="rule-related-layer"
            layers={layers.filter((layer) => layer.id !== sourceLayer && layer.traits.length > 0)}
            value={relatedLayer}
            onChange={(id) => {
              setRelatedLayer(id)
              setRelated([])
            }}
            placeholder="Choose another layer"
          />
        }
      >
        {!target && <PickLayerFirst>Choose another layer to pick the traits it relates to</PickLayerFirst>}
        {target && (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                Choose one or more. The rule is met by any of them.
              </p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="text-foreground underline"
                onClick={() =>
                  setRelated(
                    related.length === target.traits.length ? [] : target.traits.map((trait) => trait.id),
                  )
                }
              >
                {related.length === target.traits.length ? 'Clear' : 'Select all'}
              </Button>
            </div>
            <TraitPicker
              label={`${target.name} traits`}
              traits={target.traits}
              selected={related}
              onToggle={(id) =>
                setRelated((current) =>
                  current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
                )
              }
            />
          </>
        )}
      </Step>

      <div className="bg-well rounded-lg border px-4 py-3 shadow-inset" aria-live="polite">
        <p className="text-muted-foreground text-xs font-medium">The rule reads</p>
        <p className="mt-1 text-sm">
          <span className={cn(!traitId && 'text-muted-foreground')}>
            {traitId ? traitName(index, traitId) : 'A trait'}
          </span>{' '}
          {kind}{' '}
          <span className={cn(!related.length && 'text-muted-foreground')}>
            {related.length ? joinOr(related.map((id) => traitName(index, id))) : 'the traits you choose'}
          </span>
        </p>
      </div>

      {(tried || duplicate) && error && (
        <p role="alert" className="text-destructive-foreground -mt-2 flex items-start gap-2 text-sm">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">{editing ? 'Save rule' : 'Add rule'}</Button>
      </DialogFooter>
    </form>
  )
}
