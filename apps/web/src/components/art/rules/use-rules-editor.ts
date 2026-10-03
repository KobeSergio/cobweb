'use client'

import { useMemo, useState } from 'react'
import type { ArtRule, Layer, RuleConflict } from '@/lib/demo'
import { buildTraitIndex } from '../lib/trait-index'
import { useArtProject } from '../state/art-store'
import { pruneRules } from '../state/layer-edits'
import { analyseRules, isBidirectional } from '../state/rule-logic'

export type RuleDraft = Omit<ArtRule, 'id' | 'bidirectional'>

/**
 * The rules of the project and what the analyser says about them. Until anything changes, the
 * conflicts are the ones the page was given; after an edit they are recomputed in the browser.
 */
export function useRulesEditor(
  collectionId: string,
  seedLayers: Layer[],
  seedRules: ArtRule[],
  seedConflicts: RuleConflict[],
) {
  const [project, update] = useArtProject(collectionId, { layers: seedLayers, rules: seedRules })
  const layers = project.layers ?? seedLayers
  const index = useMemo(() => buildTraitIndex(layers), [layers])
  // Rules pointing at traits deleted on the Layers step are dropped here.
  const rules = useMemo(
    () => pruneRules(project.rules ?? seedRules, new Set(index.keys())),
    [project.rules, seedRules, index],
  )
  const untouched = rules === seedRules && layers === seedLayers
  const conflicts = useMemo(
    () => (untouched ? seedConflicts : analyseRules(layers, rules, index)),
    [untouched, seedConflicts, layers, rules, index],
  )
  const [counter, setCounter] = useState(1)

  const write = (next: ArtRule[]) => update((p) => ({ ...p, rules: next }))

  return {
    layers,
    index,
    rules,
    conflicts,
    hasTokens: !!project.tokens,
    /** Adds a rule and returns its id. */
    add: (draft: RuleDraft) => {
      const id = `rule-new-${Date.now().toString(36)}-${counter}`
      setCounter((n) => n + 1)
      write([...rules, { ...draft, id, bidirectional: isBidirectional(draft.kind) }])
      return id
    },
    edit: (id: string, draft: RuleDraft) =>
      write(
        rules.map((rule) =>
          rule.id === id ? { ...rule, ...draft, bidirectional: isBidirectional(draft.kind) } : rule,
        ),
      ),
    remove: (id: string) => write(rules.filter((rule) => rule.id !== id)),
  }
}

export type RulesEditor = ReturnType<typeof useRulesEditor>
