import { satisfiesRules } from '@cobweb/dna'
import { EMPTY_REVIEW, type ReviewData, type ReviewProblem } from '@/lib/art/lock-review'
import type { Tables } from '@/lib/database.types'
import {
  DEMO_COLLECTIONS,
  DEMO_LAYERS,
  DEMO_PLACEHOLDER_DESCRIPTION,
  DEMO_RULE_CONFLICTS,
  DEMO_RULES,
  DEMO_TOKEN_COUNT,
  DEMO_TOKENS,
  getRenderJob as sampleRenderJob,
  type GeneratedToken,
  type RenderJob,
} from '@/lib/demo'
import { hasArtSubStep, type FlowLink } from '@/lib/steps'
import { UploadFlow } from './upload-flow'
import { UPLOAD_OUTCOMES, type UploadOutcome } from './upload-sim'

export type UploadScreenProps = {
  collection: Tables<'collections'>
  /** The render job; its state picks the step the screen opens on. */
  job: RenderJob
  /** The job to fall back to after an unlock: nothing locked yet. */
  pending: RenderJob
  /** `reviewArt`'s result. Null for deferred art and in sample mode, which works it out from the sample. */
  review: ReviewData | null
  sample: boolean
  readOnly: boolean
  /** "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): lock and render the placeholder alone. */
  artDeferred?: boolean
  /** The flow screens either side, for the footer the screen renders itself. */
  previous?: FlowLink
  next?: FlowLink
  /**
   * Sample mode only (`?outcome=`): makes the first attempt of an action fail, so failure states
   * can be reviewed. rejected | reverted | balance | check-failed | batch-failed | art-problem.
   */
  sampleOutcome?: string
}

/**
 * Lock and upload: review and lock the art, pay the generation fee through the factory's
 * `payForArt(jobId)` (simulate first, then send), then follow the render in batches as the worker
 * finishes them. Server part: in sample mode it works out the sample's review and picks the done sample
 * here, so the client bundle does not carry the sample art.
 */
export function UploadScreen({
  collection,
  job,
  pending,
  review,
  sample,
  readOnly,
  artDeferred = false,
  previous,
  next,
  sampleOutcome,
}: UploadScreenProps) {
  const outcome = UPLOAD_OUTCOMES.find((entry) => entry === sampleOutcome) as UploadOutcome | undefined
  const sampleDone = sample ? sampleRenderJob('done', { artDeferred }) : null
  if (sampleDone && sampleDone.state !== 'done') throw new Error('The sample done job is not done.')

  return (
    <UploadFlow
      collectionId={collection.id}
      collectionChainId={collection.chain_id}
      job={job}
      pending={pending}
      review={sample ? sampleReview(outcome) : (review ?? EMPTY_REVIEW)}
      sample={sample}
      sampleDone={sampleDone}
      placeholderDescription={sample ? DEMO_PLACEHOLDER_DESCRIPTION : ''}
      deferred={artDeferred}
      assetsFlow={!hasArtSubStep(collection.project_type, 'generate')}
      readOnly={readOnly}
      previous={previous}
      next={next}
      outcome={outcome}
    />
  )
}

const fmt = (value: number) => value.toLocaleString('en-US')

/** The sample's review in the shape `reviewArt` returns. */
function sampleReview(outcome: UploadOutcome | undefined): ReviewData {
  const traits = DEMO_LAYERS.flatMap((layer) => layer.traits)
  // Rules named in a conflict are skipped by the generator, so they are not held against the set.
  const conflicted = new Set(DEMO_RULE_CONFLICTS.flatMap((conflict) => conflict.ruleIds.slice(1)))
  const rules = DEMO_RULES.filter((rule) => !conflicted.has(rule.id))
  const breaking = DEMO_TOKENS.filter((token) => !satisfiesRules(new Set(token.dna), rules)).length
  // `?outcome=check-failed` gives the sample two identical tokens to review the duplicates check.
  const duplicates = outcome === 'check-failed' ? [[118, 540]] : findDuplicates(DEMO_TOKENS)
  const problems: ReviewProblem[] = []
  if (DEMO_TOKENS.length !== DEMO_TOKEN_COUNT)
    problems.push({
      code: 'size',
      message: `The set has ${fmt(DEMO_TOKENS.length)} tokens and the supply is ${fmt(DEMO_TOKEN_COUNT)}. Match them in Generate first.`,
    })
  if (breaking > 0)
    problems.push({
      code: 'rule',
      message: `${fmt(breaking)} ${breaking === 1 ? 'token breaks' : 'tokens break'} the rules. Regenerate them in Generate first.`,
    })
  if (duplicates.length > 0)
    problems.push({
      code: 'duplicate',
      message: `${duplicates.map((group) => `Tokens ${group.map((id) => `#${id}`).join(' and ')}`).join(', ')} have the same traits. Change them in Generate, or allow identical tokens.`,
    })
  return {
    problems,
    tokenCount: DEMO_TOKENS.length,
    supply: DEMO_TOKEN_COUNT,
    allowDuplicatesNeeded: problems.length > 0 && problems.every((problem) => problem.code === 'duplicate'),
    counts: {
      collections: DEMO_COLLECTIONS.length,
      layers: DEMO_LAYERS.length,
      traits: traits.filter((trait) => !trait.blank).length,
      rules: DEMO_RULES.length,
    },
    constants: traits.flatMap((trait) =>
      trait.constant ? [{ name: trait.name, count: trait.constant }] : [],
    ),
    credit: false,
  }
}

/** Groups of token ids whose collection and traits are identical. */
function findDuplicates(tokens: GeneratedToken[]): number[][] {
  const byTraits = new Map<string, number[]>()
  for (const token of tokens) {
    const key = `${token.collectionId}:${token.dna.join(',')}`
    byTraits.set(key, [...(byTraits.get(key) ?? []), token.id])
  }
  return [...byTraits.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort((a, b) => a - b))
}
