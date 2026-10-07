import { analyseRules, overlaps } from './analyse'
import { buildTraitIndex, joinOr, traitName, type TraitIndex } from './index-of'
import type { ArtRule, AtLeastOne, Project, RuleConflict, RuleKind } from './types'

export { analyseRules, chainConflicts } from './analyse'

export function isBidirectional(kind: RuleKind): boolean {
  return kind !== 'must pair with'
}

/** The at-least-one constraints that apply to one collection's tokens. */
export function constraintsOf(atLeastOne: AtLeastOne[] | undefined, collectionId: string): AtLeastOne[] {
  return (atLeastOne ?? []).filter((constraint) => constraint.collectionId === collectionId)
}

/** Whether a set of trait ids satisfies the rules and the collection's constraints. */
export function satisfiesRules(
  traitIds: ReadonlySet<string>,
  rules: ArtRule[],
  atLeastOne: AtLeastOne[] = [],
): boolean {
  for (const rule of rules) {
    const hasTrait = traitIds.has(rule.traitId)
    const hasRelated = rule.relatedTraitIds.some((id) => traitIds.has(id))
    if (rule.kind === "doesn't mix with" && hasTrait && hasRelated) return false
    if (rule.kind === 'must pair with' && hasTrait && !hasRelated) return false
    if (rule.kind === 'always pairs with' && hasTrait !== hasRelated) return false
  }
  for (const constraint of atLeastOne) if (!constraint.traitIds.some((id) => traitIds.has(id))) return false
  return true
}

/** The first rule a set of traits breaks, worded for the creator, or null when it breaks none. */
export function brokenRule(
  traitIds: string[],
  rules: ArtRule[],
  index: TraitIndex,
  atLeastOne: AtLeastOne[] = [],
): string | null {
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
  for (const constraint of atLeastOne)
    if (!constraint.traitIds.some((id) => has.has(id)))
      return `Every token needs one of ${joinOr(constraint.traitIds.map((id) => traitName(index, id)))}.`
  return null
}

/** An existing rule that says the same thing (same kind and source with overlapping related traits, or the two-way pairing written from the other side). */
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

/** The rules generation applies: for each conflict, the rules it names to skip, or every rule but the first. */
export function activeRules(rules: ArtRule[], conflicts: RuleConflict[]): ArtRule[] {
  const skipped = new Set(conflicts.flatMap((conflict) => conflict.skip ?? conflict.ruleIds.slice(1)))
  return rules.filter((rule) => !skipped.has(rule.id))
}

/** The rules a project generates and validates with: every rule not skipped because of a conflict. */
export function activeProjectRules(
  project: Pick<Project, 'layers' | 'rules'>,
  index?: TraitIndex,
): ArtRule[] {
  const idx = index ?? buildTraitIndex(project.layers)
  return activeRules(project.rules, analyseRules(project.layers, project.rules, idx))
}

/** Drops rule references to traits that no longer exist, and rules left with nothing to relate. */
export function pruneRules(rules: ArtRule[], traitIds: ReadonlySet<string>): ArtRule[] {
  const next: ArtRule[] = []
  let changed = false
  for (const rule of rules) {
    const related = rule.relatedTraitIds.filter((id) => traitIds.has(id))
    if (!traitIds.has(rule.traitId) || related.length === 0) {
      changed = true
      continue
    }
    if (related.length !== rule.relatedTraitIds.length) {
      changed = true
      next.push({ ...rule, relatedTraitIds: related })
    } else next.push(rule)
  }
  return changed ? next : rules
}
/** How many rules mention any of these traits. */
export function rulesTouching(rules: ArtRule[], traitIds: ReadonlySet<string>): number {
  return rules.filter(
    (rule) => traitIds.has(rule.traitId) || rule.relatedTraitIds.some((id) => traitIds.has(id)),
  ).length
}
