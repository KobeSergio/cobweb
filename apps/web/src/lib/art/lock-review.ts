import { validateTokenList, type LockProblem, type Project, type TokenCore } from '@cobweb/dna'
import type { ProjectType } from '@/lib/collections'
import { assetListProblems, type AssetToken } from './asset-tokens'

/** The list a lock validates: a generative project's stored tokens with its art, or an asset list. */
export type LockList =
  { kind: 'generative'; project: Project; tokens: TokenCore[] } | { kind: 'assets'; tokens: AssetToken[] }

export type ReviewProblem = { code: LockProblem['code'] | 'files'; message: string }

/** What the review step shows (spec sections 7 and 8), from `reviewArt`. */
export type ReviewData = {
  problems: ReviewProblem[]
  tokenCount: number
  supply: number
  /** The only problems are identical tokens, so "Allow identical tokens" is offered. */
  allowDuplicatesNeeded: boolean
  counts: { collections: number; layers: number; traits: number; rules: number }
  /** Traits with a maximum count, and that maximum. */
  constants: { name: string; count: number }[]
  /** A paid render that failed and was unlocked left a credit that covers this lock: the lock is free. */
  credit: boolean
}

export const EMPTY_REVIEW: ReviewData = {
  problems: [],
  tokenCount: 0,
  supply: 0,
  allowDuplicatesNeeded: false,
  counts: { collections: 0, layers: 0, traits: 0, rules: 0 },
  constants: [],
  credit: false,
}

/**
 * Runs the lock's checks over a list: `validateTokenList` for a generative project (ids, sizes,
 * collections, DNA, traits, rules, caps, duplicates; identical tokens always reported here and
 * forgiven by `lockRefusal`), the asset checks otherwise.
 */
export function reviewData(list: LockList, projectType: ProjectType): ReviewData {
  if (list.kind === 'assets')
    return {
      problems: assetListProblems(list.tokens, projectType),
      tokenCount: list.tokens.length,
      supply: list.tokens.length,
      allowDuplicatesNeeded: false,
      counts: { collections: 1, layers: 0, traits: 0, rules: 0 },
      constants: [],
      credit: false,
    }
  const { project, tokens } = list
  const result = validateTokenList(project, tokens, { allowDuplicates: false })
  const problems: ReviewProblem[] = result.ok
    ? []
    : result.problems.map(({ code, message }) => ({ code, message }))
  if (tokens.length === 0) problems.unshift({ code: 'size', message: 'Generate the set before locking.' })
  const traits = project.layers.flatMap((layer) => layer.traits)
  return {
    problems,
    tokenCount: tokens.length,
    supply: project.collections.reduce((sum, collection) => sum + collection.size, 0),
    allowDuplicatesNeeded: problems.length > 0 && problems.every((problem) => problem.code === 'duplicate'),
    counts: {
      collections: project.collections.length,
      layers: project.layers.length,
      traits: traits.filter((trait) => !trait.blank).length,
      rules: project.rules.length,
    },
    constants: traits.flatMap((trait) =>
      trait.constant ? [{ name: trait.name, count: trait.constant }] : [],
    ),
    credit: false,
  }
}

/** Why the lock is refused, or null: the first problem left once identical tokens are allowed. */
export function lockRefusal(review: ReviewData, allowDuplicates: boolean): string | null {
  return (
    review.problems.find((problem) => !(allowDuplicates && problem.code === 'duplicate'))?.message ?? null
  )
}

export type ReviewCheck = {
  key: 'supply' | 'duplicates' | 'rules' | 'caps'
  label: string
  problems: string[]
}

const CHECK_FOR: Record<ReviewProblem['code'], ReviewCheck['key']> = {
  ids: 'supply',
  size: 'supply',
  files: 'supply',
  duplicate: 'duplicates',
  collection: 'rules',
  'dna-length': 'rules',
  trait: 'rules',
  rule: 'rules',
  cap: 'caps',
}

/** The four checks of the review step (creator flow spec, 4.4): supply, unique tokens, rules, maximum counts. */
export function reviewChecks(review: ReviewData, allowDuplicates: boolean): ReviewCheck[] {
  const of = (key: ReviewCheck['key']) =>
    review.problems.filter((problem) => CHECK_FOR[problem.code] === key).map((problem) => problem.message)
  return [
    { key: 'supply', label: 'The set matches the supply', problems: of('supply') },
    allowDuplicates
      ? { key: 'duplicates', label: 'Identical tokens are allowed', problems: [] }
      : { key: 'duplicates', label: 'Every token is unique', problems: of('duplicates') },
    { key: 'rules', label: 'Every token follows the rules', problems: of('rules') },
    { key: 'caps', label: 'Traits stay within their maximum counts', problems: of('caps') },
  ]
}
