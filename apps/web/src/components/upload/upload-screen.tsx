import type { Tables } from '@/lib/database.types'
import {
  DEMO_LAYERS,
  DEMO_PLACEHOLDER_DESCRIPTION,
  DEMO_RENDER_JOBS,
  DEMO_RULES,
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
  /** "Finish the art later" (decision D25): lock and render the placeholder alone. */
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
 * Replaced by: counts from the project's layer, trait and rule rows.
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
  const traits = DEMO_LAYERS.flatMap((layer) => layer.traits)
  const art: ArtSummary = {
    layers: DEMO_LAYERS.length,
    traits: traits.filter((trait) => !trait.blank).length,
    rules: DEMO_RULES.length,
    constants: traits.flatMap((trait) =>
      trait.constant ? [{ name: trait.name, count: trait.constant }] : [],
    ),
  }
  const { imagesCid, metadataCid, placeholder } = DEMO_RENDER_JOBS.done
  const outcome = UPLOAD_OUTCOMES.find((entry) => entry === sampleOutcome) as UploadOutcome | undefined

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
