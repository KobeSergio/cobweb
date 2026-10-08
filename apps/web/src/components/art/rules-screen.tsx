'use client'

import { GitMergeIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@cobweb/ui/components/alert'
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
import type { ArtRule, Collection, Layer, RuleConflict, RuleKind } from '@/lib/demo'
import { artSubStepHref, flowNeighbours, isDeployed } from '@/lib/steps'
import { StageFooter } from '@/components/shell/stage-footer'
import { CollectionSwitcher } from './collections/collection-switcher'
import { useCollections } from './collections/use-collections'
import { ConfirmDialog, type ConfirmRequest } from './confirm-dialog'
import { DeferredArtNotice } from './finish-later'
import { ReadOnlyNotice } from './read-only-notice'
import { ConflictWarning } from './rules/conflict-warning'
import { RuleDialog, type RuleDialogState } from './rules/rule-dialog'
import { RuleRow } from './rules/rule-row'
import { useRulesEditor } from './rules/use-rules-editor'
import { useArtSync } from './state/art-sync'
import { collectionOfTrait, rulesOf } from './state/collection-edits'
import { layersOf } from './state/layer-edits'
import { RULE_KINDS, ruleSentence } from './state/rule-logic'

export type RulesScreenProps = {
  collection: Tables<'collections'>
  /** The project's collections; each has its own rules, which only name its own traits. */
  collections: Collection[]
  /** Every collection's layers. */
  layers: Layer[]
  /** Rules of the three kinds: doesn't mix with, always pairs with, must pair with. */
  rules: ArtRule[]
  /** What the analyser reports; at least one in the sample. */
  conflicts: RuleConflict[]
  readOnly: boolean
  /** "Finish the art later" is on (MASTER_PLAN, Flow: pre-reveal): the contract starts on a placeholder. */
  artDeferred?: boolean
}

type Filter = 'all' | RuleKind

/**
 * Art, step 2 (generative): add, edit and delete trait-pairing rules of the collection shown, with
 * a duplicate check. The conflict analyser's findings sit in a red chip beside Continue.
 */
export function RulesScreen({
  collection,
  collections: seedCollections,
  layers,
  rules: seedRules,
  conflicts: seedConflicts,
  readOnly: readOnlyProp,
  artDeferred = false,
}: RulesScreenProps) {
  const sync = useArtSync()
  const collections = useCollections(collection.id, collection.name, {
    collections: seedCollections,
    layers,
    rules: seedRules,
  })
  const readOnly = readOnlyProp || sync.locked || collections.starting
  const editor = useRulesEditor(collection.id, layers, seedRules, seedConflicts)
  const { conflicts, index } = editor
  const { activeId } = collections
  const rules = rulesOf(editor.rules, editor.layers, activeId)
  const [filter, setFilter] = useState<Filter>('all')
  const [dialog, setDialog] = useState<RuleDialogState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [highlighted, setHighlighted] = useState<string[]>([])
  const timer = useRef<number | undefined>(undefined)
  const { previous, next } = flowNeighbours(collection.id, collection.project_type, 'art/rules')
  const deferredNext =
    artDeferred && sync.demo && next ? { ...next, href: `${next.href}?art=deferred` } : next

  const inConflict = new Set(conflicts.flatMap((conflict) => conflict.ruleIds))
  const shown = filter === 'all' ? rules : rules.filter((rule) => rule.kind === filter)

  const collectionOfRule = (ruleId: string) => {
    const rule = editor.rules.find((candidate) => candidate.id === ruleId)
    return rule ? collectionOfTrait(editor.layers, rule.traitId) : undefined
  }

  const highlight = (ids: string[]) => {
    // A conflict's rules may be in another collection: show that one first.
    const owner = ids[0] ? collectionOfRule(ids[0]) : undefined
    if (owner && owner !== activeId) collections.select(owner)
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

  /** Confirms a save, and says when generated tokens now break the rules (legacy never re-checked them). */
  const saved = (done: string, broken: number) =>
    toast(
      done,
      broken
        ? {
            description: `${broken.toLocaleString('en-US')} generated ${broken === 1 ? 'token breaks' : 'tokens break'} the rules now. They are marked on Generate, where you can regenerate them.`,
          }
        : undefined,
    )

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
      onConfirm: () => saved('Rule deleted', editor.remove(rule.id)),
    })

  return (
    <div className="flex flex-1 flex-col gap-6">
      {readOnly && <ReadOnlyNotice what="the rules" />}
      {artDeferred && (
        <DeferredArtNotice
          collectionId={collection.id}
          demo={sync.demo}
          deployed={isDeployed(collection.status)}
        />
      )}
      <CollectionSwitcher control={collections} readOnly={readOnly} />
      {!readOnly && editor.breaking.length > 0 && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>
            <span className="numeric">{editor.breaking.length.toLocaleString('en-US')}</span> generated{' '}
            {editor.breaking.length === 1 ? 'token breaks' : 'tokens break'} these rules
          </AlertTitle>
          <AlertDescription>
            <p>
              The rules changed after the set was generated. Regenerate those tokens, or the whole set, before
              locking.{' '}
              <Link
                className="text-foreground underline underline-offset-2"
                href={artSubStepHref(collection.id, 'generate')}
              >
                Go to Generate
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      )}

      {rules.length === 0 ? (
        <Empty className="bg-card border py-14">
          <EmptyHeader className="max-w-lg">
            <EmptyMedia variant="icon">
              <GitMergeIcon />
            </EmptyMedia>
            <EmptyTitle>
              {collections.collections.length > 1
                ? `No rules in ${collections.active?.name} yet`
                : 'No rules yet'}
            </EmptyTitle>
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
        layers={layersOf(editor.layers, activeId)}
        index={index}
        rules={editor.rules}
        onSave={(draft, id) => {
          if (id) {
            saved('Rule saved', editor.edit(id, draft))
            highlight([id])
          } else {
            void editor.add(draft).then((added) => {
              if (!added) return
              highlight([added.id])
              saved('Rule added', added.broken)
            })
          }
        }}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <StageFooter
        previous={
          artDeferred && sync.demo && previous
            ? { ...previous, href: `${previous.href}?art=deferred` }
            : previous
        }
        // While a conflict exists, Continue opens the conflict dialog first (in `ConflictWarning`).
        next={conflicts.length > 0 ? undefined : deferredNext}
        extra={
          <ConflictWarning
            conflicts={conflicts}
            next={deferredNext}
            whereOf={(conflict) => {
              if (collections.collections.length < 2) return undefined
              const owner = conflict.ruleIds[0] ? collectionOfRule(conflict.ruleIds[0]) : undefined
              return collections.collections.find((c) => c.id === owner)?.name
            }}
            onShow={highlight}
          />
        }
      />
    </div>
  )
}
