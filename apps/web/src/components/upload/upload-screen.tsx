import { satisfiesRules } from '@cobweb/dna'
import type { Tables } from '@/lib/database.types'
import {
  DEMO_COLLECTIONS,
  DEMO_LAYERS,
  DEMO_PLACEHOLDER_DESCRIPTION,
  DEMO_RENDER_JOBS,
  DEMO_RULE_CONFLICTS,
  DEMO_RULES,
  DEMO_TOKEN_COUNT,
  DEMO_TOKENS,
  type GeneratedToken,
  type RenderJob,
  type SupportedChain,
} from '@/lib/demo'
import type { FlowLink } from '@/lib/steps'
import { UploadFlow } from './upload-flow'
import type { ArtSummary } from './upload-shared'
import { UPLOAD_OUTCOMES, type UploadOutcome } from './upload-sim'

export type UploadScreenProps = {
  collection: Tables<'collections'>
  /** The render job; its `state` drives the screen: locked, payment_due, rendering, done. */
  job: RenderJob
  /** The chain the art fee is paid on (`job.quote.chainId`). */
  chain: SupportedChain
  readOnly: boolean
  /** "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): lock and render the placeholder alone. */
  artDeferred?: boolean
  /** The flow screens either side, for the footer the screen renders itself. */
  previous?: FlowLink
  next?: FlowLink
  /**
   * Sample mode only (`?outcome=`): makes the first attempt of an action fail, so failure states
   * can be reviewed. rejected | reverted | balance | check-failed | batch-failed.
   */
  sampleOutcome?: string
}

/**
 * Lock and upload: lock the art, pay the generation fee through the factory's `payForArt(jobId)`
 * (simulate first, then send), then follow the render in batches until the CIDs are pinned.
 *
 * Server part: works out the art summary so the client bundle does not carry the sample art.
 * Replaced by: counts from the project's layer, trait and rule rows and its stored token list.
 */
export function UploadScreen({
  job,
  chain,
  readOnly,
  artDeferred = false,
  previous,
  next,
  sampleOutcome,
}: UploadScreenProps) {
  const outcome = UPLOAD_OUTCOMES.find((entry) => entry === sampleOutcome) as UploadOutcome | undefined
  const traits = DEMO_LAYERS.flatMap((layer) => layer.traits)
  // Rules named in a conflict are skipped by the generator, so they are not held against the set.
  const conflicted = new Set(DEMO_RULE_CONFLICTS.flatMap((conflict) => conflict.ruleIds.slice(1)))
  const rules = DEMO_RULES.filter((rule) => !conflicted.has(rule.id))
  const art: ArtSummary = {
    supply: DEMO_TOKEN_COUNT,
    tokens: DEMO_TOKENS.length,
    collections: DEMO_COLLECTIONS.length,
    breaking: DEMO_TOKENS.filter((token) => !satisfiesRules(new Set(token.dna), rules)).length,
    // `?outcome=check-failed` gives the sample two identical tokens to review the duplicates list.
    duplicates: outcome === 'check-failed' ? [[118, 540]] : findDuplicates(DEMO_TOKENS),
    layers: DEMO_LAYERS.length,
    traits: traits.filter((trait) => !trait.blank).length,
    rules: DEMO_RULES.length,
    constants: traits.flatMap((trait) =>
      trait.constant ? [{ name: trait.name, count: trait.constant }] : [],
    ),
  }
  const { imagesCid, metadataCid, placeholder } = DEMO_RENDER_JOBS.done

  return (
    <UploadFlow
      job={job}
      chain={chain}
      art={art}
      sampleResult={{ imagesCid, metadataCid, placeholder }}
      placeholderDescription={DEMO_PLACEHOLDER_DESCRIPTION}
      deferred={artDeferred}
      readOnly={readOnly}
      previous={previous}
      next={next}
      outcome={outcome}
    />
  )
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
