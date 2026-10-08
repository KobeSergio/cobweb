'use client'

import { useMemo } from 'react'
import { addRule, deleteRule, updateRule } from '@/app/actions/art/rules'
import type { ActionResult } from '@/lib/art/result'
import type { ArtRule, Layer, RuleConflict } from '@/lib/demo'
import { buildTraitIndex } from '../lib/trait-index'
import { useArtProject } from '../state/art-store'
import { useArtSync } from '../state/art-sync'
import { pruneRules } from '../state/layer-edits'
import { activeRules, analyseRules, isBidirectional } from '../state/rule-logic'
import { tokensBreakingRules } from '../state/token-logic'

export type RuleDraft = Omit<ArtRule, 'id' | 'bidirectional'>

/** Sample mode names new rules itself; saved rules take the database's id. */
let sampleRules = 0

/**
 * The rules of the project and what the analyser says about them. Until anything changes, the
 * conflicts are the ones the page was given; after an edit they are recomputed in the browser.
 * Every edit is saved through `useArtSync()`; a new rule shows once the database has given it its id.
 */
export function useRulesEditor(
  collectionId: string,
  seedLayers: Layer[],
  seedRules: ArtRule[],
  seedConflicts: RuleConflict[],
) {
  const sync = useArtSync()
  const [project] = useArtProject(collectionId, { layers: seedLayers, rules: seedRules })
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
  const tokens = project.tokens ?? null

  /**
   * Generated tokens that break a set of rules (the rules generation applies, conflicts aside).
   * The legacy tool never re-checked tokens after a rule change; here every edit says how many
   * tokens it leaves breaking, and Generate marks them.
   */
  const breakingWith = (next: ArtRule[]) =>
    tokens ? tokensBreakingRules(tokens, activeRules(next, analyseRules(layers, next, index))) : []
  const breaking = useMemo(
    () => (tokens ? tokensBreakingRules(tokens, activeRules(rules, conflicts)) : []),
    [tokens, rules, conflicts],
  )

  /** Shows the rules at once, saves the change, and returns how many generated tokens break them. */
  const write = (next: (current: ArtRule[]) => ArtRule[], persist: () => Promise<ActionResult<unknown>>) => {
    void sync.run({ apply: (p) => ({ ...p, rules: next(p.rules ?? seedRules) }), persist })
    return breakingWith(next(rules)).length
  }

  return {
    layers,
    index,
    rules,
    conflicts,
    hasTokens: !!tokens,
    /** Ids of generated tokens that break the current rules. */
    breaking,
    /** Adds a rule once it is saved; its id and how many generated tokens then break the rules, or null. */
    add: async (draft: RuleDraft): Promise<{ id: string; broken: number } | null> => {
      let id = ''
      const added = await sync.create<{ id: string }>({
        persist: () => addRule(collectionId, draft),
        apply: (p, data) => {
          id = data?.id ?? `rule-new-${Date.now().toString(36)}-${++sampleRules}`
          const rule: ArtRule = { ...draft, id, bidirectional: isBidirectional(draft.kind) }
          return { ...p, rules: [...(p.rules ?? seedRules), rule] }
        },
      })
      return added ? { id, broken: breakingWith(sync.read().rules ?? []).length } : null
    },
    /** Saves a rule; returns how many generated tokens now break the rules. */
    edit: (id: string, draft: RuleDraft) =>
      write(
        (current) =>
          current.map((rule) =>
            rule.id === id ? { ...rule, ...draft, bidirectional: isBidirectional(draft.kind) } : rule,
          ),
        () => updateRule(collectionId, id, draft),
      ),
    remove: (id: string) =>
      write(
        (current) => current.filter((rule) => rule.id !== id),
        () => deleteRule(collectionId, id),
      ),
  }
}

export type RulesEditor = ReturnType<typeof useRulesEditor>
