'use client'

import { GitMergeIcon, PlusIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@cobweb/ui/components/empty'
import { ToggleGroup, ToggleGroupItem } from '@cobweb/ui/components/toggle-group'
import type { Tables } from '@/lib/database.types'
import type { ArtRule, Layer, RuleConflict, RuleKind } from '@/lib/demo'
import { flowNeighbours } from '@/lib/steps'
import { StageFooter } from '@/components/shell/stage-footer'
import { ConfirmDialog, type ConfirmRequest } from './confirm-dialog'
import { ReadOnlyNotice } from './read-only-notice'
import { ConflictsPanel } from './rules/conflicts-panel'
import { RuleDialog, type RuleDialogState } from './rules/rule-dialog'
import { RuleRow } from './rules/rule-row'
import { useRulesEditor } from './rules/use-rules-editor'
import { RULE_KINDS, ruleSentence } from './state/rule-logic'

export type RulesScreenProps = {
  collection: Tables<'collections'>
  layers: Layer[]
  /** Rules of the three kinds: doesn't mix with, always pairs with, must pair with. */
  rules: ArtRule[]
  /** What the analyser reports; at least one in the sample. */
  conflicts: RuleConflict[]
  readOnly: boolean
}

type Filter = 'all' | RuleKind

/**
 * Art, step 2 (generative): add, edit and delete trait-pairing rules, with a duplicate check and
 * the conflict analyser surfacing contradictions before generation.
 */
export function RulesScreen({
  collection,
  layers,
  rules: seedRules,
  conflicts: seedConflicts,
  readOnly,
}: RulesScreenProps) {
  const editor = useRulesEditor(collection.id, layers, seedRules, seedConflicts)
  const { rules, conflicts, index } = editor
  const [filter, setFilter] = useState<Filter>('all')
  const [dialog, setDialog] = useState<RuleDialogState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [highlighted, setHighlighted] = useState<string[]>([])
  const timer = useRef<number | undefined>(undefined)
  const { previous, next } = flowNeighbours(collection.id, collection.project_type, 'art/rules')

  const inConflict = new Set(conflicts.flatMap((conflict) => conflict.ruleIds))
  const shown = filter === 'all' ? rules : rules.filter((rule) => rule.kind === filter)

  const highlight = (ids: string[]) => {
    setFilter('all')
    setHighlighted(ids)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setHighlighted([]), 2600)
    requestAnimationFrame(() => {
      const first = document.getElementById(`rule-${ids[0]}`)
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      first?.focus({ preventScroll: true })
    })
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const askDelete = (rule: ArtRule) =>
    setConfirm({
      title: 'Delete this rule?',
      body: [
        ruleSentence(rule, index),
        editor.hasTokens
          ? 'Tokens you already generated keep their traits. Regenerate on the Generate step to apply the change.'
          : 'It stops applying the next time you generate.',
      ],
      confirmLabel: 'Delete rule',
      destructive: true,
      onConfirm: () => {
        editor.remove(rule.id)
        toast('Rule deleted')
      },
    })

  return (
    <div className="flex flex-1 flex-col gap-6">
      {readOnly && <ReadOnlyNotice what="the rules" />}

      {rules.length === 0 ? (
        <Empty className="bg-card border py-14">
          <EmptyHeader className="max-w-lg">
            <EmptyMedia variant="icon">
              <GitMergeIcon />
            </EmptyMedia>
            <EmptyTitle>No rules yet</EmptyTitle>
            <EmptyDescription>
              Without rules, any trait can appear with any other. Add a rule when some traits should never
              meet, or should always come together. Rules are optional.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-2xl">
            <ul className="grid gap-3 text-left sm:grid-cols-3">
              {RULE_KINDS.map((kind) => (
                <li key={kind.kind} className="bg-surface-2/60 rounded-lg border p-4">
                  <p className="text-sm font-semibold">{kind.label}</p>
                  <p className="text-muted-foreground mt-1 text-[0.8125rem] leading-snug">{kind.summary}</p>
                </li>
              ))}
            </ul>
            {!readOnly && (
              <Button variant="secondary" onClick={() => setDialog({ mode: 'add' })}>
                <PlusIcon />
                Add the first rule
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <ConflictsPanel conflicts={conflicts} ruleCount={rules.length} onShow={highlight} />

          <section aria-labelledby="rules-heading" className="bg-card rounded-xl border shadow-raised">
            <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4">
              <h3 id="rules-heading" className="text-heading flex items-baseline gap-2">
                Rules{' '}
                <span className="numeric text-muted-foreground text-sm font-normal">{rules.length}</span>
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={filter}
                  onValueChange={(value) => value && setFilter(value as Filter)}
                  aria-label="Show rules of a kind"
                >
                  <ToggleGroupItem value="all">All</ToggleGroupItem>
                  {RULE_KINDS.map((kind) => (
                    <ToggleGroupItem key={kind.kind} value={kind.kind}>
                      {kind.label}
                      <span className="numeric text-muted-foreground ml-1">
                        {rules.filter((rule) => rule.kind === kind.kind).length}
                      </span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {!readOnly && (
                  <Button variant="secondary" size="sm" onClick={() => setDialog({ mode: 'add' })}>
                    <PlusIcon />
                    Add rule
                  </Button>
                )}
              </div>
            </header>
            {shown.length === 0 ? (
              <p className="text-muted-foreground px-6 py-10 text-center text-sm">No rules of this kind.</p>
            ) : (
              <ul className="space-y-3 p-4 sm:p-6">
                {shown.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    index={index}
                    inConflict={inConflict.has(rule.id)}
                    highlighted={highlighted.includes(rule.id)}
                    onEdit={() => setDialog({ mode: 'edit', rule })}
                    onDelete={() => askDelete(rule)}
                    readOnly={readOnly}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <RuleDialog
        state={dialog}
        onClose={() => setDialog(null)}
        layers={editor.layers}
        index={index}
        rules={rules}
        onSave={(draft, id) => {
          if (id) {
            editor.edit(id, draft)
            toast('Rule saved')
            highlight([id])
          } else {
            highlight([editor.add(draft)])
            toast('Rule added')
          }
        }}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <StageFooter previous={previous} next={next} />
    </div>
  )
}
