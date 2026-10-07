import { joinOr, traitName, type TraitIndex } from './index-of'
import type { ArtRule, Layer, RuleConflict } from './types'

export function overlaps(a: string[], b: string[]): boolean {
  return a.some((id) => b.includes(id))
}

/** Whether `a` and `b` are kept apart by a "doesn't mix with" rule, and which one. */
function mixBlocker(a: string, b: string, rules: ArtRule[]): ArtRule | undefined {
  return rules.find(
    (rule) =>
      rule.kind === "doesn't mix with" &&
      ((rule.traitId === a && rule.relatedTraitIds.includes(b)) ||
        (rule.traitId === b && rule.relatedTraitIds.includes(a))),
  )
}

/**
 * Finds rules that contradict each other:
 *  - mixing: a trait must pair with traits it is also kept apart from.
 *  - isolated: a trait does not mix with any trait of some layer, so no token can hold it.
 *  - circular: two "always pairs with" rules ask one trait for two different traits of one layer.
 */
export function analyseRules(layers: Layer[], rules: ArtRule[], index: TraitIndex): RuleConflict[] {
  const conflicts: RuleConflict[] = []
  const name = (id: string) => traitName(index, id)

  for (const rule of rules) {
    if (rule.kind === "doesn't mix with") continue
    const blockers = rule.relatedTraitIds.map((related) => mixBlocker(rule.traitId, related, rules))
    if (blockers.every(Boolean)) {
      const ids = [rule.id, ...new Set(blockers.map((blocker) => blocker!.id))]
      const both = rule.kind === 'always pairs with'
      conflicts.push({
        kind: 'mixing',
        ruleIds: ids,
        message: `${name(rule.traitId)} ${rule.kind} ${joinOr(rule.relatedTraitIds.map(name))}, but another rule keeps them apart. ${
          both ? 'Neither side' : name(rule.traitId)
        } can appear in any token. Remove or change one of these rules.`,
      })
    }
  }

  for (const [traitId, entry] of index) {
    for (const layer of layers) {
      // Rules apply within a collection: only the trait's own collection's layers can shut it out.
      if (layer.collectionId !== entry.layer.collectionId) continue
      if (layer.id === entry.layer.id || layer.traits.length === 0) continue
      const usable = layer.traits.filter((trait) => trait.constant || trait.weight > 0)
      if (usable.length === 0) continue
      const blockers = usable.map((trait) => mixBlocker(traitId, trait.id, rules))
      if (blockers.every(Boolean)) {
        conflicts.push({
          kind: 'isolated',
          ruleIds: [...new Set(blockers.map((blocker) => blocker!.id))],
          message: `${name(traitId)} does not mix with any ${layer.name} trait, and every token has one, so ${name(traitId)} can never appear. Allow at least one ${layer.name} trait.`,
        })
      }
    }
  }

  // For each trait, the traits each "always pairs with" rule allows it beside, per layer.
  const needs = new Map<string, { ruleId: string; layerId: string; allowed: string[] }[]>()
  const addNeed = (traitId: string, ruleId: string, allowed: string[]) => {
    const layerId = index.get(allowed[0] ?? '')?.layer.id
    if (!layerId) return
    needs.set(traitId, [...(needs.get(traitId) ?? []), { ruleId, layerId, allowed }])
  }
  for (const rule of rules) {
    if (rule.kind !== 'always pairs with') continue
    addNeed(rule.traitId, rule.id, rule.relatedTraitIds)
    for (const related of rule.relatedTraitIds) addNeed(related, rule.id, [rule.traitId])
  }
  const reported = new Set<string>()
  for (const [traitId, list] of needs) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!
        const b = list[j]!
        if (a.layerId !== b.layerId || a.ruleId === b.ruleId || overlaps(a.allowed, b.allowed)) continue
        const key = [a.ruleId, b.ruleId].sort().join('|')
        if (reported.has(key)) continue
        reported.add(key)
        const layerName = index.get(a.allowed[0]!)?.layer.name ?? 'that layer'
        conflicts.push({
          kind: 'circular',
          ruleIds: [a.ruleId, b.ruleId],
          message: `${name(traitId)} has to appear with ${joinOr(a.allowed.map(name))} by one rule and with ${joinOr(b.allowed.map(name))} by another, but a token has only one ${layerName} trait. ${name(traitId)} can never appear.`,
        })
      }
    }
  }
  conflicts.push(...chainConflicts(rules, index, new Set(conflicts.map(conflictKey))))
  return conflicts
}

function conflictKey(conflict: Pick<RuleConflict, 'ruleIds'>): string {
  return [...new Set(conflict.ruleIds)].sort().join('|')
}

/**
 * Conflicts reached through a chain of pairing rules, as the legacy analyser followed them:
 * "A must pair with B" and "B always pairs with C" mean every token with A also has C, so a rule
 * keeping A and C apart, or two traits of one layer, shuts A out. A rule forces its partner only
 * when it names one related trait (with several, any one will do), and "always pairs with" also
 * forces the source trait from each related trait.
 */
export function chainConflicts(rules: ArtRule[], index: TraitIndex, known: Set<string>): RuleConflict[] {
  const name = (id: string) => traitName(index, id)
  const forces = new Map<string, { to: string; ruleId: string }[]>()
  const force = (from: string, to: string, ruleId: string) =>
    forces.set(from, [...(forces.get(from) ?? []), { to, ruleId }])
  for (const rule of rules) {
    if (rule.kind === "doesn't mix with") continue
    if (rule.relatedTraitIds.length === 1) force(rule.traitId, rule.relatedTraitIds[0]!, rule.id)
    if (rule.kind === 'always pairs with')
      for (const related of rule.relatedTraitIds) force(related, rule.traitId, rule.id)
  }

  const found: RuleConflict[] = []
  const report = (conflict: RuleConflict) => {
    const key = conflictKey(conflict)
    if (known.has(key)) return
    known.add(key)
    found.push(conflict)
  }
  for (const start of forces.keys()) {
    // Every trait a token with `start` must also have, with the rules that bring it in.
    const paths = new Map<string, string[]>([[start, []]])
    const queue = [start]
    while (queue.length) {
      const at = queue.shift()!
      for (const edge of forces.get(at) ?? []) {
        if (paths.has(edge.to)) continue
        paths.set(edge.to, [...paths.get(at)!, edge.ruleId])
        queue.push(edge.to)
      }
    }
    const held = [...paths.keys()]
    for (let i = 0; i < held.length; i++) {
      for (let j = i + 1; j < held.length; j++) {
        const a = held[i]!
        const b = held[j]!
        const chain = [...new Set([...paths.get(a)!, ...paths.get(b)!])]
        if (chain.length < 2) continue
        const blocker = mixBlocker(a, b, rules)
        if (blocker) {
          report({
            kind: 'mixing',
            ruleIds: [...chain, blocker.id],
            skip: [blocker.id],
            message: `Through a chain of pairing rules, every token with ${name(start)} also has ${name(a === start ? b : a)}${a === start ? '' : ` and ${name(b)}`}, but another rule keeps ${name(a)} and ${name(b)} apart. ${name(start)} can never appear. Remove or change one of these rules.`,
          })
          continue
        }
        const layerA = index.get(a)?.layer
        if (layerA && layerA.id === index.get(b)?.layer.id)
          report({
            kind: 'circular',
            ruleIds: chain,
            skip: chain.slice(-1),
            message: `Through a chain of pairing rules, every token with ${name(start)} needs both ${name(a)} and ${name(b)}, but a token has only one ${layerA.name} trait. ${name(start)} can never appear.`,
          })
      }
    }
  }
  return found
}
