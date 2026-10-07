import type { ArtRule, RuleKind } from '@/lib/demo'
import { joinOr, traitName, type TraitIndex } from '../lib/trait-index'

/**
 * Rule checks for the Rules and Generate screens: wording, duplicates, the conflict analyser and
 * the reason a token breaks a rule.
 *
 * The analyser and the rule check live in `packages/dna`; they are re-exported here.
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

/** "Monocle doesn't mix with Sleepy, Wink or Squint." */
export function ruleSentence(rule: ArtRule, index: TraitIndex): string {
  const related = joinOr(rule.relatedTraitIds.map((id) => traitName(index, id)))
  return `${traitName(index, rule.traitId)} ${rule.kind} ${related}.`
}

export { activeRules, analyseRules, brokenRule, findDuplicate, isBidirectional } from '@cobweb/dna'
