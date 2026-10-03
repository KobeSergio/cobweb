import type { ArtRule, Layer, RuleConflict, RuleKind } from '@/lib/demo'
import { joinOr, traitName, type TraitIndex } from '../lib/trait-index'

/**
 * Rule checks for the Rules and Generate screens: wording, duplicates, the conflict analyser and
 * the reason a token breaks a rule.
 *
 * Seam: the analyser and the rule check move to `packages/dna` (Phase 3); keep the signatures.
 */

export const RULE_KINDS: { kind: RuleKind; label: string; summary: string }[] = [
  {
    kind: "doesn't mix with",
    label: "Doesn't mix with",
    summary: 'Never in the same token as any of the chosen traits. Works both ways.',
  },
  {
    kind: 'always pairs with',
    label: 'Always pairs with',
    summary: 'Appears only with one of the chosen traits, and they only appear with it. Works both ways.',
  },
  {
    kind: 'must pair with',
    label: 'Must pair with',
    summary:
      'Whenever it appears, one of the chosen traits does too. The chosen traits can still appear alone.',
  },
]

export function isBidirectional(kind: RuleKind): boolean {
  return kind !== 'must pair with'
}

/** "Monocle doesn't mix with Sleepy, Wink or Squint." */
export function ruleSentence(rule: ArtRule, index: TraitIndex): string {
  const related = joinOr(rule.relatedTraitIds.map((id) => traitName(index, id)))
  return `${traitName(index, rule.traitId)} ${rule.kind} ${related}.`
}

function overlaps(a: string[], b: string[]): boolean {
  return a.some((id) => b.includes(id))
}

/**
 * An existing rule that says the same thing: same kind and source with overlapping related
 * traits, or for a two-way kind, the same pairing written from the other side.
 */
export function findDuplicate(candidate: Omit<ArtRule, 'id'>, rules: ArtRule[], ignoreId?: string) {
  return rules.find((rule) => {
    if (rule.id === ignoreId || rule.kind !== candidate.kind) return false
    if (rule.traitId === candidate.traitId && overlaps(rule.relatedTraitIds, candidate.relatedTraitIds))
      return true
    return (
      isBidirectional(candidate.kind) &&
      candidate.relatedTraitIds.includes(rule.traitId) &&
      rule.relatedTraitIds.includes(candidate.traitId)
    )
  })
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
  return conflicts
}

/** The rules generation applies: for each conflict, the first rule is kept and the rest skipped. */
export function activeRules(rules: ArtRule[], conflicts: RuleConflict[]): ArtRule[] {
  const skipped = new Set(conflicts.flatMap((conflict) => conflict.ruleIds.slice(1)))
  return rules.filter((rule) => !skipped.has(rule.id))
}

/** The first rule a set of traits breaks, worded for the creator, or null when it breaks none. */
export function brokenRule(traitIds: string[], rules: ArtRule[], index: TraitIndex): string | null {
  const has = new Set(traitIds)
  for (const rule of rules) {
    const hasTrait = has.has(rule.traitId)
    const present = rule.relatedTraitIds.filter((id) => has.has(id))
    const source = traitName(index, rule.traitId)
    const related = joinOr(rule.relatedTraitIds.map((id) => traitName(index, id)))
    if (rule.kind === "doesn't mix with" && hasTrait && present.length > 0)
      return `${source} doesn't mix with ${traitName(index, present[0]!)}.`
    if (rule.kind === 'must pair with' && hasTrait && present.length === 0)
      return `${source} must pair with ${related}.`
    if (rule.kind === 'always pairs with' && hasTrait && present.length === 0)
      return `${source} always pairs with ${related}.`
    if (rule.kind === 'always pairs with' && !hasTrait && present.length > 0)
      return `${traitName(index, present[0]!)} only appears with ${source}.`
  }
  return null
}
